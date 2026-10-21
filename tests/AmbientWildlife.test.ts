import { describe, expect, it } from 'vitest';
import { AmbientWildlifeModel, type WildlifeKind } from '../src/arena/AmbientWildlifeModel';
import { AMBIENT_WILDLIFE } from '../src/arena/AmbientWildlifeConfig';
import { BIRD_KINDS, createWildlifeAppearance, isBird, isWingedInsect, snakeTongueExtension, WILDLIFE_KINDS, writeSnakeBodyPose, writeFishMemberPose } from '../src/arena/AmbientWildlifeAppearance';
import { isGroundedBird } from '../src/arena/AmbientWildlifeBirds';
import { CANOPY_RADIUS, CELL_SIZE } from '../src/config';
import type { ArenaLayout } from '../src/types';

const frame = { offsetX: 147, offsetY: 83, width: 1280, height: 960 };
// Kinds paused with a zero population cap never spawn.
const ACTIVE_KINDS = WILDLIFE_KINDS.filter(kind => AMBIENT_WILDLIFE[kind].maxCount > 0);
function layout(): ArenaLayout {
  return { seed: 882, trees: [{ gridX: 8, gridY: 12 }, { gridX: 34, gridY: 19 }],
    rocks: [{ gridX: 7, gridY: 9 }], dirt: [{ gridX: 6, gridY: 5 }], tracks: [], powerUpPedestals: [],
    water: Array.from({ length: 120 }, (_, i) => ({ gridX: 14 + i % 12, gridY: 8 + Math.floor(i / 12) })) };
}

