import { describe, expect, it } from 'vitest';
import { VoidFloraField, resolveVoidFloraHotspots } from '../src/arena/VoidFloraField';
import { markVoidPondColonies, type EcologyPlacement } from '../src/arena/WoodlandEcologyField';
import { voidLilyFrame, voidRockFrame } from '../src/arena/VoidFloraAssets';

const share = (field: VoidFloraField): number => {
  let taken = 0, samples = 0;
  for (let y = 0; y < 3000; y += 37) for (let x = 0; x < 6000; x += 37) { samples++; if (field.amountAt(x, y) > .5) taken++; }
  return taken / samples;
};

describe('void botany field (Nachtsicht N-6/N-7)', () => {
  it('is pure, bounded and deterministic per seed', () => {
    const a = new VoidFloraField({ level: .4 }, 777), b = new VoidFloraField({ level: .4 }, 777);
    for (let i = 0; i < 200; i++) {
      const x = i * 97.3, y = i * 41.9;
      expect(a.intensityAt(x, y)).toBe(b.intensityAt(x, y));
      expect(a.intensityAt(x, y)).toBeGreaterThanOrEqual(0);
      expect(a.intensityAt(x, y)).toBeLessThanOrEqual(1);
    }
    expect(new VoidFloraField({ level: .4 }, 778).signature).not.toBe(a.signature);
  });

  it('takes over more flora with a higher level: isolated spots low, nearly all high', () => {
    const shares = [0, .08, .35, .9].map(level => share(new VoidFloraField({ level }, 4242)));
    expect(shares[0]).toBe(0);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    expect(shares[1]).toBeLessThan(.15);
    expect(shares[3]).toBeGreaterThan(.6);
  });

  it('raises the share around hostile bases and authored foci only', () => {
    const hotspots = resolveVoidFloraHotspots({
      config: { level: 0, foci: [{ gridX: 80, gridY: 10, radiusCells: 6, strength: 1 }] }, offsetX: 0, offsetY: 0,
      bases: [{ faction: 'hostile', cells: [{ gridX: 20, gridY: 20 }, { gridX: 21, gridY: 20 }] },
        { faction: 'friendly', cells: [{ gridX: 50, gridY: 20 }] }],
    });
    expect(hotspots).toHaveLength(2);
    const field = new VoidFloraField({ level: 0 }, 1, hotspots);
    expect(field.intensityAt((20.5 + .5) * 32, 20.5 * 32)).toBeGreaterThan(.7);
    expect(field.intensityAt(80.5 * 32, 10.5 * 32)).toBeGreaterThan(.9);
    expect(field.intensityAt(50.5 * 32, 20.5 * 32)).toBe(0);
    expect(resolveVoidFloraHotspots({ config: { level: .5, hotspots: false }, offsetX: 0, offsetY: 0,
      bases: [{ faction: 'hostile', cells: [{ gridX: 1, gridY: 1 }] }] })).toEqual([]);
  });

  it('keeps neighbours alike: no single infested plant among untouched ones', () => {
    for (const level of [.08, .35]) {
      const field = new VoidFloraField({ level }, 4242);
      let isolated = 0, taken = 0;
      for (let y = 0; y < 3000; y += 40) for (let x = 0; x < 6000; x += 40) {
        if (field.amountAt(x, y) <= .5) continue;
        taken++;
        if ([[40, 0], [-40, 0], [0, 40], [0, -40]].every(([dx, dy]) => field.amountAt(x + dx, y + dy) < .1)) isolated++;
      }
      expect(taken, `level ${level}`).toBeGreaterThan(0);
      expect(isolated, `level ${level}`).toBe(0);
    }
  });

  it('marks lily plants without moving, re-ranking or re-picking any placement; ponds turn together', () => {
    const placements: EcologyPlacement[] = [];
    for (let pond = 0; pond < 12; pond++) for (let colony = 0; colony < 3; colony++) for (let i = 0; i < 6; i++) placements.push({
      kind: 'pond', frame: i ? 'lily-pad-01' : 'lily-group-01', x: pond * 700 + colony * 90 + i * 9, y: 300 + colony * 40 + i * 7,
      size: 30, rotation: i, alpha: .94, rank: i * .1, floating: true, pond, colony: pond * 8 + colony,
    });
    placements.push({ kind: 'litter', frame: 'leaf-01', x: 10, y: 10, size: 20, rotation: 0, alpha: .5, rank: .2, floating: false });
    const before = placements.map(({ void: _void, voidAmount: _amount, ...rest }) => rest);
    const field = new VoidFloraField({ level: .45 }, 99);
    const taken = markVoidPondColonies(placements, field);
    expect(placements.map(({ void: _void, voidAmount: _amount, ...rest }) => rest)).toEqual(before);
    expect(taken).toBeGreaterThan(0);
    for (let pond = 0; pond < 12; pond++) {
      const amounts = placements.filter(p => p.pond === pond).map(p => p.voidAmount!);
      expect(Math.max(...amounts) - Math.min(...amounts), `pond ${pond}`).toBeLessThan(.5);
    }
    expect(placements.at(-1)!.voidAmount).toBe(0);
    markVoidPondColonies(placements, null);
    expect(placements.some(p => p.void)).toBe(false);
  });

  it('maps natural lilies to void art of the same family: early infection on the rim, converted inside', () => {
    for (const roll of [0, .3, .6, .99]) {
      expect(voidLilyFrame('lily-pad-01', .4, roll)).toMatch(/^void-lily-pad-/);
      expect(voidLilyFrame('lily-group-02', .95, roll)).toMatch(/^void-lily-group-/);
      // The natural pair keeps a pair.
      expect(voidLilyFrame('lily-pad-03', .9, roll)).toBe('void-lily-pad-06');
      expect(voidLilyFrame('lily-pad-02', .9, roll)).not.toBe('void-lily-pad-06');
    }
    expect(voidLilyFrame('lily-pad-01', .4, 0)).not.toBe(voidLilyFrame('lily-pad-01', .95, 0));
    expect(voidRockFrame('moss-nest', .5)?.name).toMatch(/^void-moss-nest-/);
    expect(voidRockFrame('no-such-kind', .5)).toBeNull();
  });

  it('replaces only established plants with art and leaves the natural selection untouched', () => {
    const placements: EcologyPlacement[] = Array.from({ length: 30 }, (_, i) => ({
      kind: 'pond' as const, frame: i % 2 ? 'lily-pad-01' : 'lily-group-01', x: 100 + i * 11, y: 200, size: 40, rotation: 0,
      alpha: .94, rank: .1, floating: true, pond: 0, colony: Math.floor(i / 6) }));
    const full = { intensityAt: () => 1, amountOf: () => 1 }, none = { intensityAt: () => 0, amountOf: () => 0 };
    markVoidPondColonies(placements, full, voidLilyFrame);
    expect(placements.every(p => p.voidFrame?.startsWith('void-'))).toBe(true);
    expect(placements.every(p => p.frame.startsWith('lily-'))).toBe(true);
    markVoidPondColonies(placements, none, voidLilyFrame);
    expect(placements.some(p => p.voidFrame)).toBe(false);
  });
});
