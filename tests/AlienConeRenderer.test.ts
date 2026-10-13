import { describe, expect, it, vi } from 'vitest';

// Headless: the GPU layer only creates its pass on a WebGL renderer, which this fixture lacks.
vi.mock('phaser', () => ({
  Scenes: { Events: { PRE_RENDER: 'prerender' } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
}));
import { AlienConeRenderer } from '../src/effects/AlienConeRenderer';
import { ALIEN_CONE_KIND, ALIEN_CONE_WAVE_LIFE_S } from '../src/effects/gpu/AlienConeShader';
import { CLAW_VFX_FAN_RAYS, ClawVfxKind, CLAW_VFX_INSTANCE_FLOATS, CLAW_VFX_FLOATS_PER_VERTEX, EnemyClawVfxStore } from '../src/effects/enemyClaw/EnemyClawVfxStore';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';
import { ENERGY_CONE_CLIP_RAYS, type EnergyConeState } from '../src/systems/EnergyConeState';

const WORDS = 22, VERTICES = 6, KIND_WORD = 7, T_WORD = 8;
const clip = Array(ENERGY_CONE_CLIP_RAYS).fill(1);
const attack = { originX: 0, originY: 0, angle: 0, range: 340, arcDegrees: 80, startedAt: 1000, hitAt: 2000, recoverUntil: 2400, clip };

function fixture() {
  const listeners: (() => void)[] = [];
  const scene = {
    time: { now: 0 },
    cameras: { main: { width: 4000, height: 4000, originX: 0.5, originY: 0.5, zoom: 1, scrollX: -2000, scrollY: -2000 } },
    events: { on: (e: string, fn: () => void, ctx: unknown) => { if (e === 'prerender') listeners.push(fn.bind(ctx)); }, off: () => {} },
  };
  const renderer = new AlienConeRenderer(scene as never);
  let clock = 0;
  renderer.setClock(() => clock);
  const sink = vi.fn();
  renderer.setSectorSink(sink);
  const frame = () => (renderer as unknown as { layer: { frame: { data: Float32Array; count: number } } }).layer.frame;
  const items = () => { const f = frame(); return Array.from({ length: f.count }, (_, i) => ({
    kind: f.data[i * VERTICES * WORDS + KIND_WORD], t: f.data[i * VERTICES * WORDS + T_WORD] })); };
  return { renderer, sink, items, render: (at: number) => { clock = at; scene.time.now = at; listeners.forEach(fn => fn()); } };
}

function alien(state: () => EnergyConeState, faction: 'hostile' | 'allied' = 'hostile'): EnemyVisualSource {
  return { id: 'a1', kind: 'alien-badger', faction, sprite: { active: true, x: 0, y: 0 } as never,
    getHp: () => 180, isVulnerable: () => false, getNetSnapshot: () => ({ energyCone: state() }) as never };
}

describe('AlienConeRenderer', () => {
  it('hands a hostile windup with its cover profile to the shared danger zone and charges at the muzzle', () => {
    const f = fixture();
    const state: EnergyConeState = { revision: 1, phase: 'windup', attack };
    f.renderer.setEnemySource(() => [alien(() => state)]);
    f.render(1500);
    expect(f.sink).toHaveBeenLastCalledWith('a1', expect.objectContaining({ range: 340, arcDegrees: 80, clip, hitAt: 2000 }), 1500, true);
    const charge = f.items().find(item => item.kind === ALIEN_CONE_KIND.charge)!;
    expect(charge.t).toBeCloseTo(0.5);
    expect(f.items().some(item => item.kind === ALIEN_CONE_KIND.wave)).toBe(false);
  });

  it('plays the wave after the impulse, also for a late observer, and never after a cancelled windup', () => {
    const f = fixture();
    const state: EnergyConeState = { revision: 2, phase: 'recover', attack };
    f.renderer.setEnemySource(() => [alien(() => state)]);
    f.render(2100); // first seen 100 ms after the impulse: the remaining wave plays
    const wave = f.items().find(item => item.kind === ALIEN_CONE_KIND.wave)!;
    expect(wave.t).toBeCloseTo(0.1);
    expect(f.sink).not.toHaveBeenCalledWith('a1', expect.anything(), expect.anything(), expect.anything());
    f.render(attack.hitAt + ALIEN_CONE_WAVE_LIFE_S * 1000 + 20);
    expect(f.items()).toEqual([]);

    const g = fixture();
    let cancelled: EnergyConeState = { revision: 1, phase: 'windup', attack };
    g.renderer.setEnemySource(() => [alien(() => cancelled)]);
    g.render(1500);
    cancelled = { revision: 2, phase: 'none', attack: null };
    g.render(2050);
    expect(g.sink).toHaveBeenLastCalledWith('a1', null, 2050, false);
    expect(g.items()).toEqual([]);
  });

  it('draws allied windups only as a quiet outline, without the red danger zone', () => {
    const f = fixture();
    const state: EnergyConeState = { revision: 1, phase: 'windup', attack };
    f.renderer.setEnemySource(() => [alien(() => state, 'allied')]);
    f.render(1500);
    expect(f.sink).not.toHaveBeenCalled();
    expect(f.items().map(item => item.kind).sort()).toEqual([ALIEN_CONE_KIND.charge, ALIEN_CONE_KIND.quiet].sort());
  });
});

describe('AlienConeRenderer audio', () => {
  it('plays the charge once at the start and the pulse at the impulse, but stays silent for late observers', () => {
    const f = fixture();
    const audio = { playSound: vi.fn() };
    f.renderer.setAudioSystem(audio as never);
    let state: EnergyConeState = { revision: 1, phase: 'windup', attack };
    f.renderer.setEnemySource(() => [alien(() => state)]);
    f.render(1050); f.render(1500);
    expect(audio.playSound.mock.calls.map(call => call[0])).toEqual(['sfx_alien_cone_charge']);
    state = { revision: 2, phase: 'recover', attack };
    f.render(2030);
    expect(audio.playSound).toHaveBeenLastCalledWith('sfx_alien_cone_pulse', 0, 0, 'a1', 1);

    const late = fixture();
    const quiet = { playSound: vi.fn() };
    late.renderer.setAudioSystem(quiet as never);
    late.renderer.setEnemySource(() => [alien(() => ({ revision: 2, phase: 'recover', attack }))]);
    late.render(2400);
    expect(quiet.playSound).not.toHaveBeenCalled();
  });
});

describe('fan telegraph wedges', () => {
  it('writes one instance per wedge with both ray reaches packed, and removes them together', () => {
    const store = new EnemyClawVfxStore();
    const profile = Array.from({ length: CLAW_VFX_FAN_RAYS }, (_, i) => i / (CLAW_VFX_FAN_RAYS - 1));
    expect(store.addFan('cone', { x: 0, y: 0, angle: 0, range: 340, halfArc: 0.7, clip: profile,
      startedAt: 0, strikeAt: 800, hitAt: 1000, color: 0xff4a36 }, 0)).toBe(true);
    expect(store.count).toBe(CLAW_VFX_FAN_RAYS - 1);
    const vertex = (slot: number) => slot * CLAW_VFX_INSTANCE_FLOATS;
    for (let slot = 0; slot < store.count; slot++) {
      const o = vertex(slot);
      expect(store.data[o + 10]).toBe(ClawVfxKind.FanWedge);
      const wedge = store.data[o + CLAW_VFX_FLOATS_PER_VERTEX - 1];
      const packed = store.data[o + 11];
      expect(Math.floor(packed / 256)).toBe(Math.round(profile[wedge] * 255));
      expect(packed % 256).toBe(Math.round(profile[wedge + 1] * 255));
    }
    store.removeFan('cone');
    expect(store.count).toBe(0);
  });
});
