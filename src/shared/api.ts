import type {
  ApplyPresetResult,
  AppProfile,
  AppSettings,
  AutomationAction,
  CloseAllZonesReport,
  ExportPresetResult,
  ImportPlan,
  ImportPresetPreview,
  LaunchZoneResult,
  MonitorInfo,
  Preset,
  RecordingStatus,
  StartRecordingResult,
  Zone,
} from './types';

export interface ProfileEntry {
  profile: AppProfile;
  bundled: boolean;
}

export interface MonCOMAPI {
  getMonitors(): Promise<MonitorInfo[]>;
  launchZone(zone: Zone, monitors: MonitorInfo[]): Promise<LaunchZoneResult>;
  moveWindow(title: string, x: number, y: number, w: number, h: number): Promise<boolean>;
  closeAllZones(): Promise<CloseAllZonesReport>;
  findWindows(): Promise<{ title: string; pid: number; exe: string; className: string }[]>;
  getPresets(): Promise<Preset[]>;
  savePreset(preset: Preset): Promise<Preset[]>;
  deletePreset(id: string): Promise<Preset[]>;
  exportPreset(id: string): Promise<ExportPresetResult>;
  importPresetPreview(): Promise<ImportPresetPreview>;
  importPresetCommit(preset: Preset, plan: ImportPlan, name: string): Promise<Preset[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  registerHotkeys(): Promise<{ failed: { presetId: string; accelerator: string }[] }>;
  applyPreset(preset: Preset): Promise<ApplyPresetResult>;
  pickExecutable(): Promise<string | null>;
  startRecording(zone: Zone, monitors: MonitorInfo[]): Promise<StartRecordingResult>;
  stopRecording(): Promise<AutomationAction[]>;
  /** Subscribe to live recorder progress. Returns an unsubscribe function. */
  onRecordingStatus(cb: (status: RecordingStatus) => void): () => void;
  playActions(actions: AutomationAction[], zone: Zone, monitors: MonitorInfo[]): Promise<boolean>;
  isElevated(): Promise<boolean>;
  /** True when the silent-elevated-startup scheduled task is registered. */
  getElevatedAutoStart(): Promise<boolean>;
  setElevatedAutoStart(enabled: boolean): Promise<{ ok: boolean; error?: string }>;
  identifyMonitors(): Promise<void>;
  hasLaunchedWindows(): Promise<boolean>;
  getProfiles(): Promise<ProfileEntry[]>;
  saveProfile(profile: AppProfile): Promise<ProfileEntry[]>;
  deleteProfile(id: string): Promise<ProfileEntry[]>;
  openProfilesFolder(): Promise<string>;
  openExternal(url: string): Promise<void>;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
}