describe('cosmetic wildlife', () => {
  it.each(['moth', 'firefly'] as const)('%s accelerates away from a nearby stationary player at night', kind => {
    const model = new AmbientWildlifeModel({ ...layout(), trees: [], water: [], rocks: [], dirt: [] }, frame);
    model.update(0, [], undefined, 0);
    const a = model.animals.find(a => a.kind === kind)!;
    a.x = frame.offsetX + frame.width / 2; a.y = frame.offsetY + frame.height / 2;
    a.angle = 0; a.avoidanceAngle = null;
    const startX = a.x;
    const player = { id: 'nearby', x: a.x - 20, y: a.y };
    model.update(50, [player], undefined, 0);
    expect(a.fleeing).toBe(true);
    expect(a.speed).toBeGreaterThan(AMBIENT_WILDLIFE[kind].speed);
    expect(a.x).toBeGreaterThan(startX);
  });

  it('staggers the complete day/night succession, including transitions outside the viewport', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const offscreen = { x: -10000, y: -10000, width: 1, height: 1 };
    const insects = model.animals.filter(a => isWingedInsect(a.kind));
    const tick = (minutes: number) => model.update(50, [], offscreen, minutes);
    const visibleKinds = () => new Set(insects.filter(a => a.opacity > 0).map(a => a.kind));
    const settle = (minutes: number) => { for (let i = 0; i < 200; i++) tick(minutes); };
    tick(12 * 60);
    expect(visibleKinds()).toEqual(new Set(['butterfly']));
    const transitions = new Map<WildlifeKind, Set<number>>();
    const advance = (from: number, to: number) => {
      for (let minute = from; minute <= to; minute++) {
        const previous = insects.map(a => a.diurnalActive);
        tick(minute);
        insects.forEach((a, i) => {
          if (a.diurnalActive === previous[i]) return;
          if (!transitions.has(a.kind)) transitions.set(a.kind, new Set());
          transitions.get(a.kind)!.add(minute);
        });
      }
      settle(to);
    };
    advance(12 * 60, 20 * 60);
    expect(visibleKinds()).toEqual(new Set(['moth']));
    expect(transitions.get('butterfly')!.size).toBeGreaterThan(1);
    expect(transitions.get('moth')!.size).toBeGreaterThan(1);
    advance(20 * 60, 24 * 60);
    expect(visibleKinds()).toEqual(new Set(['moth', 'firefly']));
    expect(transitions.get('firefly')!.size).toBeGreaterThan(1);
    transitions.clear();
    advance(24 * 60, 30 * 60);
    expect(visibleKinds()).toEqual(new Set(['moth']));
    expect(transitions.get('firefly')!.size).toBeGreaterThan(1);
    advance(30 * 60, 33 * 60);
    expect(visibleKinds()).toEqual(new Set(['butterfly']));
    expect(transitions.get('butterfly')!.size).toBeGreaterThan(1);
    expect(transitions.get('moth')!.size).toBeGreaterThan(1);
  });

  it.each(['butterfly', 'moth'] as const)('%s rests before fading and cannot be woken by shots during retirement', kind => {
    const model = new AmbientWildlifeModel(layout(), frame);
    model.update(50, [], undefined, kind === 'butterfly' ? 12 * 60 : 0);
    const a = model.animals.find(a => a.kind === kind)!;
    a.resting = false;
    const endTime = kind === 'butterfly' ? 20 * 60 : 9 * 60;
    const pose = [a.x, a.y, a.animation];
    model.update(50, [], undefined, endTime);
    expect(a.resting).toBe(true);
    expect(a.opacity).toBe(1);
    let partialFade = false;
    for (let i = 0; i < 200; i++) {
      model.notifyImpulse('shot', a.x, a.y);
      model.update(50, [{ id: 'nearby', x: a.x, y: a.y }], undefined, endTime);
      partialFade ||= a.opacity > 0 && a.opacity < 1;
      expect([a.x, a.y, a.animation]).toEqual(pose);
    }
    expect(partialFade).toBe(true);
    expect(a.opacity).toBe(0);
  });

  it('starts night worlds with night insects and keeps both nocturnal populations bounded', () => {
    const model = new AmbientWildlifeModel(layout(), { ...frame, width: 65536, height: 65536 });
    model.update(0, [], undefined, 0);
    expect(model.animals.filter(a => a.kind === 'butterfly').every(a => a.opacity === 0)).toBe(true);
    for (const kind of ['moth', 'firefly'] as const) {
      const animals = model.animals.filter(a => a.kind === kind);
      expect(animals.length).toBeGreaterThan(0);
      expect(animals.length).toBeLessThanOrEqual(AMBIENT_WILDLIFE[kind].maxCount);
      expect(animals.every(a => a.opacity === 1 && model.contains(a, a.x, a.y))).toBe(true);
    }
    expect(createWildlifeAppearance('moth', .5, .5, .5).length)
      .toBeGreaterThan(createWildlifeAppearance('butterfly', .5, .5, .5).length);
  });

  it('uses sparse seeded tree occupancy with rare shared homes and a global population cap', () => {
    const trees = Array.from({ length: 256 }, (_, i) => ({ gridX: 8 + (i % 16) * 10, gridY: 8 + Math.floor(i / 16) * 10 }));
    const habitat: ArenaLayout = { seed: 0, trees, rocks: [], dirt: [], tracks: [], powerUpPedestals: [] };
    const world = { offsetX: 0, offsetY: 0, width: 16384, height: 16384 };
    let occupied = 0, shared = 0;
    for (let seed = 0; seed < 20; seed++) {
      const model = new AmbientWildlifeModel({ ...habitat, seed }, world);
      const snakes = model.animals.filter(a => a.kind === 'snake');
      const homes = new Map<string, number>();
      for (const snake of snakes) {
        const home = `${snake.homeX},${snake.homeY}`;
        homes.set(home, (homes.get(home) ?? 0) + 1);
        expect(model.contains(snake, snake.x, snake.y)).toBe(true);
      }
      occupied += homes.size;
      shared += [...homes.values()].filter(count => count > 1).length;
      expect(new Set(snakes.map(a => `${a.x},${a.y}`)).size).toBe(snakes.length);
      if (seed === 0) {
        const reordered = new AmbientWildlifeModel({ ...habitat, trees: [...trees].reverse() }, world);
        expect(reordered.animals.filter(a => a.kind === 'snake')).toEqual(snakes);
      }
    }
    // Check configured probabilities over a broad sample, without freezing tuning literals.
    const samples = trees.length * 20, probability = AMBIENT_WILDLIFE.snake.treeOccupancy;
    expect(Math.abs(occupied - samples * probability)).toBeLessThan(5 * Math.sqrt(samples * probability * (1 - probability)));
    const groupChance = AMBIENT_WILDLIFE.snake.groupChance;
    expect(shared).toBeGreaterThan(0);
    expect(Math.abs(shared - occupied * groupChance)).toBeLessThan(5 * Math.sqrt(occupied * groupChance * (1 - groupChance)));
    const dense = new AmbientWildlifeModel({ ...habitat, trees: Array.from({ length: 2048 }, (_, i) => ({
      gridX: 8 + (i % 64) * 7, gridY: 8 + Math.floor(i / 64) * 7,
    })) }, world);
    expect(dense.animals.filter(a => a.kind === 'snake')).toHaveLength(AMBIENT_WILDLIFE.snake.maxCount);
  });

  it('retracts the tongue completely between individually varied, recurring flicks', () => {
    const signatures: string[] = [];
    for (const variation of [.03, .37, .81]) {
      let visible = 0, hidden = 0, pulses = 0, previous = 0;
      const starts: number[] = [];
      for (let i = 0; i < 6000; i++) {
        const extension = snakeTongueExtension(i * .01, variation);
        expect(extension).toBeGreaterThanOrEqual(0);
        expect(extension).toBeLessThanOrEqual(1);
        if (extension > 0) {
          visible++;
          if (previous === 0) { pulses++; starts.push(i); }
        } else hidden++;
        if (i > 0) expect(Math.abs(extension - previous)).toBeLessThan(.4);
        previous = extension;
      }
      expect(pulses).toBeGreaterThan(2);
      expect(hidden).toBeGreaterThan(visible * 5);
      expect(new Set(starts.slice(1).map((start, i) => start - starts[i])).size).toBeGreaterThan(1);
      signatures.push(starts.join(','));
    }
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('keeps the complete animated snake and extended tongue inside habitat clearance', () => {
    const pose = { x: 0, y: 0, halfWidth: 0 };
    for (let size = 0; size < AMBIENT_WILDLIFE.snakeSizes.length; size++) {
      const style = createWildlifeAppearance('snake', (size + .5) / AMBIENT_WILDLIFE.snakeSizes.length, .5, 0);
      for (let phase = 0; phase < 30; phase++) {
        for (let segment = 0; segment <= AMBIENT_WILDLIFE.snakeVisual.segments; segment++) {
          writeSnakeBodyPose(style, phase * .37, segment / AMBIENT_WILDLIFE.snakeVisual.segments, pose);
          for (const side of [-1, 1]) for (const shadow of [0, 1]) {
            expect(Math.hypot(pose.x + shadow * .5, pose.y + side * pose.halfWidth + shadow * .65)
              * AMBIENT_WILDLIFE.visualScale).toBeLessThan(style.footprint);
          }
        }
      }
      const tuning = AMBIENT_WILDLIFE.snakeVisual;
      expect(Math.hypot((1.45 + tuning.tongueLength) * tuning.scale, .36 * style.widthScale)
        * AMBIENT_WILDLIFE.visualScale).toBeLessThan(style.footprint);
    }
  });

  it('derives habitats from any layout without modifying it or needing players', () => {
    const source = layout(), before = JSON.stringify(source);
    const model = new AmbientWildlifeModel(source, frame);
    expect(new Set(model.animals.map(a => a.kind))).toEqual(new Set(ACTIVE_KINDS));
    expect(new AmbientWildlifeModel(source, frame).animals).toEqual(model.animals);
    const positions = model.animals.map(a => [a.x, a.y, a.animation]);
    for (let i = 0; i < 120; i++) model.update(1000 / 60, []);
    expect(model.animals.map(a => [a.x, a.y, a.animation])).not.toEqual(positions);
    expect(JSON.stringify(source)).toBe(before);
    const dry = new AmbientWildlifeModel({ ...source, trees: [], water: [] }, frame);
    expect(dry.animals.every(a => isWingedInsect(a.kind))).toBe(true);
    const tiny = new AmbientWildlifeModel({ ...source, trees: [], water: [], rocks: [], dirt: [] },
      { ...frame, width: CELL_SIZE * 3, height: CELL_SIZE * 3 });
    expect(tiny.animals.some(a => a.kind === 'butterfly')).toBe(true);
    const shallow = new AmbientWildlifeModel({ ...source, water: [{ gridX: 20, gridY: 20 }] }, frame);
    expect(shallow.animals.some(a => a.kind === 'fish')).toBe(false);
  });

  it.each([0, 12 * 60])('turns continuously and stays in its habitat under pressure at minute %s, with world offsets', minutes => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const travelled = model.animals.map(() => 0);
    for (let i = 0; i < 1200; i++) {
      const before = model.animals.map(a => ({ x: a.x, y: a.y, angle: a.angle }));
      const dt = i % 2 ? 1 / 30 : 1 / 60;
      if (i % 90 === 0) for (const a of model.animals) model.notifyImpulse('shot', a.x + 20, a.y);
      model.update(dt * 1000, model.animals.map((a, j) => ({ id: `pressure-${j}`,
        x: a.x + Math.cos(i * .04) * 25, y: a.y + Math.sin(i * .04) * 25 })), undefined, minutes);
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
    expect(travelled.every((distance, i) => model.animals[i].diurnalActive ? distance > CELL_SIZE : distance === 0)).toBe(true);
  }, 30000); // 1200 simulated frames; seconds when other suites share the CPU.

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

  it.each<WildlifeKind>([...ACTIVE_KINDS])('reacts to nearby shots without movement and forgets the disturbance: %s', kind => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === kind)!;
    const tick = (ms: number) => model.update(ms, [], undefined, kind === 'moth' || kind === 'firefly' || kind === 'owl' ? 0 : 12 * 60);
    if (kind === 'butterfly') {
      for (let i = 0; i < 800 && !a.resting; i++) model.update(25, []);
      expect(a.resting).toBe(true);
    }
    model.notifyImpulse('shot', frame.offsetX - 1000, frame.offsetY - 1000);
    tick(16);
    expect(a.fleeing).toBe(false);
    model.notifyImpulse('shot', a.x - AMBIENT_WILDLIFE[kind].alertRadius * 1.2, a.y);
    tick(16);
    expect(a.fleeing).toBe(true);
    expect(a.resting).toBe(false);
    const phases = new Set<string>();
    for (let i = 0; i < 800; i++) { tick(25); phases.add(a.fishPhase); }
    expect(a.fleeing).toBe(false);
    if (kind === 'fish') {
      expect(phases.has('hidden')).toBe(true);
      expect(phases.has('emerging')).toBe(true);
    }
  });

  it.each<WildlifeKind>([...ACTIVE_KINDS])('reacts to an explosion beyond shot reach: %s', kind => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === kind)!;
    const tick = () => model.update(16, [], undefined, kind === 'moth' || kind === 'firefly' || kind === 'owl' ? 0 : 12 * 60);
    const { shot, explosion } = AMBIENT_WILDLIFE.disturbance, alert = AMBIENT_WILDLIFE[kind].alertRadius, radius = 40;
    const distance = alert * shot.alertScale + 10;
    expect(distance).toBeLessThan(alert * explosion.alertScale + radius * explosion.blastScale);
    tick();
    model.notifyImpulse('shot', a.x - distance, a.y);
    tick();
    expect(a.fleeing).toBe(false);
    model.notifyImpulse('explosion', a.x - distance, a.y, radius);
    tick();
    expect(a.fleeing).toBe(true);
  });

  it('measures moving bodies of any id to their edge, so a large enemy alarms from further away', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === 'snake')!;
    a.angle = 0;
    const reach = AMBIENT_WILDLIFE.snake.alertRadius;
    const small = { id: 'enemy-small', x: a.x - reach - 10, y: a.y };
    model.update(16, [small]); small.x += 1; model.update(16, [small]);
    expect(a.fleeing).toBe(false);
    const large = { id: 'enemy-large', x: a.x - reach - 10, y: a.y, radius: 24 };
    model.update(16, [large]); large.x += 1; model.update(16, [large]);
    expect(a.fleeing).toBe(true);
  });

  it('finds a nearby moving body among hundreds of widely spread bodies', () => {
    const model = new AmbientWildlifeModel(layout(), frame);
    const a = model.animals.find(a => a.kind === 'snake')!;
    a.angle = 0;
    const startX = a.x;
    const near = { id: 'near', x: a.x - 30, y: a.y };
    const crowd = Array.from({ length: 300 }, (_, i) => ({ id: `crowd-${i}`,
      x: frame.offsetX + (i % 20) * 5000 - 40000, y: frame.offsetY + Math.floor(i / 20) * 5000 - 30000 }));
    const movers = [near, ...crowd];
    model.update(16, movers);
    for (const m of movers) m.x += 1;
    model.update(16, movers);
    expect(a.fleeing).toBe(true);
    for (let i = 0; i < 20; i++) { for (const m of movers) m.x += 1; model.update(16, movers); }
    expect(a.x).toBeGreaterThan(startX);
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
    for (const kind of ['butterfly', 'snake', 'fish', ...BIRD_KINDS] as const)
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

  describe('birds', () => {
    const enabled = ACTIVE_KINDS.filter(isBird);
    const diurnal = new Set(enabled.filter(kind => kind !== 'owl'));
    const forest = (): ArenaLayout => ({ ...layout(), trees: Array.from({ length: 12 }, (_, i) => ({
      gridX: 4 + (i % 4) * 9, gridY: 4 + Math.floor(i / 4) * 9 })) });

    it.each([...diurnal])('%s ignores a stationary body, takes off from a moving one and lands elsewhere on open ground', kind => {
      const model = new AmbientWildlifeModel(forest(), frame);
      model.update(16, [], undefined, 12 * 60);
      const a = model.animals.find(a => a.kind === kind)!;
      expect(isGroundedBird(a.bird!)).toBe(true);
      const start = { x: a.x, y: a.y };
      const body = { id: 'enemy-1', x: a.x - 30, y: a.y };
      for (let i = 0; i < 40; i++) model.update(16, [body], undefined, 12 * 60);
      expect(a.fleeing).toBe(false);
      expect(isGroundedBird(a.bird!)).toBe(true);
      body.x += 2;
      model.update(16, [body], undefined, 12 * 60);
      expect(a.fleeing).toBe(true);
      expect(a.bird!.phase).toBe('flight');
      let landed = false;
      for (let i = 0; i < 1200 && !landed; i++) {
        model.update(16, [], undefined, 12 * 60);
        landed = isGroundedBird(a.bird!);
      }
      expect(landed).toBe(true);
      expect(a.fleeing).toBe(false);
      expect(Math.hypot(a.x - start.x, a.y - start.y)).toBeGreaterThan(CELL_SIZE);
      expect(model.contains(a, a.x, a.y)).toBe(true);
    });

    it('keeps diurnal birds and owls on opposite shifts, also outside the view, without moving inactive birds', () => {
      const model = new AmbientWildlifeModel(forest(), frame);
      const offscreen = { x: -10000, y: -10000, width: 1, height: 1 };
      const birds = model.animals.filter(a => isBird(a.kind));
      const visible = () => new Set(birds.filter(a => a.opacity > 0).map(a => a.kind));
      const run = (minutes: number, frames = 400) => { for (let i = 0; i < frames; i++) model.update(50, [], offscreen, minutes); };
      run(12 * 60, 1);
      expect(visible()).toEqual(diurnal);
      const owl = birds.find(a => a.kind === 'owl')!;
      const roosted = [owl.x, owl.y, owl.angle];
      run(12 * 60);
      expect([owl.x, owl.y, owl.angle]).toEqual(roosted);
      for (let minute = 12 * 60; minute <= 23 * 60; minute += 2) run(minute, 3);
      run(23 * 60);
      expect(visible()).toEqual(new Set(['owl']));
      expect(birds.filter(a => a.kind !== 'owl').every(a => a.bird!.phase === 'hidden' && a.resting)).toBe(true);
      for (let minute = 23 * 60; minute <= 32 * 60; minute += 2) run(minute % (24 * 60), 3);
      run(8 * 60);
      expect(visible()).toEqual(diurnal);
      expect(birds.filter(a => a.kind !== 'owl').every(a => isGroundedBird(a.bird!) && model.contains(a, a.x, a.y))).toBe(true);
    });

    it('leaves kinds with a zero population cap out of the world', () => {
      const kinds = new Set(new AmbientWildlifeModel(forest(), frame).animals.filter(a => isBird(a.kind)).map(a => a.kind));
      expect(kinds).toEqual(new Set(enabled));
    });

    it('lets owls patrol at night with circles and hunting dives onto open ground', () => {
      const meadow: ArenaLayout = { ...layout(), water: [], rocks: [], trees: [{ gridX: 30, gridY: 30 }, { gridX: 70, gridY: 40 }, { gridX: 50, gridY: 90 }] };
      const model = new AmbientWildlifeModel(meadow, { ...frame, width: 4096, height: 4096 });
      const owls = model.animals.filter(a => a.kind === 'owl');
      expect(owls.length).toBeGreaterThan(0);
      const phases = new Set<string>();
      for (let i = 0; i < 6000; i++) {
        model.update(33, [], undefined, 0);
        for (const owl of owls) {
          phases.add(owl.bird!.phase);
          if (owl.bird!.phase === 'mantle') expect(model.contains(owl, owl.x, owl.y)).toBe(true);
        }
      }
      expect(phases).toEqual(new Set(['patrol', 'circle', 'dive', 'mantle', 'climb']));
    }, 30000);

    it('places sparrow drinking spots on land right at the water, facing it', () => {
      const model = new AmbientWildlifeModel(layout(), frame);
      const shore: number[][] = [];
      for (const a of model.animals.filter(a => a.kind === 'sparrow')) {
        const s = a.bird!.spots;
        for (let i = 0; i < s.length; i += 4) if (s[i + 3] === 1) shore.push([s[i], s[i + 1], s[i + 2]]);
      }
      expect(shore.length).toBeGreaterThan(0);
      const water = new Set(layout().water!.map(c => `${c.gridX},${c.gridY}`));
      const cell = (x: number, y: number) => `${Math.floor((x - frame.offsetX) / CELL_SIZE)},${Math.floor((y - frame.offsetY) / CELL_SIZE)}`;
      for (const [x, y, facing] of shore) {
        expect(water.has(cell(x, y))).toBe(false);
        expect(water.has(cell(x + Math.cos(facing) * CELL_SIZE / 2, y + Math.sin(facing) * CELL_SIZE / 2))).toBe(true);
      }
    });

    it('seeds identical birds for a rebuilt World and for any authored tree order', () => {
      const birds = (l: ArenaLayout) => new AmbientWildlifeModel(l, frame).animals.filter(a => isBird(a.kind));
      const source = forest();
      expect(birds(source).length).toBeGreaterThan(0);
      expect(birds(source)).toEqual(birds(source));
      const key = (a: { kind: string; homeX: number; homeY: number }) => `${a.kind}:${a.homeX},${a.homeY}`;
      const reversed = birds({ ...source, trees: [...source.trees].reverse() });
      expect(reversed.map(key).sort()).toEqual(birds(source).map(key).sort());
    });
  });
});
