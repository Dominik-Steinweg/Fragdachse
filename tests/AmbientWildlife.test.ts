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

  it('turns continuously and stays in its habitat under sustained pressure, with explicit world offsets', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const travelled = model.animals.map(() => 0);
    for (let i = 0; i < 1200; i++) {
      const before = model.animals.map(a => ({ x: a.x, y: a.y, angle: a.angle }));
      const dt = i % 2 ? 1 / 30 : 1 / 60;
      if (i % 90 === 0) for (const a of model.animals) model.notifyShot(a.x + 20, a.y);
      model.update(dt * 1000, model.animals.map((a, j) => ({ id: `pressure-${j}`,
        x: a.x + Math.cos(i * .04) * 25, y: a.y + Math.sin(i * .04) * 25 })));
      for (const [j, a] of model.animals.entries()) {
        const turn = Math.atan2(Math.sin(a.angle - before[j].angle), Math.cos(a.angle - before[j].angle));
        expect(Math.abs(turn)).toBeLessThanOrEqual(AMBIENT_WILDLIFE[a.kind].turnRate * dt + 1e-9);
        travelled[j] += Math.hypot(a.x - before[j].x, a.y - before[j].y);
        expect(model.contains(a, a.x, a.y)).toBe(true);
        if (a.kind === 'snake') {
          // Even the full body remains in the immediate surroundings of its own tree.
          expect(Math.hypot(a.x - a.homeX, a.y - a.homeY) + a.appearance.footprint)
            .toBeLessThan(CANOPY_RADIUS * 1.5);
        }
      }
    }
    // Bounded steering must still let animals leave a blocked heading.
    expect(travelled.every(distance => distance > CELL_SIZE)).toBe(true);
  });

  it.each<WildlifeKind>(['snake', 'fish'])('reacts to movement, not a stationary or departed player: %s', kind => {
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

  it('butterflies rest with a frozen pose, resume flight, and take off for nearby players', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === 'butterfly')!;
    for (let i = 0; i < 800 && !a.resting; i++) model.update(25, []);
    expect(a.resting).toBe(true);
    const restingPose = [a.x, a.y, a.angle, a.animation];
    const restingStepMs = Math.min(25, a.calmTime * 1000 / 40);
    for (let i = 0; i < 20; i++) model.update(restingStepMs, []);
    expect([a.x, a.y, a.angle, a.animation]).toEqual(restingPose);
    expect(a.speed).toBe(0);
    for (let i = 0; i < 800 && a.resting; i++) model.update(25, []);
    expect(a.resting).toBe(false);
    expect(a.animation).not.toBe(restingPose[3]);
    for (let i = 0; i < 800 && !a.resting; i++) model.update(25, []);
    expect(a.resting).toBe(true);
    const player = { id: 'visitor', x: a.x - 12, y: a.y };
    model.update(25, [player]);
    expect(a.resting).toBe(false);
    expect(a.fleeing).toBe(true);
    expect(a.speed).toBeGreaterThan(0);
    model.update(25, [player]); // Stationary proximity also prevents immediate resettling.
    expect(a.fleeing).toBe(true);
    model.update(25, []);
    expect(a.fleeing).toBe(false);
  });

  it('starts butterflies at individually seeded points in both flight and rest phases', () => {
    const source = { ...layout(), trees: [], water: [], rocks: [], dirt: [] };
    const model = new AmbientWildlifeModel(source, { ...frame, width: 4096, height: 4096 });
    const butterflies = model.animals.filter(a => a.kind === 'butterfly');
    expect(new Set(butterflies.map(a => a.resting))).toEqual(new Set([true, false]));
    for (const a of butterflies) {
      expect(a.calmTime).toBeGreaterThan(0);
      expect(a.speed === 0).toBe(a.resting);
    }
    expect(new Set(butterflies.map(a => a.calmTime)).size).toBe(butterflies.length);
    const firstToSwitch = butterflies.reduce((first, a) => a.calmTime < first.calmTime ? a : first);
    const wasResting = firstToSwitch.resting;
    let remaining = firstToSwitch.calmTime + .001;
    while (remaining > 0) {
      const step = Math.min(.05, remaining);
      model.update(step * 1000, []); remaining -= step;
    }
    expect(firstToSwitch.resting).toBe(!wasResting);
  });

  it.each<WildlifeKind>(['butterfly', 'snake', 'fish'])('reacts to nearby shots without movement and forgets the disturbance: %s', kind => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === kind)!;
    if (kind === 'butterfly') {
      for (let i = 0; i < 800 && !a.resting; i++) model.update(25, []);
      expect(a.resting).toBe(true);
    }
    model.notifyShot(frame.offsetX - 1000, frame.offsetY - 1000);
    model.update(16, []);
    expect(a.fleeing).toBe(false);
    model.notifyShot(a.x - AMBIENT_WILDLIFE[kind].alertRadius * 1.2, a.y);
    model.update(16, []);
    expect(a.fleeing).toBe(true);
    expect(a.resting).toBe(false);
    const phases = new Set<string>();
    for (let i = 0; i < 800; i++) { model.update(25, []); phases.add(a.fishPhase); }
    expect(a.fleeing).toBe(false);
    if (kind === 'fish') {
      expect(phases.has('hidden')).toBe(true);
      expect(phases.has('emerging')).toBe(true);
    }
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
