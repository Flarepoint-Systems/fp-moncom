import type { Zone } from '../shared/types';

export type MonitorRect = { id: string; x: number; y: number; width: number; height: number };

/**
 * Pick a free monitor for a zone whose saved `monitorId` isn't connected: the
 * one nearest the saved monitor's center, but only if that center still falls
 * on it. Without saved bounds there's nothing safe to go on, so no match.
 */
export function rematchMonitor(zone: Zone, free: MonitorRect[]): MonitorRect | null {
  if (!zone.monitorBounds || free.length === 0) return null;
  const zcx = zone.monitorBounds.x + zone.monitorBounds.width / 2;
  const zcy = zone.monitorBounds.y + zone.monitorBounds.height / 2;
  let best: MonitorRect | null = null;
  let bestDist = Infinity;
  for (const m of free) {
    const dist = Math.hypot(m.x + m.width / 2 - zcx, m.y + m.height / 2 - zcy);
    if (dist < bestDist) { bestDist = dist; best = m; }
  }
  if (!best) return null;
  const inside = zcx >= best.x && zcx < best.x + best.width && zcy >= best.y && zcy < best.y + best.height;
  return inside ? best : null;
}

/**
 * Map zones with a stale `monitorId` onto current monitors, in memory only.
 * Each saved monitor maps to a distinct current monitor, so zones from two
 * screens never collapse onto one; unmatched zones keep their saved id and
 * fail at launch as "not connected". Never persisted: the saved preset only
 * changes when the user saves it.
 */
export function resolveZoneMonitors(zones: Zone[], monitors: MonitorRect[]): Zone[] {
  const connected = new Set(monitors.map(m => m.id));
  const claimed = new Set(zones.filter(z => connected.has(z.monitorId)).map(z => z.monitorId));
  const remap = new Map<string, MonitorRect | null>();
  for (const zone of zones) {
    if (connected.has(zone.monitorId) || remap.has(zone.monitorId)) continue;
    const match = rematchMonitor(zone, monitors.filter(m => !claimed.has(m.id)));
    remap.set(zone.monitorId, match);
    if (match) {
      claimed.add(match.id);
      console.log(`[MonCOM] Rematched monitor ${zone.monitorId} → ${match.id} (not saved)`);
    }
  }
  return zones.map(z => {
    const m = remap.get(z.monitorId);
    return m ? { ...z, monitorId: m.id } : z;
  });
}
