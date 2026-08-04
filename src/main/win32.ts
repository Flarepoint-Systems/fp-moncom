/**
 * Native Win32 window engine via koffi FFI.
 *
 * Replaces the old PowerShell + `Add-Type` path in window-manager.ts. Calling
 * user32/dwmapi/kernel32 directly from the main process means:
 *   - no per-operation process spawn (the old `getVisibleWindows` poll and every
 *     move shelled out to PowerShell, recompiling P/Invoke each time — seconds),
 *   - accurate window positioning using the *real* DWM frame insets instead of a
 *     hard-coded 8px guess, measured per-window,
 *   - a cheap `waitForWindow(matcher)` primitive that the launch engine — and the
 *     future App Profiles (DSS-style multi-window) engine — can poll tightly.
 *
 * koffi is N-API based, so the same prebuilt binary loads under both Node (dev
 * scripts) and Electron (runtime). HWND/HANDLE are pointer-sized; we marshal them
 * as `intptr_t` (plain JS numbers — real window handles fit well within 2^53).
 */
import koffi from 'koffi';
import { normalizeExe } from '../shared/exe';

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const kernel32 = koffi.load('kernel32.dll');

// RECT { LONG left, top, right, bottom }
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });

// BOOL CALLBACK EnumWindowsProc(HWND, LPARAM)
const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(intptr_t hwnd, intptr_t lparam)');

const EnumWindows = user32.func('bool EnumWindows(void *proc, intptr_t lparam)');
const IsWindowVisible = user32.func('bool IsWindowVisible(intptr_t hwnd)');
const IsWindow = user32.func('bool IsWindow(intptr_t hwnd)');
const GetWindowTextW = user32.func('int GetWindowTextW(intptr_t hwnd, void *buf, int max)');
const GetClassNameW = user32.func('int GetClassNameW(intptr_t hwnd, void *buf, int max)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
const ShowWindow = user32.func('bool ShowWindow(intptr_t hwnd, int cmd)');
const IsIconic = user32.func('bool IsIconic(intptr_t hwnd)');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(intptr_t hwnd)');
const GetWindowLongW = user32.func('int32 GetWindowLongW(intptr_t hwnd, int index)');
const PostMessageW = user32.func('bool PostMessageW(intptr_t hwnd, uint32 msg, uintptr_t wparam, intptr_t lparam)');
const GetForegroundWindow = user32.func('intptr_t GetForegroundWindow()');
const BringWindowToTop = user32.func('bool BringWindowToTop(intptr_t hwnd)');
const AttachThreadInput = user32.func('bool AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)');
const WindowFromPoint = user32.func('intptr_t WindowFromPoint(POINT pt)');
const GetAncestor = user32.func('intptr_t GetAncestor(intptr_t hwnd, uint32 flags)');

// HRESULT DwmGetWindowAttribute(HWND, DWORD, PVOID, DWORD) — bound with a RECT out-param.
const DwmGetWindowAttributeRect = dwmapi.func('int32 DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ RECT *pv, uint32 cb)');
const DwmGetWindowAttributeInt = dwmapi.func('int32 DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ int32 *pv, uint32 cb)');

const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()');
const OpenProcess = kernel32.func('intptr_t OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool CloseHandle(intptr_t h)');
const QueryFullProcessImageNameW = kernel32.func('bool QueryFullProcessImageNameW(intptr_t h, uint32 flags, void *buf, _Inout_ uint32 *size)');

// ── constants ──
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const WM_CLOSE = 0x0010;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const GA_ROOT = 2;

export interface Rect { left: number; top: number; right: number; bottom: number }

// ── physical monitor enumeration (stable hardware identity) ──
const MONITORINFOEXW = koffi.struct('MONITORINFOEXW', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
  szDevice: koffi.array('char16_t', 32),
});
const DISPLAY_DEVICEW = koffi.struct('DISPLAY_DEVICEW', {
  cb: 'uint32',
  DeviceName: koffi.array('char16_t', 32),
  DeviceString: koffi.array('char16_t', 128),
  StateFlags: 'uint32',
  DeviceID: koffi.array('char16_t', 128),
  DeviceKey: koffi.array('char16_t', 128),
});
const MonitorEnumProc = koffi.proto('bool MonitorEnumProc(intptr_t hMon, intptr_t hdc, void *lprc, intptr_t lparam)');
const EnumDisplayMonitors = user32.func('bool EnumDisplayMonitors(intptr_t hdc, void *clip, void *proc, intptr_t lparam)');
const GetMonitorInfoW = user32.func('bool GetMonitorInfoW(intptr_t hMon, _Inout_ MONITORINFOEXW *mi)');
const EnumDisplayDevicesW = user32.func('bool EnumDisplayDevicesW(str16 device, uint32 i, _Inout_ DISPLAY_DEVICEW *dd, uint32 flags)');
const MONITORINFOF_PRIMARY = 1;
const EDD_GET_DEVICE_INTERFACE_NAME = 1;

