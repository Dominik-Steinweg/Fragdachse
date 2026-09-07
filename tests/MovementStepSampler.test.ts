import { describe, expect, it } from 'vitest';
import { createMovementVisualSample, MovementStepSampler, type MovementContactSink } from '../src/effects/MovementStepSampler';
import { MOVEMENT_FX, type PawCount } from '../src/config/movementEffects';
import { MovementParticleBudget } from '../src/effects/MovementParticleBudget';

function walk(paws: PawCount, fps: number, qualitySkip = 1, facing = 0) {
  const sampler = new MovementStepSampler();
  const s = { ...createMovementVisualSample(), visible: true, mode: 'walk' as const, pawCount: paws, facing };
  const contacts: Parameters<MovementContactSink>[] = [];
  let seen = 0;
  const sink: MovementContactSink = (...event) => { if (seen++ % qualitySkip === 0) contacts.push(event); };
  sampler.advance(s, 1000 / fps, sink);
  for (let frame = 1; frame <= fps; frame++) {
    s.x = 128 * frame / fps;
    sampler.advance(s, 1000 / fps, sink);
  }
  return contacts;
}

describe('distance-driven movement contacts', () => {
  it.each([2, 4] as const)('keeps %i-paw world contacts equal across frame rates', (paws) => {
    const reference = walk(paws, 30);
    for (const fps of [60, 120]) {
      const actual = walk(paws, fps);
      expect(actual).toHaveLength(reference.length);
      actual.forEach((e, i) => {
        expect(e[0]).toBe('step');
        expect(e[1]).toBeCloseTo(reference[i][1]);
        expect(e[2]).toBeCloseTo(reference[i][2]);
        expect(e[4]).toBe(reference[i][4]);
      });
    }
  });

  it('alternates left/right for bipeds and distinct front/hind diagonal contacts for quadrupeds', () => {
    const two = walk(2, 60);
    const four = walk(4, 60);
    expect(two.map(e => e[4])).toEqual([0, 1, 0, 1]);
    expect(four.map(e => e[4])).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(two.slice(0, 2).map(e => Math.sign(e[2]))).toEqual([-1, 1]);
    expect(four.slice(0, 4).map(e => Math.sign(e[2]))).toEqual([-1, 1, 1, -1]);
    // Remove travelled center distance: front contacts lead, hind contacts trail it.
    expect(four.slice(0, 4).map((e, i) => Math.sign(e[1] - (i + 1) * 16))).toEqual([1, -1, 1, -1]);
    expect(walk(4, 60, 3).map(e => e[4])).toEqual([0, 3, 2]);
  });

  it('leaves standing, blocked input and tiny interpolation settling silent', () => {
    const sampler = new MovementStepSampler();
    const s = { ...createMovementVisualSample(), visible: true, mode: 'walk' as const };
    const events: string[] = [];
    for (let i = 0; i < 1000; i++) {
      s.x = i % 2 ? 0.01 : 0;
      s.facing = i * 0.05;
      sampler.advance(s, 16, kind => events.push(kind));
    }
    expect(events).toEqual([]);
  });

  it.each([2, 4] as const)('keeps %i-paw anatomy facing the body during backward and sideways travel', paws => {
    const forward = walk(paws, 60);
    for (const facing of [Math.PI, Math.PI / 2]) {
      const contacts = walk(paws, 60, 1, facing);
      for (let i = 0; i < contacts.length; i++) {
        const centerX = (i + 1) * 2 * 32 / paws;
        const localX = forward[i][1] - centerX, localY = forward[i][2];
        expect(contacts[i][1] - centerX).toBeCloseTo(Math.cos(facing) * localX - Math.sin(facing) * localY);
        expect(contacts[i][2]).toBeCloseTo(Math.sin(facing) * localX + Math.cos(facing) * localY);
        expect(contacts[i][3]).toBeCloseTo(0); // Dust still follows rightward travel.
        expect(contacts[i][4]).toBe(forward[i][4]);
        expect(contacts[i][6]).toBeCloseTo(facing);
      }
    }
  });

  it('interpolates facing at each contact over the shortest turn across the angle seam', () => {
    const sampler = new MovementStepSampler();
    const s = { ...createMovementVisualSample(), visible: true, mode: 'walk' as const, facing: Math.PI * 170 / 180 };
    const contacts: Parameters<MovementContactSink>[] = [];
    const sink: MovementContactSink = (...event) => contacts.push(event);
    sampler.advance(s, 16, sink);
    s.x = 64; s.facing = -Math.PI * 170 / 180;
    sampler.advance(s, 16, sink);
    expect(contacts).toHaveLength(2);
    expect(contacts[0][6]).toBeCloseTo(Math.PI);
    expect(Math.cos(contacts[1][6])).toBeCloseTo(Math.cos(s.facing));
    expect(Math.sin(contacts[1][6])).toBeCloseTo(Math.sin(s.facing));
  });

  it('resets at visibility, revision, teleport and frame gaps without connecting old trails', () => {
    for (const interruption of ['hidden', 'revision', 'jump', 'pause'] as const) {
      const sampler = new MovementStepSampler();
      const s = { ...createMovementVisualSample(), visible: true, mode: 'walk' as const };
      const events: string[] = [];
      const sink: MovementContactSink = k => events.push(k);
      sampler.advance(s, 16, sink);
      s.x = 25; sampler.advance(s, 16, sink);
      if (interruption === 'hidden') s.visible = false;
      if (interruption === 'revision') s.revision++;
      s.x = interruption === 'jump' ? 2000 : 30;
      sampler.advance(s, interruption === 'pause' ? MOVEMENT_FX.maxFrameMs + 1 : 16, sink);
      s.visible = true;
      sampler.advance(s, 16, sink);
      s.x += 5; sampler.advance(s, 16, sink);
      expect(events, interruption).toEqual([]);
    }
  });

  it('emits each dash edge once, suppresses steps and does not invent bootstrap edges', () => {
    const sampler = new MovementStepSampler();
    const s = { ...createMovementVisualSample(), visible: true };
    const events: string[] = [];
    const sink: MovementContactSink = k => events.push(k);
    sampler.advance(s, 16, sink);
    s.mode = 'dash';
    for (let i = 0; i < 8; i++) { s.x += 10; sampler.advance(s, 16, sink); }
    s.mode = 'recovery'; sampler.advance(s, 16, sink); sampler.advance(s, 16, sink);
    expect(events.filter(k => k === 'dashStart')).toHaveLength(1);
    expect(events.filter(k => k === 'dashEnd')).toHaveLength(1);
    expect(events).toContain('dashTrail');
    expect(events).not.toContain('step');
    events.length = 0; sampler.reset(); s.mode = 'dash';
    sampler.advance(s, 16, sink); s.x += 20; sampler.advance(s, 16, sink);
    expect(events).not.toContain('dashStart');
  });
});

it('budgets varied expiries, preserves player reserve and clears without growing', () => {
  const budget = new MovementParticleBudget(4, 1);
  for (const expiry of [400, 100, 300]) budget.record(expiry);
  expect(budget.canSpawn(false)).toBe(false);
  expect(budget.canSpawn(true)).toBe(true);
  budget.record(200);
  expect(budget.canSpawn(true)).toBe(false);
  budget.retire(150); expect(budget.liveCount).toBe(3);
  budget.retire(350); expect(budget.liveCount).toBe(1);
  budget.retire(500); expect(budget.liveCount).toBe(0);
  budget.record(1000); budget.clear(); expect(budget.liveCount).toBe(0);
});
