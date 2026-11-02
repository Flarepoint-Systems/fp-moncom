import { describe, it, expect } from 'vitest';
import { zoneToScreenRect, SPLIT_TEMPLATES } from './zone-geometry';

describe('zoneToScreenRect', () => {
  it('maps a full zone onto a monitor left of the primary', () => {
    expect(zoneToScreenRect({ x: 0, y: 0, width: 1, height: 1 }, { x: -1920, y: 0, width: 1920, height: 1080 }))
      .toEqual({ x: -1920, y: 0, width: 1920, height: 1080 });
  });
  it('3x3 on 1366x768 shares edges with no gap or overlap', () => {
    const grid = SPLIT_TEMPLATES.find(t => t.name === '3x3 Grid')!;
    const mon = { x: 0, y: 0, width: 1366, height: 768 };
    const rects = grid.zones.map(z => zoneToScreenRect(z, mon));
    for (let row = 0; row < 3; row++) {
      const cells = rects.slice(row * 3, row * 3 + 3);
      expect(cells[0].x).toBe(0);
      expect(cells[0].x + cells[0].width).toBe(cells[1].x);
      expect(cells[1].x + cells[1].width).toBe(cells[2].x);
      expect(cells[2].x + cells[2].width).toBe(1366);
    }
  });
});

describe('SPLIT_TEMPLATES', () => {
  it('has the six built-in templates in order', () => {
    expect(SPLIT_TEMPLATES.map(t => t.name)).toEqual(['Full', '2 Columns', '2 Rows', '2x2 Grid', '3x3 Grid', 'Main + Side']);
  });
  it('every template covers the monitor exactly once', () => {
    for (const t of SPLIT_TEMPLATES) {
      const area = t.zones.reduce((a, z) => a + z.width * z.height, 0);
      expect(area).toBeCloseTo(1, 9);
      for (let i = 0; i < t.zones.length; i++) for (let j = i + 1; j < t.zones.length; j++) {
        const a = t.zones[i], b = t.zones[j];
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.max(0, ox) * Math.max(0, oy)).toBeCloseTo(0, 9);
      }
    }
  });
});
