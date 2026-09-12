import { describe, expect, it } from 'vitest';
import { AmbientWildlifeModel, type WildlifeKind } from '../src/arena/AmbientWildlifeModel';
import { AMBIENT_WILDLIFE } from '../src/arena/AmbientWildlifeConfig';
import { createWildlifeAppearance, writeFishMemberPose } from '../src/arena/AmbientWildlifeAppearance';
import { CANOPY_RADIUS, CELL_SIZE } from '../src/config';
import type { ArenaLayout } from '../src/types';

const frame = { offsetX: 147, offsetY: 83, width: 1280, height: 960 };
function layout(): ArenaLayout {
  return { seed: 873, trees: [{ gridX: 8, gridY: 12 }, { gridX: 34, gridY: 19 }],
    rocks: [{ gridX: 7, gridY: 9 }], dirt: [{ gridX: 6, gridY: 5 }], tracks: [], powerUpPedestals: [],
    water: Array.from({ length: 120 }, (_, i) => ({ gridX: 14 + i % 12, gridY: 8 + Math.floor(i / 12) })) };
}

describe('cosmetic wildlife', () => {
  it('derives habitats from any layout without modifying it or needing players', () => {
    const source = layout(), before = JSON.stringify(source);
    const model = new AmbientWildlifeModel(source, frame);
    expect(new Set(model.animals.map(a => a.kind))).toEqual(new Set(['butterfly', 'snake', 'fish']));
    expect(new AmbientWildlifeModel(source, frame).animals).toEqual(model.animals);
    const positions = model.animals.map(a => [a.x, a.y, a.animation]);
    for (let i = 0; i < 120; i++) model.update(1000 / 60, []);
    expect(model.animals.map(a => [a.x, a.y, a.animation])).not.toEqual(positions);
    expect(JSON.stringify(source)).toBe(before);
    const dry = new AmbientWildlifeModel({ ...source, trees: [], water: [] }, frame);
    expect(dry.animals.every(a => a.kind === 'butterfly')).toBe(true);
    const tiny = new AmbientWildlifeModel({ ...source, trees: [], water: [], rocks: [], dirt: [] },
      { ...frame, width: CELL_SIZE * 3, height: CELL_SIZE * 3 });
    expect(tiny.animals.some(a => a.kind === 'butterfly')).toBe(true);
    const shallow = new AmbientWildlifeModel({ ...source, water: [{ gridX: 20, gridY: 20 }] }, frame);
    expect(shallow.animals.some(a => a.kind === 'fish')).toBe(false);
  });

  it('keeps every animal inside its habitat under sustained player pressure, with explicit world offsets', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    for (let i = 0; i < 1200; i++) {
      model.update(1000 / 30, model.animals.map((a, j) => ({ id: `pressure-${j}`,
        x: a.x + Math.cos(i * .04) * 25, y: a.y + Math.sin(i * .04) * 25 })));
      for (const a of model.animals) {
        expect(model.contains(a, a.x, a.y)).toBe(true);
        if (a.kind === 'snake') {
          // Even the full body remains in the immediate surroundings of its own tree.
          expect(Math.hypot(a.x - a.homeX, a.y - a.homeY) + a.appearance.footprint)
            .toBeLessThan(CANOPY_RADIUS * 1.5);
        }
      }
    }
  });

  it.each<WildlifeKind>(['butterfly', 'snake', 'fish'])('reacts to movement, not a stationary or departed player: %s', kind => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === kind)!;
    // A controlled facing within the existing habitat removes unrelated random steering.
    a.angle = 0;
    const player = { id: 'walker', x: a.x - 22, y: a.y };
    model.update(16, [player]);
    expect(a.fleeing).toBe(false);
    player.x += 1;
    model.update(16, [player]);
    expect(a.fleeing).toBe(true);
    expect(a.speed).toBeGreaterThan(AMBIENT_WILDLIFE[kind].speed);
    expect(a.x).toBeGreaterThan(player.x + 21);
    model.update(16, []);
    if (kind !== 'fish') expect(a.fleeing).toBe(false);
  });

  it('fishes flee, fully disappear, and return to ordinary swimming; undisturbed schools also dive', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === 'fish')!;
    const player = { id: 'walker', x: a.x - 30, y: a.y };
    model.update(16, [player]); player.x += 1; model.update(16, [player]);
    expect(a.fishPhase).toBe('fleeing');
    const phases = new Set<string>();
    let completelyHidden = false, returned = false;
    for (let i = 0; i < 800; i++) {
      model.update(25, []);
      phases.add(a.fishPhase);
      if (a.fishPhase === 'hidden' && a.opacity === 0) completelyHidden = true;
      if (completelyHidden && a.fishPhase === 'swimming' && a.opacity === 1) returned = true;
    }
    expect(phases).toEqual(new Set(['fleeing', 'diving', 'hidden', 'emerging', 'swimming']));
    expect(completelyHidden && returned).toBe(true);
    const calm = new AmbientWildlifeModel(layout(), frame);
    const undisturbed = calm.animals.find(a => a.kind === 'fish')!;
    let naturallyHidden = false;
    for (let i = 0; i < 800; i++) { calm.update(25, []); naturallyHidden ||= undisturbed.opacity === 0; }
    expect(naturallyHidden).toBe(true);
  });

  it('bounds populations and releases local state on teardown', () => {
    const model = new AmbientWildlifeModel(layout(), { ...frame, width: 65536, height: 65536 });
    for (const kind of ['butterfly', 'snake', 'fish'] as const)
      expect(model.animals.filter(a => a.kind === kind).length).toBeLessThanOrEqual(AMBIENT_WILDLIFE[kind].maxCount);
    model.destroy(); model.destroy(); model.update(16, []);
    expect(model.animals).toEqual([]);
  });

  it('fits every fish variant and animated member inside its habitat clearance', () => {
    const pose = { x: 0, y: 0, length: 0 };
    for (let group = 0; group < AMBIENT_WILDLIFE.fishGroups.length; group++) {
      for (const variation of [.01, .35, .65, .99]) {
        const style = createWildlifeAppearance('fish', variation, variation,
          (group + .5) / AMBIENT_WILDLIFE.fishGroups.length);
        expect(AMBIENT_WILDLIFE.fishColors[style.colorIndex]).toBeDefined();
        for (let phase = 0; phase < 40; phase++) for (let i = 0; i < style.count; i++) {
          writeFishMemberPose(style, phase * .37, variation, i, pose);
          const tailX = pose.length * .62 * AMBIENT_WILDLIFE.visualScale;
          const tailY = 1.5 * style.widthScale * AMBIENT_WILDLIFE.visualScale;
          // All rotations are safe if the member's furthest tail corner fits.
          for (const side of [-1, 1]) expect(Math.hypot(pose.x - tailX, pose.y + side * tailY))
            .toBeLessThan(style.footprint);
        }
      }
    }
  });
});
