/**
 * Input recorder host: a child process that owns the global low-level hooks and
 * streams every input event to its parent as JSON lines on stdout.
 *
 * Spawned as MonCOM's own binary with ELECTRON_RUN_AS_NODE=1, so it is plain
 * Node with koffi available — no PowerShell, no runtime C# compile, nothing for
 * a locked-down machine to block beyond the app itself.
 *
 * Why a separate process rather than hooking from the main process: Windows
 * calls a low-level hook proc on the thread that installed it, only while that
 * thread pumps messages, and silently drops the event if the proc doesn't
 * return within LowLevelHooksTimeout (~300ms). Here the thread does nothing but
 * sit in a blocking GetMessage, so the callback always fires inside an active
 * koffi FFI call on the same thread (koffi's unambiguous callback path) and is
 * never delayed by main-process work. A fault in hook code also can't take the
 * app down with it.
 *
 * Emits absolute screen coordinates only. All zone and bounds logic lives in
 * automation-manager.ts so it can be changed without touching hook code.
 */
import * as fs from 'fs';
import koffi from 'koffi';

/** Load a system library, reporting failure on the event protocol rather than as a raw crash. */
function loadLib(name: string): ReturnType<typeof koffi.load> {
  try {
    return koffi.load(name);
  } catch (e) {
    emit({ type: 'error', message: `Could not load ${name}: ${e instanceof Error ? e.message : String(e)}` });
    return process.exit(1);
  }
}

const user32 = loadLib('user32.dll');
const kernel32 = loadLib('kernel32.dll');

const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });

const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt: POINT, mouseData: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr',
});
const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr',
});
// Trailing lPrivate guards against SDK variants of MSG that carry an extra DWORD.
const MSG = koffi.struct('MSG', {
  hwnd: 'intptr_t', message: 'uint32', wParam: 'uintptr', lParam: 'intptr_t',
  time: 'uint32', pt: POINT, lPrivate: 'uint32',
});

const LowLevelProc = koffi.proto('intptr_t LowLevelProc(int nCode, uintptr_t wParam, void *lParam)');

const SetWindowsHookExW = user32.func('intptr_t SetWindowsHookExW(int idHook, void *proc, intptr_t hMod, uint32 threadId)');
const CallNextHookEx = user32.func('intptr_t CallNextHookEx(intptr_t hhk, int nCode, uintptr_t wParam, void *lParam)');
const GetMessageW = user32.func('int GetMessageW(_Out_ MSG *msg, intptr_t hwnd, uint32 min, uint32 max)');
const GetCursorPos = user32.func('bool GetCursorPos(_Out_ POINT *pt)');
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vk)');
const WindowFromPoint = user32.func('intptr_t WindowFromPoint(POINT pt)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
const SetTimer = user32.func('uintptr_t SetTimer(intptr_t hwnd, uintptr_t id, uint32 ms, void *proc)');
const GetModuleHandleW = kernel32.func('intptr_t GetModuleHandleW(void *name)');
const GetLastError = kernel32.func('uint32 GetLastError()');

const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
const WM_LBUTTONDOWN = 0x0201;
const WM_RBUTTONDOWN = 0x0204;
const WM_MOUSEWHEEL = 0x020a;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;

const VK_SHIFT = 0x10, VK_CTRL = 0x11, VK_ALT = 0x12, VK_LWIN = 0x5b, VK_RWIN = 0x5c;

function emit(event: Record<string, unknown>): void {
  // writeSync, not stdout.write: the event loop never runs while parked in GetMessage, so a queued write would never flush.
  try { fs.writeSync(1, JSON.stringify(event) + '\n'); } catch { /* parent gone */ }
}

function isModifierVk(vk: number): boolean {
  return vk === VK_SHIFT || vk === VK_CTRL || vk === VK_ALT || vk === VK_LWIN || vk === VK_RWIN
    || (vk >= 0xa0 && vk <= 0xa5);
}

function heldModifiers(): string[] {
  const held: string[] = [];
  if (GetAsyncKeyState(VK_CTRL) & 0x8000) held.push('ctrl');
  if (GetAsyncKeyState(VK_ALT) & 0x8000) held.push('alt');
  if (GetAsyncKeyState(VK_SHIFT) & 0x8000) held.push('shift');
  if ((GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000)) held.push('win');
  return held;
}

function cursorPos(): { x: number; y: number } {
  const pt: any = { x: 0, y: 0 };
  GetCursorPos(pt);
  return { x: pt.x, y: pt.y };
}

/** Owning pid of the window under a screen point — lets the parent tell its own clicks apart. */
function pidAt(x: number, y: number): number {
  const hwnd = WindowFromPoint({ x, y });
  if (!hwnd) return 0;
  const out: [number] = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0];
}

function wheelNotches(mouseData: number): number {
  const raw = (mouseData >>> 16) & 0xffff;
  return (raw > 0x7fff ? raw - 0x10000 : raw) / 120;
}

let mouseHook = 0;
let keyHook = 0;

const mouseCallback = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
  if (nCode >= 0) {
    const info: any = koffi.decode(lParam, MSLLHOOKSTRUCT);
    const { x, y } = info.pt;
    if (wParam === WM_LBUTTONDOWN || wParam === WM_RBUTTONDOWN) {
      emit({
        type: 'click',
        button: wParam === WM_RBUTTONDOWN ? 'right' : 'left',
        x, y, pid: pidAt(x, y), t: Date.now(),
      });
    } else if (wParam === WM_MOUSEWHEEL) {
      emit({ type: 'scroll', x, y, notches: wheelNotches(info.mouseData), pid: pidAt(x, y), t: Date.now() });
    }
  }
  return CallNextHookEx(mouseHook, nCode, wParam, lParam);
}, koffi.pointer(LowLevelProc));

const keyCallback = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
  if (nCode >= 0 && (wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN)) {
    const info: any = koffi.decode(lParam, KBDLLHOOKSTRUCT);
    // Standalone modifier presses are folded into the next real key instead.
    if (!isModifierVk(info.vkCode)) {
      const { x, y } = cursorPos();
      emit({ type: 'key', vkCode: info.vkCode, modifiers: heldModifiers(), x, y, pid: pidAt(x, y), t: Date.now() });
    }
  }
  return CallNextHookEx(keyHook, nCode, wParam, lParam);
}, koffi.pointer(LowLevelProc));

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function main(): void {
  const hMod = GetModuleHandleW(null);

  mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, hMod, 0);
  if (!mouseHook) {
    emit({ type: 'error', message: `mouse hook rejected by Windows (error ${GetLastError()})` });
    process.exit(1);
  }
  keyHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyCallback, hMod, 0);
  if (!keyHook) {
    emit({ type: 'error', message: `keyboard hook rejected by Windows (error ${GetLastError()})` });
    process.exit(1);
  }

  emit({ type: 'ready', pid: process.pid });

  // Wakes the pump periodically so an orphan can't sit on global hooks forever.
  const parentPid = Number(process.argv[2] ?? 0);
  SetTimer(0, 0, 5000, null);

  const msg: any = { hwnd: 0, message: 0, wParam: 0, lParam: 0, time: 0, pt: { x: 0, y: 0 }, lPrivate: 0 };
  while (GetMessageW(msg, 0, 0, 0) > 0) { // hook procs fire from inside this call
    if (parentPid && !isAlive(parentPid)) break;
  }
}

try {
  main();
} catch (e) {
  emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
