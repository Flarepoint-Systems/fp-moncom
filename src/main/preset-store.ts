import { IpcMain, app, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../shared/types';
import type { Preset, AppSettings, Zone } from '../shared/types';
import { getStableMonitors } from './monitors';
import { startupTaskExists } from './startup-task';

interface MonitorBounds { x: number; y: number; width: number; height: number }

// Monitor identity (stable hardware ids + position fallback) lives in monitors.ts.

/** Current monitor list with stable IDs (main-process snapshot). */
function snapshotMonitors(): { id: string; x: number; y: number; width: number; height: number }[] {
  return getStableMonitors(screen).map(m => ({ id: m.id, x: m.x, y: m.y, width: m.width, height: m.height }));
}

/**
 * Pick the current monitor that best matches a zone whose `monitorId` is stale.
 * Prefers a center-distance match against `monitorBounds` if available; falls
 * back to the only monitor when there's exactly one; otherwise gives up.
 */
function rematchMonitor(
  zone: Zone,
  monitors: { id: string; x: number; y: number; width: number; height: number }[],
): { id: string; x: number; y: number; width: number; height: number } | null {
  if (monitors.length === 0) return null;
  if (zone.monitorBounds) {
    const zcx = zone.monitorBounds.x + zone.monitorBounds.width / 2;
    const zcy = zone.monitorBounds.y + zone.monitorBounds.height / 2;
    let best = monitors[0];
    let bestDist = Infinity;
    for (const m of monitors) {
      const dx = (m.x + m.width / 2) - zcx;
      const dy = (m.y + m.height / 2) - zcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = m; }
    }
    return best;
  }
  if (monitors.length === 1) return monitors[0];
  return null;
}

/**
 * Walk every preset's zones; if a zone's `monitorId` is unknown to the current
 * monitor set, attempt to rematch it. Also refreshes `monitorBounds` so a
 * future rematch (e.g., after the user moves a monitor) has accurate data.
 * Returns the (possibly) updated presets and a flag indicating whether
 * anything changed so callers can decide whether to persist.
 */
function migratePresets(
  presets: Preset[],
  monitors: { id: string; x: number; y: number; width: number; height: number }[],
): { presets: Preset[]; changed: boolean } {
  let changed = false;
  const out = presets.map(preset => {
    const zones = preset.layout.zones.map(zone => {
      const matched = monitors.find(m => m.id === zone.monitorId)
        ?? rematchMonitor(zone, monitors);
      if (!matched) return zone;

      const sameBounds = zone.monitorBounds
        && zone.monitorBounds.x === matched.x
        && zone.monitorBounds.y === matched.y
        && zone.monitorBounds.width === matched.width
        && zone.monitorBounds.height === matched.height;
      if (zone.monitorId === matched.id && sameBounds) return zone;

      if (zone.monitorId !== matched.id) {
        console.log(`[MonCOM] Rematched zone ${zone.id}: ${zone.monitorId} → ${matched.id}`);
      }
      changed = true;
      return {
        ...zone,
        monitorId: matched.id,
        monitorBounds: { x: matched.x, y: matched.y, width: matched.width, height: matched.height },
      };
    });
    if (zones.every((z, i) => z === preset.layout.zones[i])) return preset;
    return { ...preset, layout: { ...preset.layout, zones } };
  });
  return { presets: out, changed };
}

/**
 * Read presets, then migrate any zones referencing stale monitor IDs. If the
 * migration changed anything, persist the corrected presets back to disk so
 * future reads (and the renderer) see consistent data.
 */
export function loadAndMigratePresets(): Preset[] {
  const raw = loadPresets();
  // Only migrate when at least one display is enumerable (after app ready).
  let monitors: ReturnType<typeof snapshotMonitors>;
  try { monitors = snapshotMonitors(); } catch { return raw; }
  if (monitors.length === 0) return raw;
  const { presets, changed } = migratePresets(raw, monitors);
  if (changed) savePresets(presets);
  return presets;
}

/**
 * Migrate the zones of a single preset against the supplied monitor list.
 * Useful at apply-time when we already have a current monitor snapshot.
 * Persists changes only if the preset already exists on disk.
 */
export function migrateAndPersistPreset(
  preset: Preset,
  monitors: { id: string; x: number; y: number; width: number; height: number }[],
): Preset {
  const { presets: [migrated], changed } = migratePresets([preset], monitors);
  if (changed) {
    const stored = loadPresets();
    const idx = stored.findIndex(p => p.id === migrated.id);
    if (idx >= 0) {
      stored[idx] = migrated;
      savePresets(stored);
    }
  }
  return migrated;
}

function getDataDir(): string {
  const dir = path.join(app.getPath('userData'), 'moncom-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getPresetsPath(): string {
  return path.join(getDataDir(), 'presets.json');
}

function getSettingsPath(): string {
  return path.join(getDataDir(), 'settings.json');
}

function getZoneStatePath(): string {
  return path.join(getDataDir(), 'zone-state.json');
}

export interface ZoneState {
  /** Per-URL zoom factors (1.0 = default). Keyed by normalized URL. */
  zoomByUrl: Record<string, number>;
}

const DEFAULT_ZONE_STATE: ZoneState = { zoomByUrl: {} };

export function loadZoneState(): ZoneState {
  try {
    const data = fs.readFileSync(getZoneStatePath(), 'utf-8');
    const saved = JSON.parse(data);
    return { ...DEFAULT_ZONE_STATE, ...saved };
  } catch {
    return { ...DEFAULT_ZONE_STATE, zoomByUrl: {} };
  }
}

export function saveZoneState(state: ZoneState): void {
  fs.writeFileSync(getZoneStatePath(), JSON.stringify(state, null, 2));
}

export function getZoomForUrl(url: string): number {
  const state = loadZoneState();
  return state.zoomByUrl[url] ?? 1.0;
}

export function setZoomForUrl(url: string, zoomFactor: number): void {
  const state = loadZoneState();
  if (Math.abs(zoomFactor - 1.0) < 1e-6) {
    delete state.zoomByUrl[url];
  } else {
    state.zoomByUrl[url] = zoomFactor;
  }
  saveZoneState(state);
}

export function loadPresets(): Preset[] {
  try {
    const data = fs.readFileSync(getPresetsPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]): void {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(presets, null, 2));
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  launchOnStartup: false,
  minimizeToTray: true,
  autoLaunchPreset: false,
  autoLaunchPresetId: null,
  runAsAdmin: false,
  hotkeys: {},
};

export function loadSettings(): AppSettings {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8');
    const saved = JSON.parse(data);
    // Merge with defaults so new fields added in future versions get their defaults
    // while existing user values are preserved
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsFile(settings: AppSettings): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

export function registerPresetHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IPC.GET_PRESETS, () => loadAndMigratePresets());

  ipcMain.handle(IPC.SAVE_PRESET, (_event, preset: Preset) => {
    const presets = loadPresets();
    const idx = presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      presets[idx] = preset;
    } else {
      presets.push(preset);
    }
    savePresets(presets);
    return presets;
  });

  ipcMain.handle(IPC.DELETE_PRESET, (_event, id: string) => {
    const presets = loadPresets().filter(p => p.id !== id);
    savePresets(presets);
    return presets;
  });

  ipcMain.handle(IPC.GET_SETTINGS, () => loadSettings());

  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, settings: AppSettings) => {
    saveSettingsFile(settings);

    // The scheduled task owns startup when it exists; a Run entry too would race it.
    app.setLoginItemSettings({
      openAtLogin: settings.launchOnStartup && !startupTaskExists(),
      path: process.execPath,
    });

    return settings;
  });
}
