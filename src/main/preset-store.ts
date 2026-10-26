import { IpcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../shared/types';
import type { Preset, AppSettings, Zone } from '../shared/types';
import { startupTaskExists } from './startup-task';

// Monitor identity (stable hardware ids + position fallback) lives in monitors.ts.

type MonitorRect = { id: string; x: number; y: number; width: number; height: number };

/**
 * Pick a free monitor for a zone whose saved `monitorId` isn't connected: the
 * one nearest the saved monitor's center, but only if that center still falls
 * on it. Without saved bounds there's nothing safe to go on, so no match.
 */
function rematchMonitor(zone: Zone, free: MonitorRect[]): MonitorRect | null {
  if (!zone.monitorBounds || free.length === 0) return null;
  const zcx = zone.monitorBounds.x + zone.monitorBounds.width / 2;
  const zcy = zone.monitorBounds.y + zone.monitorBounds.height / 2;
  let best: MonitorRect | null = null;
  let bestDist = Infinity;
  for (const m of free) {
    const dist = Math.hypot(m.x + m.width / 2 - zcx, m.y + m.height / 2 - zcy);
    if (dist < bestDist) { bestDist = dist; best = m; }
  }
  if (!best) return null;
  const inside = zcx >= best.x && zcx < best.x + best.width && zcy >= best.y && zcy < best.y + best.height;
  return inside ? best : null;
}

/**
 * Map zones with a stale `monitorId` onto current monitors, in memory only.
 * Each saved monitor maps to a distinct current monitor, so zones from two
 * screens never collapse onto one; unmatched zones keep their saved id and
 * fail at launch as "not connected". Never persisted: the saved preset only
 * changes when the user saves it.
 */
export function resolveZoneMonitors(zones: Zone[], monitors: MonitorRect[]): Zone[] {
  const connected = new Set(monitors.map(m => m.id));
  const claimed = new Set(zones.filter(z => connected.has(z.monitorId)).map(z => z.monitorId));
  const remap = new Map<string, MonitorRect | null>();
  for (const zone of zones) {
    if (connected.has(zone.monitorId) || remap.has(zone.monitorId)) continue;
    const match = rematchMonitor(zone, monitors.filter(m => !claimed.has(m.id)));
    remap.set(zone.monitorId, match);
    if (match) {
      claimed.add(match.id);
      console.log(`[MonCOM] Rematched monitor ${zone.monitorId} → ${match.id} (not saved)`);
    }
  }
  return zones.map(z => {
    const m = remap.get(z.monitorId);
    return m ? { ...z, monitorId: m.id } : z;
  });
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

const PRESET_BACKUPS = 5;

/** Shift presets.json → .bak.1 → .bak.2 … so a bad write can always be rolled back by hand. */
function rotatePresetBackups(): void {
  const file = getPresetsPath();
  if (!fs.existsSync(file)) return;
  try {
    for (let i = PRESET_BACKUPS - 1; i >= 1; i--) {
      const from = `${file}.bak.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.bak.${i + 1}`);
    }
    fs.copyFileSync(file, `${file}.bak.1`);
  } catch (e) {
    console.error('[MonCOM] Preset backup failed:', e);
  }
}

function savePresets(presets: Preset[]): void {
  rotatePresetBackups();
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
  ipcMain.handle(IPC.GET_PRESETS, () => loadPresets());

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
