import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Der Controller ersetzt drei `ParticleEmitter` *je brennender Entity* durch einen einzigen
 * gemeinsamen Emissions-Tick. Geprueft wird deshalb genau das, was diese Umkehrung tragen muss:
 * dass die Zahl der Tick-Registrierungen nicht mit der Zahl der Braende waechst, dass die
 * stackabhaengige Fachlogik unveraendert ankommt, und dass eine verloeschende Entity nur ihre
 * eigenen Partikel mitnimmt.
 */

/** Deterministisch: `FloatBetween` liefert immer die Mitte, `Circle.Random` den Mittelpunkt. */
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
    FloatBetween: (min: number, max: number) => (min + max) / 2,
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Vector2: class { constructor(public x = 0, public y = 0) {} },
  },
  Geom: {
    Circle: Object.assign(
      class {
        constructor(public x = 0, public y = 0, public radius = 0) {}
        setTo(x: number, y: number, radius: number) { this.x = x; this.y = y; this.radius = radius; return this; }
      },
      {
        Random: (circle: { x: number; y: number }, out: { x: number; y: number }) => {
          out.x = circle.x;
          out.y = circle.y;
          return out;
        },
      },
    ),
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { EntityBurnGpuController } from '../src/effects/EntityBurnGpuController';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  const registrations: unknown[] = [];
  const original = system.registerEmission.bind(system);
  system.registerEmission = (tick) => { registrations.push(tick); original(tick); };
  const controller = new EntityBurnGpuController(system);
  return { scene, system, controller, registrations };
}

/** Lebende Member der Entity-Burn-Lane. */
function liveBurnMembers(system: GpuVfxSystem): number {
  return system.getLaneStats(GpuVfxLaneId.EntityBurn)?.liveCount ?? 0;
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
});

describe('EntityBurnGpuController', () => {
  it('registers exactly one emission tick, no matter how many entities burn', () => {
    const { controller, registrations } = setup();
    expect(registrations.length).toBe(1);

    for (let index = 0; index < 20; index += 1) {
      const handle = controller.acquire();
      controller.update(handle, index * 10, 0, 32, 4, 'normal');
    }

    // Frueher waeren das 60 Emitter und – bei naiver Umsetzung – 20 Emissions-Callbacks gewesen.
    expect(registrations.length).toBe(1);
  });

  it('emits core, outer and spark for an active burn', () => {
    const { scene, system, controller } = setup();
    const layer = findFakeLane(scene, 'entity-burn');
    const handle = controller.acquire();
    controller.update(handle, 100, 200, 32, 1, 'normal');

    // Bei 1 Stack: core 44 ms, outer 56 ms, spark 98 ms – 200 ms reichen fuer alle drei.
    system.update(200);

    const frames = layer.members.map((member) => member.frame);
    expect(frames).toContain('flame-core');
    expect(frames).toContain('flame-outer');
    expect(frames).toContain('flame-spark');
  });

  it('raises frequency and quantity with the burn stacks', () => {
    const { scene, system, controller } = setup();
    const layer = findFakeLane(scene, 'entity-burn');

    const weak = controller.acquire();
    controller.update(weak, 0, 0, 32, 1, 'normal');
    system.update(500);
    const weakSpawns = layer.members.length;

    layer.members.length = 0;
    const strong = controller.acquire();
    controller.update(strong, 500, 0, 32, 32, 'normal');
    controller.setInactive(weak);
    system.update(500);

    // 32 Stacks fahren jede Frequenz auf ihr Minimum und verdoppeln core wie outer.
    expect(layer.members.length).toBeGreaterThan(weakSpawns * 2);
  });

  it('switches motif and palette per member when the style turns void', () => {
    const { scene, system, controller } = setup();
    const layer = findFakeLane(scene, 'entity-burn');
    const handle = controller.acquire();

    controller.update(handle, 0, 0, 32, 8, 'void');
    system.update(200);

    // Kein Umfaerben eines geteilten Emitters mehr: das Motiv haengt am einzelnen Member.
    expect(layer.members.every((member) => member.frame?.endsWith('-void'))).toBe(true);
  });

  it('scales the particle alpha by the stack factor, not just its curve', () => {
    const { scene, system, controller } = setup();
    const layer = findFakeLane(scene, 'entity-burn');
    const handle = controller.acquire();

    controller.update(handle, 0, 0, 32, 1, 'normal');
    system.update(60);

    const core = layer.members.find((member) => member.frame === 'flame-core');
    // intensity = clamp(log2(2)/5, 0.2, 1) = 0.2 -> 1 * (0.72 + 0.2 * 0.28) = 0.776.
    expect(core?.alpha.base).toBeCloseTo(0.776, 6);
  });

  it('takes only its own particles along when one burn ends', () => {
    const { system, controller } = setup();
    const first = controller.acquire();
    const second = controller.acquire();
    controller.update(first, 0, 0, 32, 8, 'normal');
    controller.update(second, 400, 0, 32, 8, 'normal');
    system.update(200);

    const before = liveBurnMembers(system);
    expect(before).toBeGreaterThan(1);

    controller.release(first);
    // `kill-with-source`: die Member des ersten Brandes sind sofort still, die des zweiten leben.
    const after = liveBurnMembers(system);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('recycles the handle of a released burn', () => {
    const { controller } = setup();
    const first = controller.acquire();
    controller.release(first);
    expect(controller.acquire()).toBe(first);
  });

  it('stops emitting after setInactive and resumes on the next update', () => {
    const { scene, system, controller } = setup();
    const layer = findFakeLane(scene, 'entity-burn');
    const handle = controller.acquire();
    controller.update(handle, 0, 0, 32, 8, 'normal');
    system.update(200);
    expect(layer.members.length).toBeGreaterThan(0);

    controller.setInactive(handle);
    layer.members.length = 0;
    system.update(200);
    expect(layer.members.length).toBe(0);

    controller.update(handle, 0, 0, 32, 8, 'normal');
    system.update(200);
    expect(layer.members.length).toBeGreaterThan(0);
  });
});
