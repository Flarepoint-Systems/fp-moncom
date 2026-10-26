import { IpcMain, BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { IPC } from '../shared/types';
import type { ApplyPresetResult, CloseAllZonesReport, LaunchZoneResult, WebLoginStep, Zone } from '../shared/types';
import { playActions } from './automation-manager';
import { loadSettings, getZoomForUrl, setZoomForUrl, resolveZoneMonitors } from './preset-store';
import { getStableMonitors } from './monitors';
import { findProfileForExe } from './profile-store';
import { runProfile } from './profile-runner';
import { normalizeExe } from '../shared/exe';
import {
  enumWindows,
  waitForWindow,
  moveWindowToVisibleRect,
  postClose,
  isWindow,
  type WindowInfo,
  type WindowMatcher,
} from './win32';

/** Zoom factor steps (clamped to MIN..MAX). */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];
const ZOOM_DEFAULT = 1.0;

function stepZoom(current: number, direction: 1 | -1): number {
  // Snap current to the nearest step, then move one step in `direction`.
  let idx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const diff = Math.abs(ZOOM_STEPS[i] - current);
    if (diff < bestDiff) { bestDiff = diff; idx = i; }
  }
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction));
  return ZOOM_STEPS[next];
}

function isProcessElevated(): boolean {
  try { execSync('net session', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Track launched Electron BrowserWindows (for URLs) */
const launchedWindows: BrowserWindow[] = [];

/** Map webContents.id → the normalized URL that zone was launched with (used to persist zoom by URL). */
const zoneUrlByWebContentsId = new Map<number, string>();

/** Track launched app windows we own → hwnd→pid, so we can close them later. */
const launchedAppWindows = new Map<number, number>();

type AppCloseResult = {
  hwnd: number;
  status: 'closed' | 'killed' | 'gone' | 'failed';
  reason?: string;
};

// ─── URL zones: use Electron BrowserWindow ───

/**
 * Launch a URL in a frameless Electron BrowserWindow positioned exactly on the target zone.
 * No PID/HWND detection needed — we own the window.
 */
/** Wait (poll) for a CSS selector to exist in the page. */
async function waitForSelector(wc: Electron.WebContents, selector: string, timeoutMs = 15000): Promise<boolean> {
  const sel = JSON.stringify(selector);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await wc.executeJavaScript(`!!document.querySelector(${sel})`, true)) return true;
    } catch { /* page navigating */ }
    await sleep(300);
  }
  return false;
}

/**
 * Run DOM-driven auto-login steps against a URL zone's BrowserWindow. Uses the
 * native value setter + input/change events so React/Vue-controlled inputs
 * register the change (plain `.value =` doesn't trigger their handlers).
 */
