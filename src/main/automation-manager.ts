import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import type { AutomationAction, KeyModifier, RecordingStatus, StartRecordingResult, Zone } from '../shared/types';
import * as input from './input';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long the recorder host gets to install its hooks before we call it dead. */
const HOST_READY_TIMEOUT_MS = 10000;

let recordingProcess: ChildProcess | null = null;
let recordedActions: AutomationAction[] = [];
/** Per-action capture metadata, index-aligned with `recordedActions`. Not persisted. */
let recordedMeta: { pid: number; insideZone: boolean }[] = [];

/** Calculate absolute pixel bounds for a zone given its monitor info */
function getZoneBounds(zone: Zone, monitors: any[]): { x: number; y: number; w: number; h: number } {
  const monitor = monitors.find((m: any) => m.id === zone.monitorId);
  if (!monitor) throw new Error(`Monitor not found: ${zone.monitorId}`);
  return {
    x: Math.round(monitor.x + zone.x * monitor.width),
    y: Math.round(monitor.y + zone.y * monitor.height),
    w: Math.round(zone.width * monitor.width),
    h: Math.round(zone.height * monitor.height),
  };
}

// ─── Recording ───

/** One JSON line from the recorder host. Coordinates are absolute screen pixels. */
interface HostEvent {
  type: 'ready' | 'error' | 'click' | 'scroll' | 'key';
  message?: string;
  button?: 'left' | 'right';
  x?: number;
  y?: number;
  notches?: number;
  vkCode?: number;
  modifiers?: string[];
  pid?: number;
  t?: number;
}

/**
 * Start recording input within a zone's bounds.
 *
 * Every event is kept, whether or not it lands inside the zone — a click that
 * falls outside still replays at the right place (the zone rect is only a
 * coordinate frame), and silently dropping them is what made a failed recording
 * indistinguishable from a working one. `onStatus` reports live counts so the
 * UI can show that capture is actually happening.
 */
export function startRecording(
  zone: Zone,
  monitors: any[],
  onStatus?: (status: RecordingStatus) => void,
): Promise<StartRecordingResult> {
  if (recordingProcess) {
    return Promise.resolve({ ok: false as const, error: 'A recording is already in progress.' });
  }

  const bounds = getZoneBounds(zone, monitors);
  recordedActions = [];
  recordedMeta = [];

  const hostPath = path.join(__dirname, 'recorder-host.js');
  const child = spawn(process.execPath, [hostPath, String(process.pid)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  return new Promise<StartRecordingResult>((resolve) => {
    let settled = false;
    let stderr = '';
    let lastEventTime = 0;
    let outsideZone = 0;

    const finish = (result: StartRecordingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      if (!result.ok) {
        if (recordingProcess === child) recordingProcess = null;
        child.kill();
      }
      resolve(result);
    };

    const readyTimer = setTimeout(() => {
      finish({ ok: false, error: `Recorder did not start within ${HOST_READY_TIMEOUT_MS / 1000}s.` });
    }, HOST_READY_TIMEOUT_MS);

    const handleEvent = (event: HostEvent) => {
      if (event.type === 'ready') {
        console.log('[MonCOM] Recorder host ready');
        recordingProcess = child;
        finish({ ok: true });
        return;
      }
      if (event.type === 'error') {
        console.error('[MonCOM] Recorder host error:', event.message);
        finish({ ok: false, error: event.message ?? 'Recorder failed to start.' });
        return;
      }

      const x = event.x ?? 0;
      const y = event.y ?? 0;
      const insideZone = x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h;
      if (!insideZone) outsideZone++;

      const now = event.t ?? Date.now();
      const delay = recordedActions.length === 0 ? 0 : Math.max(0, now - lastEventTime);
      lastEventTime = now;

      const relX = (x - bounds.x) / bounds.w;
      const relY = (y - bounds.y) / bounds.h;

      let action: AutomationAction | null = null;
      if (event.type === 'click') {
        action = { type: event.button === 'right' ? 'right-click' : 'click', x: relX, y: relY, delay };
      } else if (event.type === 'scroll') {
        action = { type: 'scroll', x: relX, y: relY, deltaY: event.notches ?? 0, delay };
      } else if (event.type === 'key') {
        action = { type: 'key', vkCode: event.vkCode ?? 0, delay };
        if (event.modifiers && event.modifiers.length > 0) {
          action.modifiers = event.modifiers as KeyModifier[];
        }
      }
      if (!action) return;

      recordedActions.push(action);
      recordedMeta.push({ pid: event.pid ?? 0, insideZone });
      onStatus?.({ captured: recordedActions.length, outsideZone, lastType: action.type });
    };

    let buffer = '';
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleEvent(JSON.parse(trimmed) as HostEvent);
        } catch {
          console.error('[MonCOM] Unparseable recorder line:', trimmed);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (!msg) return;
      stderr += `${msg}\n`;
      console.error('[MonCOM] Recorder stderr:', msg);
    });

    child.on('error', (err) => {
      console.error('[MonCOM] Recorder spawn failed:', err);
      finish({ ok: false, error: `Recorder could not be started: ${err.message}` });
    });

    child.on('close', (code) => {
      console.log(`[MonCOM] Recorder host exited with code ${code}`);
      const wasRecording = recordingProcess === child;
      if (wasRecording) recordingProcess = null;
      // Exit before ready means startup failed; exit after means it died mid-session.
      finish({ ok: false, error: stderr.trim() || `Recorder exited with code ${code}.` });
      if (wasRecording) {
        onStatus?.({
          captured: recordedActions.length,
          outsideZone,
          error: stderr.trim() || `Recorder stopped unexpectedly (exit code ${code}).`,
        });
      }
    });
  });
}

