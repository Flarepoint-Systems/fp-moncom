/** Represents a physical monitor detected by the system */
export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

/** A zone is a rectangular region within a monitor where content is displayed */
export interface Zone {
  id: string;
  monitorId: string;
  /**
   * Absolute bounds of the monitor at the time this zone was saved. Used to
   * relocate the zone if `monitorId` no longer matches any current monitor
   * (e.g., after a reboot where the OS reassigned display IDs). Optional for
   * backwards-compat with presets created before this field existed.
   */
  monitorBounds?: { x: number; y: number; width: number; height: number };
  /** Position relative to the monitor's top-left (0-1 normalized) */
  x: number;
  y: number;
  width: number;
  height: number;
  content: ZoneContent | null;
}

/** Modifier keys held during a key action. */
export type KeyModifier = 'ctrl' | 'alt' | 'shift' | 'win';

/** A recorded automation action to replay after zone content launches */
export interface AutomationAction {
  type: 'click' | 'right-click' | 'key' | 'type' | 'scroll';
  /** X position relative to zone (0-1), for click/scroll actions */
  x?: number;
  /** Y position relative to zone (0-1), for click/scroll actions */
  y?: number;
  /** Virtual key code, for key actions */
  vkCode?: number;
  /** Modifier keys held during a key action, e.g. ['ctrl'] for Ctrl+T */
  modifiers?: KeyModifier[];
  /** Text to type, for type actions */
  text?: string;
  /** Wheel notches for scroll actions; positive = up, negative = down */
  deltaY?: number;
  /** Delay in ms before this action executes */
  delay: number;
}

/** Result of asking the main process to start recording. */
export type StartRecordingResult =
  | { ok: true }
  | { ok: false; error: string };

/** Live recorder progress, pushed to the renderer while a recording runs. */
export interface RecordingStatus {
  captured: number;
  /** Captured events that landed outside the zone rectangle. Kept, not discarded. */
  outsideZone: number;
  lastType?: AutomationAction['type'];
  /** Set when the recorder died mid-session; recording is over. */
  error?: string;
}

/**
 * A DOM-driven login/setup step for a URL zone. Because MonCOM owns the
 * BrowserWindow, these run via injected JS against CSS selectors — robust to
 * page layout shifts, unlike coordinate-based input replay.
 */
export interface WebLoginStep {
  /**
   * - `waitFor`  — wait until the selector exists, then continue.
   * - `skipIfPresent` — if the selector already exists, stop (we're already
   *   logged in). Since web login runs on every launch, this also re-logs-in
   *   automatically when a session has expired (the marker won't be present).
   * - `fill` / `click` — type into / click the selector.
   */
  action: 'waitFor' | 'skipIfPresent' | 'fill' | 'click';
  /** CSS selector the step targets. */
  selector: string;
  /** Value to type, for `fill`. */
  value?: string;
  /** Optional pause (ms) after this step completes. */
  delayMs?: number;
}

/** Content that can be assigned to a zone */
export interface ZoneContent {
  type: 'url' | 'application';
  /** URL to open or path to executable */
  target: string;
  /** Display name */
  label: string;
  /** Whether to open in kiosk/borderless mode */
  kiosk?: boolean;
  /** Extra delay in ms to wait after content launches before playing automation (default 0) */
  launchDelay?: number;
  /** Recorded automation actions to replay after launch */
  actions?: AutomationAction[];
  /** DOM-driven auto-login steps, for `url` zones (run after the page loads). */
  webLogin?: WebLoginStep[];
}

// ─── App Profiles: data-driven launch recipes for stubborn, multi-window apps ───

/** Criteria to match a top-level window. All provided fields must match (AND). */
export interface WindowMatch {
  /** Process exe base name, lowercased, no extension (e.g. "dssclient"). */
  exe?: string;
  /** Case-insensitive substring of the window title. */
  titleContains?: string;
  /** Window class name (case-insensitive, exact). */
  className?: string;
}

/** An action performed on a matched window during a profile step. */
export interface ProfileAction {
  type: 'click' | 'key' | 'wait';
  /** Click position relative to the matched window (0-1), for `click`. */
  x?: number;
  y?: number;
  /** Use the right mouse button, for `click`. */
  right?: boolean;
  /** Virtual key code, for `key`. */
  vkCode?: number;
  modifiers?: KeyModifier[];
  /** Milliseconds to wait, for `wait`. */
  ms?: number;
}

