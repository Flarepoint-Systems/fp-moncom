import { IpcMain, BrowserWindow, app, dialog, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../shared/types';
import type { Preset, AppSettings, ExportPresetResult, ImportPlan, ImportPresetPreview } from '../shared/types';
import { startupTaskExists } from './startup-task';
import { sealPreset, sealPresets, type SecretCodec } from './secrets';
import { safeStorageCodec } from './secrets-electron';
import { applyImportPlan, parsePresetFile, planImport, toPresetFile } from './preset-transfer';
import { getStableMonitors } from './monitors';

const PRESET_FILE_FILTER = { name: 'MonCOM preset', extensions: ['json'] };

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

let codec: SecretCodec | null = null;
// safeStorage is only usable after app.whenReady, so the codec is built on first use.
export function getSecretCodec(): SecretCodec {
  if (!codec) codec = safeStorageCodec();
  return codec;
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

function writePresetsFile(presets: Preset[]): void {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(presets, null, 2));
}

function savePresets(presets: Preset[]): void {
  rotatePresetBackups();
  writePresetsFile(presets);
}

/** Seals any plain login values left in presets.json and its backups. Returns how many were sealed. */
export function migratePresetsAtRest(codec: SecretCodec): number {
  let total = 0;
  for (let i = 1; i <= PRESET_BACKUPS; i++) {
    const backup = `${getPresetsPath()}.bak.${i}`;
    if (!fs.existsSync(backup)) continue;
    let stored: Preset[];
    try {
      stored = JSON.parse(fs.readFileSync(backup, 'utf-8'));
    } catch (e) {
      console.warn(`[MonCOM] Skipping unreadable preset backup ${backup}:`, e);
      continue;
    }
    const { presets, changed } = sealPresets(codec, stored);
    if (changed > 0) fs.writeFileSync(backup, JSON.stringify(presets, null, 2));
    total += changed;
  }
  // No rotation: the backups already hold this data, now sealed.
  const { presets, changed } = sealPresets(codec, loadPresets());
  if (changed > 0) writePresetsFile(presets);
  return total + changed;
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

  ipcMain.handle(IPC.SAVE_PRESET, (_event, incoming: Preset) => {
    const preset = sealPreset(getSecretCodec(), incoming).preset;
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

  ipcMain.handle(IPC.EXPORT_PRESET, async (event, id: string): Promise<ExportPresetResult> => {
    const preset = loadPresets().find(p => p.id === id);
    if (!preset) return { ok: false, error: 'Preset not found.' };
    const options = {
      defaultPath: `${preset.name.replace(/[^a-zA-Z0-9]/g, '-')}.moncom.json`,
      filters: [PRESET_FILE_FILTER],
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const file = toPresetFile(preset, app.getVersion(), new Date());
      fs.writeFileSync(result.filePath, JSON.stringify(file, null, 2));
      return { ok: true, path: result.filePath };
    } catch (e) {
      console.error('[MonCOM] Preset export failed:', e);
      return { ok: false, error: 'The preset file could not be written.' };
    }
  });

  ipcMain.handle(IPC.IMPORT_PRESET_PREVIEW, async (event): Promise<ImportPresetPreview> => {
    const options = { filters: [PRESET_FILE_FILTER], properties: ['openFile' as const] };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    let text: string;
    try {
      text = fs.readFileSync(result.filePaths[0], 'utf-8');
    } catch (e) {
      console.error('[MonCOM] Preset import read failed:', e);
      return { ok: false, error: 'The preset file could not be read.' };
    }
    try {
      const parsed = parsePresetFile(text);
      if (!parsed.ok) return parsed;
      const monitors = getStableMonitors(screen);
      const plan = planImport(parsed.file.preset, monitors);
      return { ok: true, preset: parsed.file.preset, plan, monitors };
    } catch {
      return { ok: false, error: 'This preset file is incomplete.' };
    }
  });

  ipcMain.handle(IPC.IMPORT_PRESET_COMMIT, (_event, incoming: Preset, plan: ImportPlan, name: string) => {
    const monitors = getStableMonitors(screen);
    const planned = applyImportPlan(incoming, plan, monitors, 'preset-' + Date.now(), new Date().toISOString());
    planned.name = name.trim() || planned.name;
    // A hand-edited file can carry plain login values, so they are sealed like any other save.
    const preset = sealPreset(getSecretCodec(), planned).preset;
    const presets = loadPresets();
    presets.push(preset);
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