async function runWebLogin(wc: Electron.WebContents, steps: WebLoginStep[]): Promise<void> {
  for (const step of steps) {
    const sel = JSON.stringify(step.selector);
    try {
      if (step.action === 'skipIfPresent') {
        const present = await wc.executeJavaScript(`!!document.querySelector(${sel})`, true).catch(() => false);
        if (present) {
          console.log(`[MonCOM] webLogin: logged-in marker present (${step.selector}), skipping remaining steps`);
          return;
        }
      } else if (step.action === 'waitFor') {
        const ok = await waitForSelector(wc, step.selector);
        if (!ok) console.warn(`[MonCOM] webLogin waitFor timed out: ${step.selector}`);
      } else if (step.action === 'fill') {
        const val = JSON.stringify(step.value ?? '');
        await wc.executeJavaScript(
          `(()=>{const el=document.querySelector(${sel});if(!el)return false;el.focus();` +
          `const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;` +
          `const d=Object.getOwnPropertyDescriptor(proto,'value');(d&&d.set?d.set.call(el,${val}):el.value=${val});` +
          `el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
          true,
        );
      } else if (step.action === 'click') {
        await wc.executeJavaScript(`(()=>{const el=document.querySelector(${sel});if(!el)return false;el.click();return true;})()`, true);
      }
    } catch (e) {
      console.error('[MonCOM] webLogin step failed:', step.action, step.selector, e);
    }
    if (step.delayMs && step.delayMs > 0) await sleep(step.delayMs);
  }
  console.log(`[MonCOM] webLogin completed (${steps.length} steps)`);
}

function launchURLZone(url: string, x: number, y: number, w: number, h: number, webLogin?: WebLoginStep[]): Promise<void> {
  // Resolves once the page has loaded and any web-login steps have finished, so
  // the caller can run coordinate automation *after* login.
  let resolveLogin: () => void = () => {};
  const loginDone = new Promise<void>((r) => { resolveLogin = r; });
  let loginSettled = false;
  const settleLogin = () => { if (!loginSettled) { loginSettled = true; resolveLogin(); } };

  const win = new BrowserWindow({
    x, y,
    width: w,
    height: h,
    frame: false,
    thickFrame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: false,
    enableLargerThanScreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Dedicated persistent partition for zone sites: localStorage, cookies,
      // IndexedDB etc. survive app restarts and stay isolated from MonCOM's UI.
      partition: 'persist:moncom-zones',
      preload: path.join(__dirname, 'zone-preload.js'),
    },
  });

  // Force exact bounds — Windows can adjust the initial position
  win.setBounds({ x, y, width: w, height: h });

  const actual = win.getBounds();
  console.log(`[MonCOM] Requested bounds: (${x}, ${y}, ${w}, ${h})`);
  console.log(`[MonCOM] Actual bounds:    (${actual.x}, ${actual.y}, ${actual.width}, ${actual.height})`);

  const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  // Capture the id now — accessing win.webContents inside the 'closed' handler
  // throws "Object has been destroyed".
  const wcId = win.webContents.id;
  zoneUrlByWebContentsId.set(wcId, normalizedUrl);
  win.loadURL(normalizedUrl);
  win.removeMenu();

  // Hide scrollbars visually but keep scrolling functional
  const scrollbarCSS = `::-webkit-scrollbar { display: none !important; }
    html, body { scrollbar-width: none !important; }`;

  // zoomFactor resets on every navigation, so re-apply on every load.
  const applyPersistedZoom = () => {
    const stored = getZoomForUrl(normalizedUrl);
    win.webContents.setZoomFactor(stored);
  };

  // Safety: never let the caller hang if the page never finishes loading.
  const loginSafety = setTimeout(settleLogin, 25000);

  let firstLoad = true;
  win.webContents.on('did-finish-load', async () => {
    win.webContents.insertCSS(scrollbarCSS);
    applyPersistedZoom();
    // Run auto-login once, after the initial page settles (not on later navigations).
    if (firstLoad) {
      firstLoad = false;
      if (webLogin && webLogin.length > 0) {
        try { await runWebLogin(win.webContents, webLogin); }
        catch (e) { console.error('[MonCOM] webLogin failed:', e); }
      }
      clearTimeout(loginSafety);
      settleLogin();
    }
  });
  win.webContents.on('did-navigate', () => {
    win.webContents.insertCSS(scrollbarCSS);
    applyPersistedZoom();
  });

  launchedWindows.push(win);

  win.on('closed', () => {
    clearTimeout(loginSafety);
    settleLogin();
    zoneUrlByWebContentsId.delete(wcId);
    const idx = launchedWindows.indexOf(win);
    if (idx >= 0) launchedWindows.splice(idx, 1);
  });

  console.log(`[MonCOM] Opened URL zone: ${url} at (${x}, ${y}, ${w}, ${h})`);
  return loginDone;
}

// ─── App zones: launch exe + move via native Win32 ───

/**
 * Resolve which window an app launch should position.
 *
 * Phase 1 default: wait for a *new* window (not present before launch) belonging
 * to the launched exe; if the launcher spawns a differently-named process, accept
 * any new titled window. This is the seam the future App Profiles step replaces —
 * a profile supplies its own multi-step matcher sequence (e.g. DSS: ack a warning
 * dialog → wait for the login window → position the real window). The contract is
 * just: given the pre-launch window set, return the WindowInfo to position.
 */
async function resolveTargetWindow(
  exeName: string,
  before: Set<number>,
  timeoutMs: number,
): Promise<WindowInfo | null> {
  const isNew: WindowMatcher = (w) => !before.has(w.hwnd);
  const isNewFromExe: WindowMatcher = (w) => isNew(w) && !!exeName && w.processName === exeName;

  // Prefer a new window from the target process…
  const fromExe = await waitForWindow(isNewFromExe, { timeoutMs, intervalMs: 250 });
  if (fromExe) return fromExe;
  // …otherwise accept any new titled window that appeared (covers launcher shims).
  return waitForWindow(isNew, { timeoutMs: 3000, intervalMs: 250 });
}

/**
 * Launch an application and position its window.
 * Returns the owned window (hwnd/pid) on success so the caller can track it for close.
 */
async function launchAppZone(
  target: string,
  label: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<{ success: boolean; error?: string; hwnd?: number; pid?: number }> {
  // Snapshot windows before launch to distinguish "new window" from single-instance reuse.
  const before = new Set(enumWindows({ requireTitle: false }).map((wi) => wi.hwnd));
  const exeName = normalizeExe(target);
  console.log(`[MonCOM] Launching app: ${target} (${before.size} existing windows)`);

  const settings = loadSettings();
  const elevated = isProcessElevated();
  const runAsUac = settings.runAsAdmin && !elevated;

  try {
    if (runAsUac) {
      // MonCOM is not elevated but the user wants an elevated launch — RunAs triggers UAC.
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Start-Process -FilePath '${target.replace(/'/g, "''")}' -Verb RunAs`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      console.log('[MonCOM] Launched with RunAs (UAC prompt expected — MonCOM is not elevated)');
    } else {
      // Either runAsAdmin is off, or MonCOM is already elevated (child inherits elevation).
      const child = spawn('cmd.exe', ['/c', 'start', '', target], {
        detached: true, stdio: 'ignore', shell: false,
      });
      child.unref();
    }
  } catch (e) {
    console.error('[MonCOM] App launch failed:', e);
    return { success: false, error: `Application launch failed: ${target}` };
  }

  // If an App Profile matches this exe, run its launch recipe (acks warning
  // dialogs, waits through login windows, etc.) and position the window it
  // designates. The default path below remains the fallback if it can't resolve.
  const profile = findProfileForExe(exeName);
  if (profile) {
    console.log(`[MonCOM] Using app profile: ${profile.name}`);
    const profileTarget = await runProfile(profile, before);
    if (profileTarget) {
      const moved = moveWindowToVisibleRect(profileTarget.hwnd, x, y, w, h, { foreground: true });
      if (moved) return { success: true, hwnd: profileTarget.hwnd, pid: profileTarget.pid };
      console.log('[MonCOM] Profile target move failed (UIPI?); falling back to default.');
    } else {
      console.warn('[MonCOM] Profile resolved no target window; falling back to default.');
    }
  }

  // Allow extra time when a UAC prompt is in the path.
  const timeoutMs = runAsUac ? 22000 : 12000;
  const target1 = await resolveTargetWindow(exeName, before, timeoutMs);

  if (target1) {
    console.log(`[MonCOM] Positioning new window hwnd=${target1.hwnd} (${target1.processName} "${target1.title}")`);
    const moved = moveWindowToVisibleRect(target1.hwnd, x, y, w, h, { foreground: true });
    if (moved) return { success: true, hwnd: target1.hwnd, pid: target1.pid };
    console.log('[MonCOM] Move failed (likely UIPI: target window is elevated and MonCOM is not).');
  }

  // Single-instance strategy: no new window appeared (Spotify/Discord/Teams style) —
  // reposition an existing window of the same process instead of failing.
  if (exeName) {
    const existing = enumWindows().filter((wi) => wi.processName === exeName);
    if (existing.length > 0) {
      // Prefer a window that wasn't there before launch, then lowest pid for stability.
      existing.sort((a, b) => {
        const an = before.has(a.hwnd) ? 1 : 0;
        const bn = before.has(b.hwnd) ? 1 : 0;
        return an - bn || a.pid - b.pid || a.hwnd - b.hwnd;
      });
      const reuse = existing[0];
      console.log(`[MonCOM] Single-instance reuse: ${reuse.processName} hwnd=${reuse.hwnd}`);
      const moved = moveWindowToVisibleRect(reuse.hwnd, x, y, w, h, { foreground: true });
      if (moved) {
        // Only track (for close) windows that genuinely appeared from this launch.
        return before.has(reuse.hwnd)
          ? { success: true }
          : { success: true, hwnd: reuse.hwnd, pid: reuse.pid };
      }
    }
  }

  // Fallback: title/label substring match across current windows.
  const hints = [label, exeName].filter((s): s is string => !!s);
  for (const hint of hints) {
    const moved = await moveWindowByTitle(hint, x, y, w, h);
    if (moved) {
      console.log(`[MonCOM] App title match succeeded for "${hint}"`);
      return { success: true };
    }
  }

  console.log('[MonCOM] App positioning failed');
  return {
    success: false,
    error: `Application launched but MonCOM could not find/position its window: ${target}`,
  };
}

/** Move the first window whose title or process name contains `hint` (case-insensitive). */
async function moveWindowByTitle(hint: string, x: number, y: number, w: number, h: number): Promise<boolean> {
  const needle = hint.toLowerCase();
  const match = enumWindows().find(
    (wi) => wi.title.toLowerCase().includes(needle) || wi.processName.includes(needle),
  );
  if (!match) return false;
  return moveWindowToVisibleRect(match.hwnd, x, y, w, h, { foreground: true });
}

// ─── Main orchestration ───

/**
 * Launch a zone's content and position it.
 */
async function launchZoneContent(zone: Zone, monitors: any[]): Promise<LaunchZoneResult> {
  if (!zone.content) {
    return { success: false, zoneId: zone.id, error: 'Zone has no content assigned' };
  }
  const content = zone.content;

  const monitor = monitors.find((m: any) => m.id === zone.monitorId);
  if (!monitor) {
    console.error(`[MonCOM] Monitor not found: ${zone.monitorId}`);
    return {
      success: false,
      zoneId: zone.id,
      contentType: content.type,
      target: content.target,
      error: `Zone's monitor isn't connected (saved as ${zone.monitorId}). Re-assign it in the Layout Editor.`,
    };
  }

  const absX = Math.round(monitor.x + zone.x * monitor.width);
  const absY = Math.round(monitor.y + zone.y * monitor.height);
  const absW = Math.round(zone.width * monitor.width);
  const absH = Math.round(zone.height * monitor.height);

  console.log(`[MonCOM] Zone: ${content.type} "${content.target}" → (${absX}, ${absY}, ${absW}, ${absH})`);

  let urlLoginDone: Promise<void> | undefined;
  if (content.type === 'url') {
    urlLoginDone = launchURLZone(content.target, absX, absY, absW, absH, content.webLogin);
  } else if (content.type === 'application') {
    const appLaunch = await launchAppZone(content.target, content.label, absX, absY, absW, absH);
    if (!appLaunch.success) {
      return {
        success: false,
        zoneId: zone.id,
        contentType: content.type,
        target: content.target,
        error: appLaunch.error ?? 'Application launch failed',
      };
    }
    if (appLaunch.hwnd) launchedAppWindows.set(appLaunch.hwnd, appLaunch.pid ?? 0);
  }

  // Play automation actions if configured
  if (content.actions && content.actions.length > 0) {
    // For URL zones, wait until the page loaded and web-login finished so
    // coordinate automation runs *after* login; otherwise use a fixed buffer.
    if (urlLoginDone) await urlLoginDone;
    else await sleep(1500);
    const extraDelay = content.launchDelay ?? 0;
    if (extraDelay > 0) {
      console.log(`[MonCOM] Waiting extra ${extraDelay}ms buffer for content to settle`);
      await sleep(extraDelay);
    }
    console.log(`[MonCOM] Playing ${content.actions.length} automation actions`);
    const playbackOk = await playActions(content.actions, zone, monitors);
    if (!playbackOk) {
      return {
        success: false,
        zoneId: zone.id,
        contentType: content.type,
        target: content.target,
        error: 'Content launched but automation playback failed',
      };
    }
  }

  return { success: true, zoneId: zone.id, contentType: content.type, target: content.target };
}

/** Force-kill a process tree (rare fallback when a window won't close gracefully). */
function forceKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    const child = spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', windowsHide: true });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

/**
 * Close a launched app window: post WM_CLOSE, wait briefly, then force-kill if needed.
 */
async function closeAppWindow(hwnd: number, pid: number): Promise<AppCloseResult> {
  if (!isWindow(hwnd)) return { hwnd, status: 'gone' };
  postClose(hwnd);
  // Wait up to ~1.2s for a graceful close.
  for (let i = 0; i < 6; i++) {
    await sleep(200);
    if (!isWindow(hwnd)) return { hwnd, status: 'closed' };
  }
  // Still open — force kill the process tree.
  if (pid) {
    await forceKill(pid);
    await sleep(250);
    if (!isWindow(hwnd)) return { hwnd, status: 'killed' };
    return { hwnd, status: 'failed', reason: 'window survived taskkill' };
  }
  return { hwnd, status: 'failed', reason: 'no pid available to force-kill' };
}

/**
 * Close all launched zones.
 */
async function closeAllZones(): Promise<CloseAllZonesReport> {
  const report: CloseAllZonesReport = {
    electronWindowsClosed: 0,
    appWindowsAttempted: launchedAppWindows.size,
    appWindowsClosedGracefully: 0,
    appWindowsForceKilled: 0,
    appWindowsAlreadyGone: 0,
    appWindowsFailed: [],
  };

  // Close Electron windows (URLs)
  for (const win of [...launchedWindows]) {
    if (!win.isDestroyed()) {
      win.close();
      report.electronWindowsClosed += 1;
    }
  }
  launchedWindows.length = 0;

  // Close tracked app windows (graceful then force)
  const entries = [...launchedAppWindows.entries()];
  const closeResults = await Promise.all(entries.map(([hwnd, pid]) => closeAppWindow(hwnd, pid)));
  for (const result of closeResults) {
    if (result.status === 'closed') report.appWindowsClosedGracefully += 1;
    else if (result.status === 'killed') report.appWindowsForceKilled += 1;
    else if (result.status === 'gone') report.appWindowsAlreadyGone += 1;
    else report.appWindowsFailed.push({ hwnd: String(result.hwnd), reason: result.reason ?? 'Unknown close failure' });
  }
  launchedAppWindows.clear();
  return report;
}

/**
 * Get list of open windows with titles (used by the FIND_WINDOWS IPC).
 */
function findWindows(): { title: string; pid: number; exe: string; className: string }[] {
  return enumWindows().map((wi) => ({ title: wi.title, pid: wi.pid, exe: wi.processName, className: wi.className }));
}

function hasLaunchedWindows(): boolean {
  const hasElectronWindows = launchedWindows.some(w => !w.isDestroyed());
  return hasElectronWindows || launchedAppWindows.size > 0;
}

export function registerWindowHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IPC.LAUNCH_ZONE, async (_event, zone: Zone, monitors: any[]) => {
    return launchZoneContent(zone, monitors);
  });

  ipcMain.handle(IPC.MOVE_WINDOW, async (_event, titleHint: string, x: number, y: number, w: number, h: number) => {
    return moveWindowByTitle(titleHint, x, y, w, h);
  });

  ipcMain.handle(IPC.CLOSE_ALL_ZONES, async () => {
    return closeAllZones();
  });

  ipcMain.handle(IPC.FIND_WINDOWS, async () => {
    return findWindows();
  });

  ipcMain.handle(IPC.APPLY_PRESET, async (_event, preset: any) => {
    return applyPresetFromMain(preset, screen);
  });

  ipcMain.handle(IPC.HAS_LAUNCHED_WINDOWS, () => {
    return hasLaunchedWindows();
  });

  ipcMain.on(IPC.ZONE_ZOOM_STEP, (event, delta: number) => {
    const wc = event.sender;
    const url = zoneUrlByWebContentsId.get(wc.id);
    if (!url) return;
    const direction: 1 | -1 = delta > 0 ? 1 : -1;
    const current = wc.getZoomFactor();
    const next = stepZoom(current, direction);
    if (next !== current) {
      wc.setZoomFactor(next);
      setZoomForUrl(url, next);
    }
  });

  ipcMain.on(IPC.ZONE_ZOOM_RESET, (event) => {
    const wc = event.sender;
    const url = zoneUrlByWebContentsId.get(wc.id);
    if (!url) return;
    wc.setZoomFactor(ZOOM_DEFAULT);
    setZoomForUrl(url, ZOOM_DEFAULT);
  });

  ipcMain.on(IPC.ZONE_TOGGLE_DEVTOOLS, (event) => {
    const wc = event.sender;
    if (!zoneUrlByWebContentsId.has(wc.id)) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  });
}

let applyCount = 0;

/** Increments on every apply, so a deferred auto-launch can tell it was superseded. */
export function getApplyCount(): number {
  return applyCount;
}

/**
 * Apply a preset directly from the main process (used by IPC and auto-launch).
 */
export async function applyPresetFromMain(preset: any, screenModule: Electron.Screen): Promise<ApplyPresetResult> {
  applyCount++;
  let closeReport: CloseAllZonesReport | undefined;
  // Close any existing launched windows first
  if (hasLaunchedWindows()) {
    closeReport = await closeAllZones();
  }

  const monitors = getStableMonitors(screenModule);

  const zones = resolveZoneMonitors(preset.layout.zones, monitors);

  const results: LaunchZoneResult[] = [];
  for (const zone of zones) {
    if (zone.content) {
      const launchResult = await launchZoneContent(zone, monitors);
      results.push(launchResult);
    }
  }
  const failedZones = results.filter(r => !r.success);
  const closeFailed = (closeReport?.appWindowsFailed.length ?? 0) > 0;

  return {
    success: failedZones.length === 0 && !closeFailed,
    results,
    failedZones,
    closeReport,
  };
}
