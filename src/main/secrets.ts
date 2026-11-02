import { isSealed, SECRET_PREFIX } from '../shared/secrets';
import type { Preset, WebLoginStep, Zone } from '../shared/types';

export interface SecretCodec {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

let warnedEncrypt = false;

/** Seals a plain value. Returns it unchanged when the codec is unavailable, encryption fails, or it is already sealed. */
export function sealValue(codec: SecretCodec, plain: string): string {
  if (isSealed(plain) || !codec.available()) return plain;
  try {
    return SECRET_PREFIX + codec.encrypt(plain).toString('base64');
  } catch (e) {
    // A failed encrypt must not reject the whole save, and one warning per run is enough.
    if (!warnedEncrypt) console.warn('[MonCOM] Could not encrypt a login value, storing it as typed:', e);
    warnedEncrypt = true;
    return plain;
  }
}

/** Unseals a value. A sealed value that cannot be decrypted yields '' so ciphertext is never used as a secret. */
export function unsealValue(codec: SecretCodec, value: string): string {
  if (!isSealed(value)) return value;
  try {
    if (!codec.available()) throw new Error('secret storage unavailable');
    return codec.decrypt(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'));
  } catch (err) {
    console.warn('[MonCOM] Could not unseal a stored secret, using an empty value.', err);
    return '';
  }
}

function mapFillSteps(
  zone: Zone,
  fn: (value: string) => string,
): { zone: Zone; changed: number } {
  const content = zone.content;
  if (!content?.webLogin) return { zone, changed: 0 };
  let changed = 0;
  const webLogin = content.webLogin.map((step): WebLoginStep => {
    if (step.action !== 'fill' || !step.value) return step;
    const value = fn(step.value);
    if (value !== step.value) changed++;
    return { ...step, value };
  });
  return { zone: { ...zone, content: { ...content, webLogin } }, changed };
}

/** Seals every non-empty fill value. `changed` counts values newly sealed. */
export function sealPreset(codec: SecretCodec, preset: Preset): { preset: Preset; changed: number } {
  let changed = 0;
  const zones = preset.layout.zones.map((zone) => {
    const r = mapFillSteps(zone, (v) => sealValue(codec, v));
    changed += r.changed;
    return r.zone;
  });
  return { preset: { ...preset, layout: { ...preset.layout, zones } }, changed };
}

export function sealPresets(codec: SecretCodec, presets: Preset[]): { presets: Preset[]; changed: number } {
  let changed = 0;
  const out = presets.map((p) => {
    const r = sealPreset(codec, p);
    changed += r.changed;
    return r.preset;
  });
  return { presets: out, changed };
}

export function unsealZone(codec: SecretCodec, zone: Zone): Zone {
  return mapFillSteps(zone, (v) => unsealValue(codec, v)).zone;
}
