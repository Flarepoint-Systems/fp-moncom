import { describe, it, expect } from 'vitest';
import { resolveZoneMonitors, rematchMonitor } from './monitor-rematch';
import type { Zone } from '../shared/types';

const mon = (id: string, x: number, y: number) => ({ id, x, y, width: 1920, height: 1080 });
const zone = (id: string, monitorId: string, bounds?: { x: number; y: number }): Zone => ({
  id, monitorId, x: 0, y: 0, width: 1, height: 1, content: null,
  monitorBounds: bounds ? { ...bounds, width: 1920, height: 1080 } : undefined,
});

describe('rematchMonitor', () => {
  it('returns null without saved bounds', () => {
    expect(rematchMonitor(zone('z', 'old'), [mon('a', 0, 0)])).toBeNull();
  });
  it('returns the monitor the saved center falls on', () => {
    expect(rematchMonitor(zone('z', 'old', { x: 1920, y: 0 }), [mon('a', 0, 0), mon('b', 1920, 0)])?.id).toBe('b');
  });
  it('returns null when the nearest monitor does not contain the saved center', () => {
    expect(rematchMonitor(zone('z', 'old', { x: 5000, y: 0 }), [mon('a', 0, 0)])).toBeNull();
  });
});

describe('resolveZoneMonitors', () => {
  it('leaves connected ids alone', () => {
    const z = zone('z', 'a');
    expect(resolveZoneMonitors([z], [mon('a', 0, 0)])[0]).toBe(z);
  });
  it('remaps a stale id by saved bounds', () => {
    const out = resolveZoneMonitors([zone('z', 'old', { x: 1920, y: 0 })], [mon('a', 0, 0), mon('b', 1920, 0)]);
    expect(out[0].monitorId).toBe('b');
  });
  it('maps every zone of one stale monitor to the same new monitor', () => {
    const out = resolveZoneMonitors(
      [zone('z1', 'old', { x: 1920, y: 0 }), zone('z2', 'old', { x: 1920, y: 0 })],
      [mon('a', 0, 0), mon('b', 1920, 0)],
    );
    expect(out.map(z => z.monitorId)).toEqual(['b', 'b']);
  });
  it('never collapses two stale monitors onto one current monitor', () => {
    const out = resolveZoneMonitors(
      [zone('z1', 'old1', { x: 0, y: 0 }), zone('z2', 'old2', { x: 0, y: 0 })],
      [mon('a', 0, 0)],
    );
    expect(out[0].monitorId).toBe('a');
    expect(out[1].monitorId).toBe('old2');
  });
  it('keeps the saved id when nothing matches', () => {
    expect(resolveZoneMonitors([zone('z', 'old', { x: 9000, y: 0 })], [mon('a', 0, 0)])[0].monitorId).toBe('old');
  });
});
