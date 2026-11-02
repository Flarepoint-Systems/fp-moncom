import { describe, it, expect } from 'vitest';
import { sealValue, unsealValue, sealPreset, unsealZone, type SecretCodec } from './secrets';
import { isSealed, SECRET_PREFIX } from '../shared/secrets';
import type { Preset } from '../shared/types';

const codec: SecretCodec = {
  available: () => true,
  encrypt: (p) => Buffer.from([...Buffer.from(p, 'utf8')].map(b => b ^ 0x5a)),
  decrypt: (d) => Buffer.from([...d].map(b => b ^ 0x5a)).toString('utf8'),
};
const offline: SecretCodec = { ...codec, available: () => false };

const preset = (): Preset => ({
  id: 'p', name: 'Wall', createdAt: 't', updatedAt: 't',
  layout: { id: 'l', zones: [{
    id: 'z', monitorId: 'm', x: 0, y: 0, width: 1, height: 1,
    content: { type: 'url', target: 'https://x', label: 'X', webLogin: [
      { action: 'waitFor', selector: '#user' },
      { action: 'fill', selector: '#user', value: 'alice' },
      { action: 'fill', selector: '#pass', value: 'hunter2' },
      { action: 'click', selector: '#go' },
    ] },
  }] },
});

describe('sealValue / unsealValue', () => {
  it('round-trips', () => {
    const s = sealValue(codec, 'hunter2');
    expect(s.startsWith(SECRET_PREFIX)).toBe(true);
    expect(isSealed(s)).toBe(true);
    expect(unsealValue(codec, s)).toBe('hunter2');
  });
  it('does not seal twice', () => {
    const once = sealValue(codec, 'x');
    expect(sealValue(codec, once)).toBe(once);
  });
  it('leaves plain text when codec unavailable', () => {
    expect(sealValue(offline, 'x')).toBe('x');
  });
  it('returns empty string when a sealed value cannot be unsealed', () => {
    const s = sealValue(codec, 'x');
    expect(unsealValue(offline, s)).toBe('');
  });
  it('passes plain values through unseal', () => {
    expect(unsealValue(codec, 'plain')).toBe('plain');
  });
});

describe('sealPreset', () => {
  it('seals only fill values and reports the count', () => {
    const { preset: out, changed } = sealPreset(codec, preset());
    const steps = out.layout.zones[0].content!.webLogin!;
    expect(changed).toBe(2);
    expect(isSealed(steps[1].value)).toBe(true);
    expect(isSealed(steps[2].value)).toBe(true);
    expect(steps[0]).toEqual({ action: 'waitFor', selector: '#user' });
    expect(steps[3]).toEqual({ action: 'click', selector: '#go' });
  });
  it('is idempotent', () => {
    const first = sealPreset(codec, preset()).preset;
    const second = sealPreset(codec, first);
    expect(second.changed).toBe(0);
    expect(second.preset).toEqual(first);
  });
  it('does not mutate its input', () => {
    const p = preset();
    sealPreset(codec, p);
    expect(p.layout.zones[0].content!.webLogin![2].value).toBe('hunter2');
  });
  it('reports zero changes when codec unavailable', () => {
    expect(sealPreset(offline, preset()).changed).toBe(0);
  });
});

describe('unsealZone', () => {
  it('restores plain values for launch', () => {
    const sealed = sealPreset(codec, preset()).preset;
    const z = unsealZone(codec, sealed.layout.zones[0]);
    expect(z.content!.webLogin![2].value).toBe('hunter2');
    expect(sealed.layout.zones[0].content!.webLogin![2].value).not.toBe('hunter2');
  });
});
