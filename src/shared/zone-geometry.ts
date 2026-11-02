export interface Rect { x: number; y: number; width: number; height: number }
/** Values 0..1, relative to a monitor. */
export type NormalizedRect = Rect;

/** Edges are rounded, not sizes, so adjacent zones share an edge with no gap or overlap. */
export function zoneToScreenRect(zone: NormalizedRect, monitor: Rect): Rect {
  const left = Math.round(monitor.x + zone.x * monitor.width);
  const right = Math.round(monitor.x + (zone.x + zone.width) * monitor.width);
  const top = Math.round(monitor.y + zone.y * monitor.height);
  const bottom = Math.round(monitor.y + (zone.y + zone.height) * monitor.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const SPLIT_TEMPLATES: ReadonlyArray<{ name: string; zones: NormalizedRect[] }> = [
  { name: 'Full', zones: [{ x: 0, y: 0, width: 1, height: 1 }] },
  { name: '2 Columns', zones: [
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
  ]},
  { name: '2 Rows', zones: [
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0, y: 0.5, width: 1, height: 0.5 },
  ]},
  { name: '2x2 Grid', zones: [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]},
  { name: '3x3 Grid', zones: [
    { x: 0, y: 0, width: 1/3, height: 1/3 },
    { x: 1/3, y: 0, width: 1/3, height: 1/3 },
    { x: 2/3, y: 0, width: 1/3, height: 1/3 },
    { x: 0, y: 1/3, width: 1/3, height: 1/3 },
    { x: 1/3, y: 1/3, width: 1/3, height: 1/3 },
    { x: 2/3, y: 1/3, width: 1/3, height: 1/3 },
    { x: 0, y: 2/3, width: 1/3, height: 1/3 },
    { x: 1/3, y: 2/3, width: 1/3, height: 1/3 },
    { x: 2/3, y: 2/3, width: 1/3, height: 1/3 },
  ]},
  { name: 'Main + Side', zones: [
    { x: 0, y: 0, width: 0.7, height: 1 },
    { x: 0.7, y: 0, width: 0.3, height: 0.5 },
    { x: 0.7, y: 0.5, width: 0.3, height: 0.5 },
  ]},
];
