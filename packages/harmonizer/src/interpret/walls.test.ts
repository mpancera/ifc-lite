import { describe, expect, it } from 'vitest';
import { wallsFromDoubleLines, type WallStroke } from './walls.js';

const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<WallStroke> = {}): WallStroke => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, ...extra });
const opts = { sourceFile: 'plan.dxf', storeyGlobalId: 'st' };

describe('wallsFromDoubleLines', () => {
  it('pairs two parallel strokes a wall apart into one wall on the midline', () => {
    const r = wallsFromDoubleLines([seg(0, 0, 5, 0, { handle: 'a', layer: 'A-WALL', layerFactor: 1 }), seg(5, 0.2, 0, 0.2, { handle: 'b', layer: 'A-WALL', layerFactor: 1 })], opts);
    expect(r.candidates).toHaveLength(1);
    const w = r.candidates[0];
    expect(w.type).toBe('wall');
    expect(w.thickness).toBeCloseTo(0.1, 6);
    expect(w.geometry[0].y).toBeCloseTo(0.1, 6);
    expect(w.geometry[1].y).toBeCloseTo(0.1, 6);
    expect(Math.abs(w.geometry[1].x - w.geometry[0].x)).toBeCloseTo(5, 6);
    expect(w.confidence).toBeCloseTo(1, 4);
    expect(w.source.handles).toEqual(['a', 'b']);
    expect(w.source.layer).toBe('A-WALL');
    expect(r.paired).toBe(2);
    expect(r.unpaired).toBe(0);
  });

  it('takes only the overlapping stretch and asks for enough of it', () => {
    const r = wallsFromDoubleLines([seg(0, 0, 6, 0), seg(3, 0.15, 9, 0.15)], opts);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].geometry[0].x).toBeCloseTo(3, 6);
    expect(r.candidates[0].geometry[1].x).toBeCloseTo(6, 6);
    const short = wallsFromDoubleLines([seg(0, 0, 6, 0), seg(5, 0.15, 11, 0.15)], opts);
    expect(short.candidates).toHaveLength(0);
  });

  it('ignores dividers, lone strokes, crossing strokes and gaps that are no wall', () => {
    const r = wallsFromDoubleLines(
      [
        seg(0, 0, 5, 0, { kind: 'divider' }),
        seg(0, 0.2, 5, 0.2, { kind: 'divider' }),
        seg(10, 0, 15, 0),
        seg(10, 1.5, 15, 1.5),
        seg(20, 0, 25, 0),
        seg(22, -2, 22, 2),
        seg(30, 0, 30.2, 0),
        seg(30, 0.1, 30.2, 0.1),
      ],
      opts,
    );
    expect(r.candidates).toHaveLength(0);
    expect(r.unpaired).toBe(4);
  });

  it('is deterministic and does not reuse a face for two walls', () => {
    const strokes = [seg(0, 0, 5, 0, { handle: 'f1' }), seg(0, 0.2, 5, 0.2, { handle: 'f2' }), seg(0, 0.4, 5, 0.4, { handle: 'f3' })];
    const a = wallsFromDoubleLines(strokes, opts);
    const b = wallsFromDoubleLines(strokes, opts);
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0].id).toBe(b.candidates[0].id);
    expect(a.unpaired).toBe(1);
  });

  it('marks odd thicknesses down and derives a handle from the geometry when none is given', () => {
    const r = wallsFromDoubleLines([seg(0, 0, 5, 0), seg(0, 0.55, 5, 0.55)], opts);
    expect(r.candidates[0].confidenceReasons.thickness).toBe(0.75);
    expect(r.candidates[0].source.handles[0]).toMatch(/^seg@/);
  });
});