function decodeWide(v: unknown): string {
  const s = Array.isArray(v) ? String.fromCharCode(...(v as number[])) : String(v);
  return s.replace(/\0.*$/s, '');
}

export interface PhysicalMonitor {
  /** GDI device name, e.g. "\\\\.\\DISPLAY1". */
  device: string;
  /** Bounds in physical (non-DIP) pixels. */
  rect: Rect;
  primary: boolean;
  /** Stable device interface path containing the EDID hardware id + connector UID. */
  deviceId: string;
  /** Friendly monitor name (often "Generic PnP Monitor"). */
  name: string;
}

/**
 * Enumerate physical monitors with their stable hardware identity. The `deviceId`
 * (from `EnumDisplayDevices` with the interface-name flag) encodes the monitor's
 * EDID hardware id and connector UID, so it survives reboots, rearrangement,
 * resolution changes, and primary-monitor swaps — unlike Electron's `display.id`
 * or a position-derived id. Caller maps these to Electron displays by bounds.
 */
export function enumPhysicalMonitors(): PhysicalMonitor[] {
  const out: PhysicalMonitor[] = [];
  const proc = koffi.register((hMon: number) => {
    const mi: any = { cbSize: koffi.sizeof(MONITORINFOEXW) };
    if (GetMonitorInfoW(hMon, mi)) {
      const device = decodeWide(mi.szDevice);
      const dd: any = { cb: koffi.sizeof(DISPLAY_DEVICEW) };
      EnumDisplayDevicesW(device, 0, dd, EDD_GET_DEVICE_INTERFACE_NAME);
      out.push({
        device,
        rect: mi.rcMonitor,
        primary: (mi.dwFlags & MONITORINFOF_PRIMARY) === MONITORINFOF_PRIMARY,
        deviceId: decodeWide(dd.DeviceID),
        name: decodeWide(dd.DeviceString),
      });
    }
    return true;
  }, koffi.pointer(MonitorEnumProc));
  try {
    EnumDisplayMonitors(0, null, proc, 0);
  } finally {
    koffi.unregister(proc);
  }
  return out;
}

export interface WindowInfo {
  hwnd: number;
  pid: number;
  /** Lowercased executable base name without `.exe` (e.g. "spotify"), or '' if unknown. */
  processName: string;
  title: string;
  className: string;
  rect: Rect;
}

function readWide(buf: Buffer, charLen: number): string {
  return charLen > 0 ? buf.toString('ucs2', 0, charLen * 2) : '';
}

function getWindowText(hwnd: number): string {
  const buf = Buffer.alloc(1024);
  const len = GetWindowTextW(hwnd, buf, 512);
  return readWide(buf, len);
}

function getClassName(hwnd: number): string {
  const buf = Buffer.alloc(512);
  const len = GetClassNameW(hwnd, buf, 256);
  return readWide(buf, len);
}

const processNameCache = new Map<number, string>();

function getProcessName(pid: number): string {
  if (pid === 0) return '';
  const cached = processNameCache.get(pid);
  if (cached !== undefined) return cached;
  let name = '';
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    try {
      const buf = Buffer.alloc(2048);
      const size: [number] = [1024];
      if (QueryFullProcessImageNameW(h, 0, buf, size)) {
        name = normalizeExe(readWide(buf, size[0]));
      }
    } finally {
      CloseHandle(h);
    }
  }
  processNameCache.set(pid, name);
  return name;
}

function isCloaked(hwnd: number): boolean {
  const out: [number] = [0];
  const hr = DwmGetWindowAttributeInt(hwnd, DWMWA_CLOAKED, out, 4);
  return hr === 0 && out[0] !== 0;
}

/**
 * Enumerate top-level windows that a user would consider "real": visible, not a
 * tool window, not DWM-cloaked (filters ghost UWP windows), and titled. Process
 * names are resolved lazily and cached per pid.
 */
export function enumWindows(opts: { requireTitle?: boolean } = {}): WindowInfo[] {
  const requireTitle = opts.requireTitle ?? true;
  const hwnds: number[] = [];
  const cb = koffi.register((hwnd: number) => {
    hwnds.push(hwnd);
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }

  const results: WindowInfo[] = [];
  for (const hwnd of hwnds) {
    if (!IsWindowVisible(hwnd)) continue;
    const exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE) >>> 0;
    if (exStyle & WS_EX_TOOLWINDOW) continue;
    const title = getWindowText(hwnd);
    if (requireTitle && !title) continue;
    if (isCloaked(hwnd)) continue;
    const pidOut: [number] = [0];
    GetWindowThreadProcessId(hwnd, pidOut);
    const pid = pidOut[0];
    const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    GetWindowRect(hwnd, r);
    results.push({
      hwnd,
      pid,
      processName: getProcessName(pid),
      title,
      className: getClassName(hwnd),
      rect: r,
    });
  }
  return results;
}

export function isWindow(hwnd: number): boolean {
  return !!IsWindow(hwnd);
}

function threadOf(hwnd: number): number {
  const pid: [number] = [0];
  return GetWindowThreadProcessId(hwnd, pid);
}

