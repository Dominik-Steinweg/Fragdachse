import { describe, expect, it, vi } from 'vitest';
import { AmbientWildlifeAudio } from '../src/arena/AmbientWildlifeAudio';
import { AmbientWildlifeModel } from '../src/arena/AmbientWildlifeModel';
import { isBird } from '../src/arena/AmbientWildlifeAppearance';
import { isGroundedBird } from '../src/arena/AmbientWildlifeBirds';
import type { ArenaLayout } from '../src/types';

const frame = { offsetX: 0, offsetY: 0, width: 4096, height: 4096 };
const everywhere = { x: 0, y: 0, width: 4096, height: 4096 };
const nowhere = { x: -100000, y: -100000, width: 10, height: 10 };
const layout: ArenaLayout = { seed: 882, rocks: [], dirt: [], tracks: [], powerUpPedestals: [],
  trees: Array.from({ length: 12 }, (_, i) => ({ gridX: 10 + (i % 4) * 25, gridY: 10 + Math.floor(i / 4) * 25 })) };

function flush(view: typeof everywhere) {
  const model = new AmbientWildlifeModel(layout, frame);
  model.update(16, [], everywhere, 12 * 60);
  const audio = new AmbientWildlifeAudio(model.animals), port = { playSound: vi.fn() };
  const flock = model.animals.find(a => a.kind === 'sparrow' && isGroundedBird(a.bird!))!;
  const body = { id: 'enemy', x: flock.x - 40, y: flock.y };
  model.update(16, [body], everywhere, 12 * 60); audio.update(16, view, port);
  body.x += 2; port.playSound.mockClear();
  model.update(16, [body], everywhere, 12 * 60); audio.update(16, view, port);
  return { flock, calls: port.playSound.mock.calls };
}

describe('bird sounds', () => {
  it('plays one flutter for a visible flock taking off, louder for larger flocks, and nothing offscreen', () => {
    const { flock, calls } = flush(everywhere);
    expect(flock.bird!.phase).toBe('flight');
    const flutters = calls.filter(call => call[0] === 'sfx_wildlife_sparrow_flush');
    expect(flutters).toHaveLength(1);
    expect(flutters[0].slice(1)).toEqual([flock.x, flock.y, .55 + .45 * Math.min(1, flock.appearance.count / 9)]);
    expect(flush(nowhere).calls).toEqual([]);
  });

  it('chirps now and then near the camera, stays silent without a port or far away', () => {
    const model = new AmbientWildlifeModel(layout, frame);
    const audio = new AmbientWildlifeAudio(model.animals), port = { playSound: vi.fn() };
    for (let i = 0; i < 1200; i++) { model.update(50, [], everywhere, 12 * 60); audio.update(50, nowhere, port); }
    expect(port.playSound).not.toHaveBeenCalled();
    for (let i = 0; i < 1200; i++) { model.update(50, [], everywhere, 12 * 60); audio.update(50, everywhere, undefined); }
    for (let i = 0; i < 1200; i++) {
      model.update(50, [], everywhere, 12 * 60);
      const before = port.playSound.mock.calls.length;
      audio.update(50, everywhere, port);
      // At most one bird sound starts per frame.
      expect(port.playSound.mock.calls.length - before).toBeLessThanOrEqual(1);
    }
    expect(port.playSound.mock.calls.some(call => call[0] === 'sfx_wildlife_sparrow_chirp')).toBe(true);
  });

  it('lets owls fly silently at night and only hoot', () => {
    const model = new AmbientWildlifeModel(layout, frame);
    expect(model.animals.some(a => a.kind === 'owl')).toBe(true);
    const audio = new AmbientWildlifeAudio(model.animals), port = { playSound: vi.fn() };
    const owls = model.animals.filter(a => a.kind === 'owl');
    for (let i = 0; i < 3000; i++) {
      const bodies = owls.map((owl, j) => ({ id: `walker-${j}`, x: owl.x + Math.cos(i * .05) * 30, y: owl.y }));
      model.update(50, bodies, everywhere, 0); audio.update(50, everywhere, port);
    }
    expect(model.animals.filter(a => isBird(a.kind) && a.kind !== 'owl').every(a => a.bird!.phase === 'hidden')).toBe(true);
    const keys = new Set(port.playSound.mock.calls.map(call => call[0]));
    expect(keys).toEqual(new Set(['sfx_wildlife_owl_hoot']));
  });
});
