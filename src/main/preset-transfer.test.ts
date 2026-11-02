import { describe, it, expect } from 'vitest';
import { toPresetFile, parsePresetFile, planImport, applyImportPlan, PRESET_FILE_VERSION } from './preset-transfer';
import type { Preset, MonitorInfo } from '../shared/types';

const mon = (id: string, x: number): MonitorInfo => ({ id, name: id, x, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: x === 0 });
const preset = (): Preset => ({
  id: 'p', name: 'Wall', createdAt: 't', updatedAt: 't',
  layout: { id: 'l', zones: [
    { id: 'z1', monitorId: 'old-a', monitorBounds: { x: 0, y: 0, width: 1920, height: 1080 }, x: 0, y: 0, width: 1, height: 1,
      content: { type: 'url', target: 'https://x', label: 'Grafana', webLogin: [{ action: 'fill', selector: '#p', value: 'enc:v1:abc' }] } },
    { id: 'z2', monitorId: 'old-b', monitorBounds: { x: 1920, y: 0, width: 1920, height: 1080 }, x: 0, y: 0, width: 1, height: 1, content: null },
  ] },
});

describe('toPresetFile', () => {
  it('strips login values and keeps selectors', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date('2026-11-02T10:00:00Z'));
    expect(f.format).toBe('moncom-preset');
    expect(f.version).toBe(PRESET_FILE_VERSION);
    expect(f.exportedAt).toBe('2026-11-02T10:00:00.000Z');
    expect(f.preset.layout.zones[0].content!.webLogin![0]).toEqual({ action: 'fill', selector: '#p', value: '' });
  });
});

describe('parsePresetFile', () => {
  it('rejects non-JSON and foreign JSON', () => {
    expect(parsePresetFile('nope')).toEqual({ ok: false, error: 'This file is not a MonCOM preset.' });
    expect(parsePresetFile('{"hello":1}')).toEqual({ ok: false, error: 'This file is not a MonCOM preset.' });
  });
  it('rejects a newer version', () => {
    const f = { ...toPresetFile(preset(), '1.0.0', new Date()), version: PRESET_FILE_VERSION + 1 };
    expect(parsePresetFile(JSON.stringify(f))).toEqual({ ok: false, error: 'This preset was made by a newer MonCOM. Update MonCOM and try again.' });
  });
  it('rejects an incomplete preset', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date()) as any;
    delete f.preset.layout;
    expect(parsePresetFile(JSON.stringify(f))).toEqual({ ok: false, error: 'This preset file is incomplete.' });
  });
  it('round-trips a valid file', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date());
    const r = parsePresetFile(JSON.stringify(f));
    expect(r.ok && r.file.preset.name).toBe('Wall');
  });
});

describe('planImport', () => {
  it('matches by bounds and counts redacted logins', () => {
    const p = toPresetFile(preset(), '1.0.0', new Date()).preset;
    const plan = planImport(p, [mon('new-a', 0), mon('new-b', 1920)]);
    expect(plan.zones.map(z => z.targetMonitorId)).toEqual(['new-a', 'new-b']);
    expect(plan.zones[0].label).toBe('Grafana');
    expect(plan.zones[1].label).toBe('Empty');
    expect(plan.unmatched).toBe(0);
    expect(plan.redactedLogins).toBe(1);
  });
  it('lists every zone as unmatched on a different wall and still plans', () => {
    const plan = planImport(preset(), [mon('solo', 5000)]);
    expect(plan.zones.every(z => z.targetMonitorId === null)).toBe(true);
    expect(plan.unmatched).toBe(2);
  });
});

describe('applyImportPlan', () => {
  it('rewrites matched zones and keeps unmatched ones', () => {
    const mons = [mon('new-a', 0)];
    const plan = planImport(preset(), mons);
    const out = applyImportPlan(preset(), plan, mons, 'preset-9', '2026-11-02T10:00:00.000Z');
    expect(out.id).toBe('preset-9');
    expect(out.layout.id).toBe('layout-preset-9');
    expect(out.createdAt).toBe('2026-11-02T10:00:00.000Z');
    expect(out.layout.zones[0].monitorId).toBe('new-a');
    expect(out.layout.zones[0].monitorBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(out.layout.zones[1].monitorId).toBe('old-b');
  });
});