/**
 * Single attempt at making `hwnd` the foreground window, borrowing foreground
 * rights from whoever currently holds them.
 *
 * Windows refuses SetForegroundWindow unless the calling process already owns
 * the foreground or received the last input event, which is never true when
 * MonCOM starts unattended at boot. Attaching our input queue to the current
 * foreground thread lifts that restriction for the duration of the call.
 */
function tryForeground(hwnd: number): boolean {
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  if (GetForegroundWindow() === hwnd) return true;

  const ours = GetCurrentThreadId();
  const foreground = threadOf(GetForegroundWindow());
  const target = threadOf(hwnd);
  const attachForeground = foreground !== 0 && foreground !== ours;
  const attachTarget = target !== 0 && target !== ours && target !== foreground;

  if (attachForeground) AttachThreadInput(ours, foreground, true);
  if (attachTarget) AttachThreadInput(ours, target, true);
  try {
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
  } finally {
    if (attachTarget) AttachThreadInput(ours, target, false);
    if (attachForeground) AttachThreadInput(ours, foreground, false);
  }
  return GetForegroundWindow() === hwnd;
}

/** Make a window foreground, retrying while other startup apps fight for it. Returns whether it took. */
export async function bringToForeground(hwnd: number, attempts = 5, gapMs = 250): Promise<boolean> {
  if (!IsWindow(hwnd)) return false;
  for (let i = 0; i < attempts; i++) {
    if (tryForeground(hwnd)) return true;
    await sleep(gapMs);
  }
  return GetForegroundWindow() === hwnd;
}

/** Top-level window sitting at a screen point. Child controls resolve to their root, so a hit inside a dialog counts. */
export function rootWindowAt(x: number, y: number): number {
  const hit = WindowFromPoint({ x: Math.round(x), y: Math.round(y) });
  return hit ? GetAncestor(hit, GA_ROOT) : 0;
}

/** Post a key press straight to a window, for when foreground can't be taken and SendInput would miss. */
export function postKey(hwnd: number, vkCode: number): void {
  if (!IsWindow(hwnd)) return;
  PostMessageW(hwnd, WM_KEYDOWN, vkCode, 1);
  PostMessageW(hwnd, WM_KEYUP, vkCode, 0xc0000001);
}

/** True DWM frame insets (left/top/right/bottom) between GetWindowRect and the visible frame. */
function frameInsets(hwnd: number): { left: number; top: number; right: number; bottom: number } {
  const win: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetWindowRect(hwnd, win)) return { left: 0, top: 0, right: 0, bottom: 0 };
  const ext: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const hr = DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ext, 16);
  if (hr !== 0) {
    // Fallback to the historical Win10/11 default if DWM is unavailable.
    return { left: 8, top: 0, right: 8, bottom: 8 };
  }
  return {
    left: ext.left - win.left,
    top: ext.top - win.top,
    right: win.right - ext.right,
    bottom: win.bottom - ext.bottom,
  };
}

/**
 * Position a window so its *visible* frame lands exactly at (x, y, w, h),
 * compensating for the invisible DWM resize border measured for this window.
 */
export function moveWindowToVisibleRect(
  hwnd: number,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { foreground?: boolean } = {},
): boolean {
  if (!IsWindow(hwnd)) return false;
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  const ins = frameInsets(hwnd);
  const wx = Math.round(x - ins.left);
  const wy = Math.round(y - ins.top);
  const ww = Math.round(w + ins.left + ins.right);
  const wh = Math.round(h + ins.top + ins.bottom);
  const flags = SWP_NOZORDER | (opts.foreground ? 0 : SWP_NOACTIVATE) | SWP_FRAMECHANGED;
  const ok = SetWindowPos(hwnd, 0, wx, wy, ww, wh, flags);
  if (opts.foreground) tryForeground(hwnd);
  return !!ok;
}

/** The current visible-frame rect of a window (post-move verification). */
export function getVisibleRect(hwnd: number): Rect | null {
  const ext: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const hr = DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ext, 16);
  if (hr !== 0) {
    const win: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!GetWindowRect(hwnd, win)) return null;
    return win;
  }
  return ext;
}

/** Post WM_CLOSE to a window (graceful close request). */
export function postClose(hwnd: number): boolean {
  if (!IsWindow(hwnd)) return false;
  return !!PostMessageW(hwnd, WM_CLOSE, 0, 0);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type WindowMatcher = (w: WindowInfo) => boolean;

/**
 * Poll the window list until `match` finds a window or the timeout elapses.
 * Cheap now that enumeration is a direct syscall — this is the primitive the
 * launch engine and the future App Profiles step both build on.
 */
export async function waitForWindow(
  match: WindowMatcher,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WindowInfo | null> {
  const timeoutMs = opts.timeoutMs ?? 16000;
  const intervalMs = opts.intervalMs ?? 250;
  const start = Date.now();
  for (;;) {
    const found = enumWindows().find(match);
    if (found) return found;
    if (Date.now() - start >= timeoutMs) return null;
    await sleep(intervalMs);
  }
}