/**
 * Stop recording and return the captured actions.
 */
export function stopRecording(): AutomationAction[] {
  if (recordingProcess) {
    recordingProcess.kill();
    recordingProcess = null;
  } else if (recordedActions.length === 0) {
    console.log('[MonCOM] No recording in progress');
    return [];
  }

  const actions = [...recordedActions];
  const meta = [...recordedMeta];
  recordedActions = [];
  recordedMeta = [];

  // A trailing click on MonCOM itself is the user pressing "Stop Recording", not part of the sequence.
  const lastIndex = actions.length - 1;
  if (lastIndex >= 0) {
    const last = actions[lastIndex];
    const isClick = last.type === 'click' || last.type === 'right-click';
    if (isClick && meta[lastIndex]?.pid === process.pid) {
      actions.pop();
    }
  }

  console.log(`[MonCOM] Recording stopped, captured ${actions.length} actions`);
  return actions;
}

/**
 * Check if recording is currently active.
 */
export function isRecording(): boolean {
  return recordingProcess !== null;
}

// ─── Playback ───

/**
 * Play back automation actions within a zone's bounds using the native input
 * module. `startIndex` supports "test from step N" (skips earlier actions).
 */
export async function playActions(
  actions: AutomationAction[],
  zone: Zone,
  monitors: any[],
  startIndex = 0,
): Promise<boolean> {
  if (!actions || actions.length === 0) return true;
  const bounds = getZoneBounds(zone, monitors);

  try {
    for (let i = Math.max(0, startIndex); i < actions.length; i++) {
      const a = actions[i];
      if (a.delay > 0) await sleep(a.delay);

      const absX = Math.round(bounds.x + (a.x ?? 0) * bounds.w);
      const absY = Math.round(bounds.y + (a.y ?? 0) * bounds.h);

      switch (a.type) {
        case 'click':
        case 'right-click': {
          const button = a.type === 'right-click' ? 'right' : 'left';
          input.setCursorPos(absX, absY);
          await sleep(25);
          input.mouseButton(button, true);
          await sleep(20);
          input.mouseButton(button, false);
          break;
        }
        case 'scroll': {
          input.setCursorPos(absX, absY);
          input.mouseWheel(a.deltaY ?? 0);
          break;
        }
        case 'key': {
          input.keyTap(a.vkCode ?? 0, (a.modifiers ?? []) as KeyModifier[]);
          break;
        }
        case 'type': {
          input.typeText(a.text ?? '');
          break;
        }
      }
    }
    console.log('[MonCOM] Playback completed');
    return true;
  } catch (e) {
    console.error('[MonCOM] Playback failed:', e);
    return false;
  }
}
