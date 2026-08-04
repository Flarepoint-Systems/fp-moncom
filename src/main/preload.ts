import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

contextBridge.exposeInMainWorld('moncom', {
  // Monitor detection
  getMonitors: () => ipcRenderer.invoke(IPC.GET_MONITORS),

  // Window management
  launchZone: (zone: any, monitors: any) => ipcRenderer.invoke(IPC.LAUNCH_ZONE, zone, monitors),
  moveWindow: (windowTitle: string, x: number, y: number, w: number, h: number) =>
    ipcRenderer.invoke(IPC.MOVE_WINDOW, windowTitle, x, y, w, h),
  closeAllZones: () => ipcRenderer.invoke(IPC.CLOSE_ALL_ZONES),
  findWindows: () => ipcRenderer.invoke(IPC.FIND_WINDOWS),

  // Presets
  getPresets: () => ipcRenderer.invoke(IPC.GET_PRESETS),
  savePreset: (preset: any) => ipcRenderer.invoke(IPC.SAVE_PRESET, preset),
  deletePreset: (id: string) => ipcRenderer.invoke(IPC.DELETE_PRESET, id),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings: any) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),

  // Global hotkeys: re-register from saved settings, returns { failed: [...] }
  registerHotkeys: () => ipcRenderer.invoke(IPC.REGISTER_HOTKEYS),

  // Apply preset (launch all zones)
  applyPreset: (preset: any) => ipcRenderer.invoke(IPC.APPLY_PRESET, preset),

  // File picker
  pickExecutable: () => ipcRenderer.invoke('pick-executable'),

  // Automation
  startRecording: (zone: any, monitors: any) =>
    ipcRenderer.invoke(IPC.START_RECORDING, zone, monitors),
  stopRecording: () => ipcRenderer.invoke(IPC.STOP_RECORDING),
  onRecordingStatus: (cb: (status: any) => void) => {
    const listener = (_e: unknown, status: any) => cb(status);
    ipcRenderer.on(IPC.RECORDING_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATUS, listener);
  },
  playActions: (actions: any, zone: any, monitors: any) =>
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
  saveProfile: (p: any) => ipcRenderer.invoke(IPC.SAVE_PROFILE, p),
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC.DELETE_PROFILE, id),
  openProfilesFolder: () => ipcRenderer.invoke(IPC.OPEN_PROFILES_FOLDER),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
