/**
 * Startup auto-launch that waits for the preset's monitors.
 *
 * A wall PC can boot before its screens power on (e.g. a schedule that drifts
 * with DST). Launching then would stack every zone on whatever display exists,
 * so we hold the launch until every monitor the preset uses is connected.
 */
import { Notification, type Screen } from 'electron';
import type { Preset } from '../shared/types';
import { getStableMonitors } from './monitors';
import { resolveZoneMonitors } from './preset-store';
import { applyPresetFromMain, getApplyCount } from './window-manager';

const POLL_MS = 5000;
/** Displays report in one by one as they wake; give the set time to settle. */
const SETTLE_MS = 3000;
const NOTIFY_AFTER_MS = 2 * 60 * 1000;

/** Saved monitor ids of the preset's launchable zones that aren't connected right now. */
function missingMonitors(preset: Preset, screen: Screen): string[] {
  const monitors = getStableMonitors(screen);
  const connected = new Set(monitors.map(m => m.id));
  const zones = preset.layout.zones.filter(z => z.content);
  const resolved = resolveZoneMonitors(zones, monitors);
  return [...new Set(zones.filter((_, i) => !connected.has(resolved[i].monitorId)).map(z => z.monitorId))];
}

/**
 * Apply `preset` once all its monitors are connected. Waits indefinitely (the
 * screens may come on hours later) and stands down if anything else applies a
 * preset in the meantime.
 */
export function autoLaunchWhenReady(preset: Preset, screen: Screen): void {
  const startedAt = Date.now();
  const startCount = getApplyCount();
  let notified = false;
  let settling = false;
  let done = false;

  const stop = () => {
    done = true;
    clearInterval(poll);
    screen.off('display-added', check);
    screen.off('display-removed', check);
    screen.off('display-metrics-changed', check);
  };

  function check(): void {
    if (done || settling) return;
    if (getApplyCount() !== startCount) {
      console.log('[MonCOM] Auto-launch superseded by a manual apply');
      stop();
      return;
    }
    const missing = missingMonitors(preset, screen);
    if (missing.length > 0) {
      if (!notified && Date.now() - startedAt > NOTIFY_AFTER_MS) {
        notified = true;
        console.log(`[MonCOM] Auto-launch waiting for ${missing.length} monitor(s): ${missing.join(', ')}`);
        if (Notification.isSupported()) {
          new Notification({
            title: 'MonCOM is waiting for monitors',
            body: `"${preset.name}" will launch once ${missing.length} more monitor(s) are connected.`,
          }).show();
        }
      }
      return;
    }
    settling = true;
    setTimeout(() => {
      settling = false;
      if (done) return;
      if (getApplyCount() !== startCount) { check(); return; }
      if (missingMonitors(preset, screen).length > 0) return;
      stop();
      console.log(`[MonCOM] Auto-launching preset: ${preset.name}`);
      applyPresetFromMain(preset, screen).catch((err) =>
        console.error('[MonCOM] Auto-launch failed:', err),
      );
    }, SETTLE_MS);
  }

  const poll = setInterval(check, POLL_MS);
  screen.on('display-added', check);
  screen.on('display-removed', check);
  screen.on('display-metrics-changed', check);
  check();
}
