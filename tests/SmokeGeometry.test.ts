import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  // Use Phaser's actual DOM-free geometry primitives, so corner and trunk shadows are real.
  const require = (await import('node:module')).createRequire(import.meta.url);
  const root = (await import('node:path')).dirname(require.resolve('phaser/package.json'));
  const geom = (path: string) => require(`${root}/src/geom/${path}.js`);
  return { Geom: {
    Circle: geom('circle/Circle'), Rectangle: geom('rectangle/Rectangle'),
    Line: geom('line/index'), Intersects: {
      GetLineToRectangle: geom('intersects/GetLineToRectangle'),
      GetLineToCircle: geom('intersects/GetLineToCircle'),
    },
  }, Math: { Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) } } };
});
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { CombatGeometry } from '../src/systems/CombatGeometry';
import { SmokeRuntime } from '../src/systems/SmokeRuntime';
import { smokeEffect, smokeSource } from './SmokeTestHelper';

function geometry(boxes: readonly [number, number, number, number][], trunks: readonly { x: number; y: number; radius: number; active: boolean }[] = []) {
  const rocks = boxes.map(([left, top, right, bottom]) => ({ active: true,
    getBounds: () => ({ left, top, right, bottom }) }));
  const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: -500, offsetY: -500, width: 1000, height: 1000 }),
    rocks: () => rocks as never, bases: () => [], trunks: () => trunks });
  const geo = new CombatGeometry(index);
  const runtime = new SmokeRuntime({ hasClearLine: (...p) => geo.hasLineOfSight(...p),
    hasVisibleSegment: (...p) => geo.hasVisibleSegmentFrom(...p),
    setVulnerability() {}, spawnProjectile() {}, isFriendlySource: () => true });
  runtime.createCloud(0, 0, smokeEffect({ nearSightPx: 5 }, { radius: 200 }), smokeSource(), 0);
  return { geo, runtime };
}

describe('smoke obstacle visibility', () => {
  it('ignores fully shielded smoke and still sees an exposed part around a corner', () => {
    const { runtime, geo } = geometry([[40, -15, 60, 15]]);
    expect(geo.hasLineOfSight(0, 0, 100, 0)).toBe(false);
    expect(runtime.canSee('e', 100, -10, 100, 10, 500, 100)).toBe(true);
    expect(runtime.canSee('e', 100, -100, 100, 100, 500, 100)).toBe(false);
  });
  it('finds a narrow exposed interval even when the endpoints and midpoint are shielded', () => {
    const { runtime, geo } = geometry([[40, -100, 60, -20], [40, -10, 60, 10], [40, 20, 60, 100]]);
    for (const y of [-80, 0, 80]) expect(geo.hasLineOfSight(0, 0, 100, y)).toBe(false);
    expect(geo.hasVisibleSegmentFrom(0, 0, 100, -80, 100, 80)).toBe(true);
    expect(runtime.canSee('e', 100, -80, 100, 80, 500, 100)).toBe(false);
  });
  it('uses trunk tangents and live obstacle removal for exposure and sight', () => {
    const trunk = { x: 50, y: 0, radius: 10, active: true };
    const { runtime } = geometry([], [trunk]);
    expect(runtime.canSee('e', 100, -10, 100, 10, 500, 100)).toBe(true);
    expect(runtime.canSee('e', 100, -80, 100, 80, 500, 100)).toBe(false);
    trunk.active = false;
    expect(runtime.canSee('e', 100, -10, 100, 10, 500, 100)).toBe(false);
  });
});
