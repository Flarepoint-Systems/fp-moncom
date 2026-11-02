import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type {
  AppProfile,
  AppSettings,
  AutomationAction,
  ImportPlan,
  MonitorInfo,
  Preset,
  RecordingStatus,
  Zone,
} from '../shared/types';
import type { MonCOMAPI } from '../shared/api';

const api: MonCOMAPI = {
  // Monitor detection
  getMonitors: () => ipcRenderer.invoke(IPC.GET_MONITORS),

  // Window management
  launchZone: (zone: Zone, monitors: MonitorInfo[]) => ipcRenderer.invoke(IPC.LAUNCH_ZONE, zone, monitors),
  moveWindow: (title: string, x: number, y: number, w: number, h: number) =>
    ipcRenderer.invoke(IPC.MOVE_WINDOW, title, x, y, w, h),
  closeAllZones: () => ipcRenderer.invoke(IPC.CLOSE_ALL_ZONES),
  findWindows: () => ipcRenderer.invoke(IPC.FIND_WINDOWS),

  // Presets
  getPresets: () => ipcRenderer.invoke(IPC.GET_PRESETS),
  savePreset: (preset: Preset) => ipcRenderer.invoke(IPC.SAVE_PRESET, preset),
  deletePreset: (id: string) => ipcRenderer.invoke(IPC.DELETE_PRESET, id),
  exportPreset: (id: string) => ipcRenderer.invoke(IPC.EXPORT_PRESET, id),
  importPresetPreview: () => ipcRenderer.invoke(IPC.IMPORT_PRESET_PREVIEW),
  importPresetCommit: (preset: Preset, plan: ImportPlan, name: string) =>
    ipcRenderer.invoke(IPC.IMPORT_PRESET_COMMIT, preset, plan, name),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),

  // Global hotkeys: re-register from saved settings, returns { failed: [...] }
  registerHotkeys: () => ipcRenderer.invoke(IPC.REGISTER_HOTKEYS),

  // Apply preset (launch all zones)
  applyPreset: (preset: Preset) => ipcRenderer.invoke(IPC.APPLY_PRESET, preset),

  // File picker
  pickExecutable: () => ipcRenderer.invoke('pick-executable'),

  // Automation
  startRecording: (zone: Zone, monitors: MonitorInfo[]) =>
    ipcRenderer.invoke(IPC.START_RECORDING, zone, monitors),
  stopRecording: () => ipcRenderer.invoke(IPC.STOP_RECORDING),
  onRecordingStatus: (cb: (status: RecordingStatus) => void) => {
    const listener = (_e: unknown, status: RecordingStatus) => cb(status);
    ipcRenderer.on(IPC.RECORDING_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATUS, listener);
  },
  playActions: (actions: AutomationAction[], zone: Zone, monitors: MonitorInfo[]) =>
    ipcRenderer.invoke(IPC.PLAY_ACTIONS, actions, zone, monitors),

  // Elevation
  isElevated: () => ipcRenderer.invoke(IPC.IS_ELEVATED),
  getElevatedAutoStart: () => ipcRenderer.invoke(IPC.GET_ELEVATED_AUTOSTART),
  setElevatedAutoStart: (enabled: boolean) => ipcRenderer.invoke(IPC.SET_ELEVATED_AUTOSTART, enabled),

  // Monitor identification
  identifyMonitors: () => ipcRenderer.invoke(IPC.IDENTIFY_MONITOR),

  // Launched windows
  hasLaunchedWindows: () => ipcRenderer.invoke(IPC.HAS_LAUNCHED_WINDOWS),

  // App Profiles
  getProfiles: () => ipcRenderer.invoke(IPC.GET_PROFILES),
  saveProfile: (p: AppProfile) => ipcRenderer.invoke(IPC.SAVE_PROFILE, p),
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC.DELETE_PROFILE, id),
  openProfilesFolder: () => ipcRenderer.invoke(IPC.OPEN_PROFILES_FOLDER),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
};

contextBridge.exposeInMainWorld('moncom', api);