/** One step of a launch recipe: wait for a window, optionally act, optionally mark it as the target. */
export interface ProfileStep {
  /** Wait for a not-yet-handled window matching this. */
  waitFor: WindowMatch;
  /** Max wait for this step (ms, default 15000). */
  timeoutMs?: number;
  /** If the window never appears, continue instead of aborting the recipe. */
  optional?: boolean;
  /** Actions to perform once the window is matched. */
  do?: ProfileAction[];
  /** Wait for the matched window to close before the next step. */
  waitClose?: boolean;
  /** Mark the matched window as the one to position in the zone. */
  position?: boolean;
}

/** A data-driven launch recipe for a stubborn, multi-window app (e.g. a DSS/CCTV client). */
export interface AppProfile {
  id: string;
  name: string;
  /** Which app this applies to (matched against the launched exe). */
  match: WindowMatch;
  steps: ProfileStep[];
}

export interface AppWindowCloseFailure {
  hwnd: string;
  reason: string;
}

export interface CloseAllZonesReport {
  electronWindowsClosed: number;
  appWindowsAttempted: number;
  appWindowsClosedGracefully: number;
  appWindowsForceKilled: number;
  appWindowsAlreadyGone: number;
  appWindowsFailed: AppWindowCloseFailure[];
}

export interface LaunchZoneResult {
  success: boolean;
  zoneId: string;
  contentType?: ZoneContent['type'];
  target?: string;
  error?: string;
}

export interface ApplyPresetResult {
  success: boolean;
  results: LaunchZoneResult[];
  failedZones: LaunchZoneResult[];
  closeReport?: CloseAllZonesReport;
}

/** A layout defines how monitors are split into zones */
export interface Layout {
  id: string;
  zones: Zone[];
}

/** A preset is a named, saveable configuration */
export interface Preset {
  id: string;
  name: string;
  icon?: string;
  layout: Layout;
  createdAt: string;
  updatedAt: string;
}

/** Application settings */
export interface AppSettings {
  theme: 'dark';
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  autoLaunchPreset: boolean;
  autoLaunchPresetId: string | null;
  /** Launch MonCOM with administrator privileges (needed for apps that require elevation) */
  runAsAdmin: boolean;
  /** Global shortcut bindings, keyed by preset id -> Electron accelerator (e.g. "CommandOrControl+Alt+1"). */
  hotkeys: Record<string, string>;
}

/** IPC channel names */
export const IPC = {
  GET_MONITORS: 'get-monitors',
  APPLY_PRESET: 'apply-preset',
  LAUNCH_ZONE: 'launch-zone',
  CLOSE_ALL_ZONES: 'close-all-zones',
  GET_PRESETS: 'get-presets',
  SAVE_PRESET: 'save-preset',
  DELETE_PRESET: 'delete-preset',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  /** Re-read settings.hotkeys and (re)register global shortcuts. Returns conflicts. */
  REGISTER_HOTKEYS: 'register-hotkeys',
  MOVE_WINDOW: 'move-window',
  FIND_WINDOWS: 'find-windows',
  START_RECORDING: 'start-recording',
  STOP_RECORDING: 'stop-recording',
  /** Main -> renderer: live capture counts while recording. */
  RECORDING_STATUS: 'recording-status',
  PLAY_ACTIONS: 'play-actions',
  IS_ELEVATED: 'is-elevated',
  /** Whether the silent-elevated-startup scheduled task is registered. */
  GET_ELEVATED_AUTOSTART: 'get-elevated-autostart',
  /** Register or remove that task. Returns { ok, error? }. */
  SET_ELEVATED_AUTOSTART: 'set-elevated-autostart',
  IDENTIFY_MONITOR: 'identify-monitor',
  HAS_LAUNCHED_WINDOWS: 'has-launched-windows',
  GET_PROFILES: 'get-profiles',
  SAVE_PROFILE: 'save-profile',
  DELETE_PROFILE: 'delete-profile',
  OPEN_PROFILES_FOLDER: 'open-profiles-folder',
  /** Sent from URL-zone preload to step zoom in/out (delta: +1 or -1). */
  ZONE_ZOOM_STEP: 'zone-zoom-step',
  /** Sent from URL-zone preload to reset zoom to 1.0. */
  ZONE_ZOOM_RESET: 'zone-zoom-reset',
  /** Sent from URL-zone preload to toggle devtools. */
  ZONE_TOGGLE_DEVTOOLS: 'zone-toggle-devtools',
} as const;
