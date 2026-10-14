import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLIED_PALETTE } from '../src/config';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../src/config/coopDefenseEnemies';
import { ENEMY_CLAW_HOSTILE_COLOR } from '../src/effects/EnemyClawRenderer';
import { DRONE_NAV_LIGHT_COLORS, DRONE_NAV_LIGHT_PROFILES, DroneNavLightModel,
  type DroneNavLightProfile } from '../src/effects/droneNavLights/DroneNavLightModel';
import { DroneNavLightRenderer } from '../src/effects/droneNavLights/DroneNavLightRenderer';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1 }, Scenes: { Events: { PRE_RENDER: 'prerender' } } }));
vi.mock('../src/effects/EffectUtils', () => ({ fillRadialGradientTexture: () => {},
  registerGraphicsObject: () => {}, mixColors: (a: number) => a }));
vi.mock('../src/graphics/CameraWorldView', () => ({ createVisibleWorldView: () => ({}),
  getVisibleWorldView: () => ({ centerX: 0, centerY: 0 }) }));
const batches = vi.hoisted(() => [] as any[]);
vi.mock('../src/effects/EnemyEyeBatch', () => ({ EnemyEyeBatch: class {
  points: number[][] = [];
  layer = { name: '', setBlendMode() {}, setName: (name: string) => { this.layer.name = name; } };
  destroy = vi.fn();
  constructor() { batches.push(this); }
  begin() { this.points = []; }
  write(...point: number[]) { this.points.push(point); }
} }));

describe('drone navigation light model', () => {
  it('keeps low flyers below tree crowns and high-flying bombers above them', () => {
    expect(DRONE_NAV_LIGHT_PROFILES.attackDrone.band).toBe('under-canopy');
    expect(DRONE_NAV_LIGHT_PROFILES.repairDrone.band).toBe('under-canopy');
    expect(DRONE_NAV_LIGHT_PROFILES.bomberDrone.band).toBe('over-canopy');
  });

  it.each(Object.entries(DRONE_NAV_LIGHT_PROFILES))('rotates %s anchors in the flight frame and preserves its band', (_name, profile) => {
    // East, south, west, north: forward and right in Phaser screen coordinates; a banking body narrows only laterally.
    for (const [heading, fx, fy, rx, ry, lateralScale] of [[0, 1, 0, 0, 1, 1], [Math.PI / 2, 0, 1, -1, 0, .8],
      [Math.PI, -1, 0, 0, -1, 1], [-Math.PI / 2, 0, -1, 1, 0, .8]]) {
      const model = new DroneNavLightModel();
      model.submit(100, 200, heading, 1, profile, {}, lateralScale);
      expect(model.pointCount).toBe(profile.anchors.length);
      for (const [i, anchor] of profile.anchors.entries()) {
        expect(model.points[i].x).toBeCloseTo(100 + fx * anchor.forward + rx * anchor.lateral * lateralScale);
        expect(model.points[i].y).toBeCloseTo(200 + fy * anchor.forward + ry * anchor.lateral * lateralScale);
        expect(model.points[i]).toMatchObject({ kind: anchor.kind, band: profile.band, heading });
      }
      expect(profile.anchors.find(a => a.kind === 'nose')!.forward).toBeGreaterThan(0);
      expect(profile.anchors.find(a => a.kind === 'tail')!.forward).toBeLessThan(0);
    }
  });

  it.each([0, 1, 7, 30])('limits only ground pools to the nearest %s entries', max => {
    const model = new DroneNavLightModel(), profile = DRONE_NAV_LIGHT_PROFILES.repairDrone;
    const count = 20, center = { x: 350, y: 45 };
    for (let i = 0; i < count; i++) model.submit(i * 40, i % 3 * 70, 0, 1, profile, {});
    const distance = (p: { x: number; y: number }) => (p.x - center.x) ** 2 + (p.y - center.y) ** 2;
    const expected = model.pools.slice(0, model.poolCount).sort((a, b) => distance(a) - distance(b)).slice(0, max);
    model.limitPools(center.x, center.y, max);
    expect(model.poolCount).toBe(Math.min(max, count));
    expect(model.pools.slice(0, model.poolCount).sort((a, b) => distance(a) - distance(b))).toEqual(expected);
    expect(model.pointCount).toBe(count * profile.anchors.length);
  });

  it('rejects invisible submissions and keeps each drone beacon phase across cleared frames', () => {
    const model = new DroneNavLightModel(), profile = DRONE_NAV_LIGHT_PROFILES.repairDrone;
    for (const alpha of [-1, 0, .005, .01]) model.submit(1, 2, 0, alpha, profile, {});
    expect(model.pointCount).toBe(0); expect(model.poolCount).toBe(0);
    const first = {}, second = {};
    model.submit(1, 2, 0, 1, profile, first);
    const phase = model.points[0].phase;
    expect(model.points.slice(0, model.pointCount).every(p => p.phase === phase)).toBe(true);
    model.submit(1, 2, 0, 1, profile, second);
    const otherPhase = model.points[profile.anchors.length].phase;
    expect(otherPhase).not.toBe(phase);
    model.clear();
    expect(model.pointCount).toBe(0); expect(model.poolCount).toBe(0);
    model.submit(50, 80, Math.PI, .5, profile, second);
    expect(model.points[0].phase).toBe(otherPhase);
    model.submit(90, 20, 0, 1, profile, first);
    expect(model.points[profile.anchors.length].phase).toBe(phase);
  });

  it('separates saturated navigation colors from eyes, allied jade, danger red and holo mint', () => {
    const reserved = [...Object.values(COOP_DEFENSE_ENEMY_CONFIGS).flatMap(c => c.eyeGlow ? [c.eyeGlow.color] : []),
      ...Object.values(ALLIED_PALETTE), ENEMY_CLAW_HOSTILE_COLOR, 0x3dffd0];
    expect(reserved.length).toBeGreaterThan(Object.keys(ALLIED_PALETTE).length + 2);
    // HSV saturation <= 25% describes the deliberately desaturated warm-white lamps.
    expect(hsv(DRONE_NAV_LIGHT_COLORS.nose).s).toBeLessThanOrEqual(.25);
    expect(hsv(DRONE_NAV_LIGHT_COLORS.nose).h).toBeGreaterThan(0);
    expect(hsv(DRONE_NAV_LIGHT_COLORS.nose).h).toBeLessThan(60);
    expect(hsv(DRONE_NAV_LIGHT_COLORS.tail).s).toBeGreaterThan(.25);
    for (const [kind, color] of Object.entries(DRONE_NAV_LIGHT_COLORS)) {
      const nav = hsv(color);
      if (nav.s <= .25) continue;
      for (const reference of reserved) {
        const difference = Math.abs(nav.h - hsv(reference).h);
        expect(Math.min(difference, 360 - difference), `${kind} vs #${reference.toString(16)}`).toBeGreaterThanOrEqual(25);
      }
    }
  });
});

