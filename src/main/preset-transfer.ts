import type { ImportPlan, ImportPlanZone, MonitorInfo, Preset } from '../shared/types';
import { resolveZoneMonitors } from './monitor-rematch';

export type { ImportPlan, ImportPlanZone };

export const PRESET_FILE_FORMAT = 'moncom-preset';
export const PRESET_FILE_VERSION = 1;

export interface PresetFile {
  format: typeof PRESET_FILE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  preset: Preset;
}

export type ParseResult = { ok: true; file: PresetFile } | { ok: false; error: string };

/** Build an export file from a preset. Login values are blanked, sealed or not. */
export function toPresetFile(preset: Preset, appVersion: string, now: Date): PresetFile {
  const copy: Preset = JSON.parse(JSON.stringify(preset));
  for (const zone of copy.layout.zones) {
    for (const step of zone.content?.webLogin ?? []) {
      if (step.action === 'fill') step.value = '';
    }
  }
  return { format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, exportedAt: now.toISOString(), appVersion, preset: copy };
}

/** Validate the text of a preset file. */
export function parsePresetFile(text: string): ParseResult {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a MonCOM preset.' }; }
  if (!raw || typeof raw !== 'object' || raw.format !== PRESET_FILE_FORMAT) {
    return { ok: false, error: 'This file is not a MonCOM preset.' };
  }
  if (typeof raw.version === 'number' && raw.version > PRESET_FILE_VERSION) {
    return { ok: false, error: 'This preset was made by a newer MonCOM. Update MonCOM and try again.' };
  }
  const p = raw.preset;
  if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name || !Array.isArray(p.layout?.zones)) {
    return { ok: false, error: 'This preset file is incomplete.' };
  }
  return { ok: true, file: raw as PresetFile };
}

/** Work out which current monitor each zone would land on, without changing anything. */
export function planImport(preset: Preset, monitors: MonitorInfo[]): ImportPlan {
  const connected = new Set(monitors.map(m => m.id));
  const resolved = resolveZoneMonitors(preset.layout.zones, monitors);
  const zones: ImportPlanZone[] = preset.layout.zones.map((zone, i) => {
    const target = resolved[i].monitorId;
    return {
      zoneId: zone.id,
      label: zone.content?.label || 'Empty',
      savedMonitorId: zone.monitorId,
      targetMonitorId: connected.has(target) ? target : null,
    };
  });
  let redactedLogins = 0;
  for (const zone of preset.layout.zones) {
    for (const step of zone.content?.webLogin ?? []) {
      if (step.action === 'fill' && !step.value) redactedLogins++;
    }
  }
  return { zones, unmatched: zones.filter(z => z.targetMonitorId === null).length, redactedLogins };
}

/** Return a new preset with matched zones moved onto their planned monitors. */
export function applyImportPlan(preset: Preset, plan: ImportPlan, monitors: MonitorInfo[], newId: string, now: string): Preset {
  const copy: Preset = JSON.parse(JSON.stringify(preset));
  const targets = new Map(plan.zones.map(z => [z.zoneId, z.targetMonitorId]));
  for (const zone of copy.layout.zones) {
    const monitor = monitors.find(m => m.id === targets.get(zone.id));
    if (!monitor) continue;
    zone.monitorId = monitor.id;
    zone.monitorBounds = { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
  }
  copy.id = newId;
  copy.layout.id = 'layout-' + newId;
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}