function hsv(color: number) {
  const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  const hue = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? delta / max : 0 };
}

describe('drone navigation light renderer', () => {
  beforeEach(() => { batches.length = 0; });
  it('flushes only current submissions, clears an empty frame and releases pools and hooks on destroy', () => {
    const listeners = new Map<string, () => void>();
    const scene = { textures: {}, time: { now: 0 }, cameras: { main: {} }, events: {
      on: (name: string, fn: () => void, context: unknown) => { listeners.set(name, fn.bind(context)); },
      off: (name: string) => { listeners.delete(name); },
    } };
    const pools = new Map<object, { lightCount: number }>();
    const lighting = { setGroundGlowLights: (key: object, frame: { lightCount: number } | null) => {
      if (frame) pools.set(key, frame); else pools.delete(key);
    } };
    const renderer = new DroneNavLightRenderer(scene as never, lighting as never);
    const flush = () => listeners.get('prerender')!();
    const submit = (profile: DroneNavLightProfile, x: number) => renderer.submit(x, 20, 0, 1, profile, {});
    const points = (band: string) => batches.find(b => b.layer.name === `drone-nav-cores:${band}`).points;
    submit(DRONE_NAV_LIGHT_PROFILES.attackDrone, 100);
    submit(DRONE_NAV_LIGHT_PROFILES.bomberDrone, 200);
    flush();
    expect(points('under-canopy')).toHaveLength(DRONE_NAV_LIGHT_PROFILES.attackDrone.anchors.length);
    expect(points('over-canopy')).toHaveLength(DRONE_NAV_LIGHT_PROFILES.bomberDrone.anchors.length);
    submit(DRONE_NAV_LIGHT_PROFILES.repairDrone, 500);
    flush();
    expect(points('under-canopy').map((p: number[]) => p[0])).toEqual(DRONE_NAV_LIGHT_PROFILES.repairDrone.anchors.map(a => 500 + a.forward));
    expect(points('over-canopy')).toHaveLength(0);
    flush();
    expect(batches.every(b => b.points.length === 0)).toBe(true);
    expect(pools.get(renderer)?.lightCount).toBe(0);
    submit(DRONE_NAV_LIGHT_PROFILES.repairDrone, 100); flush();
    expect(pools.get(renderer)!.lightCount).toBeGreaterThan(0);
    renderer.destroy(); renderer.destroy();
    expect(pools.size).toBe(0); expect(listeners.size).toBe(0);
    expect(batches.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    submit(DRONE_NAV_LIGHT_PROFILES.repairDrone, 200);
    expect(renderer.model.pointCount).toBe(0);
  });
});
