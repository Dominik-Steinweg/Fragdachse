import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import { applyArenaWorldMetrics, type ArenaMetricsProfile } from '../src/config';
import type { ArenaLayout } from '../src/types';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import { WorldPresentationBinding } from '../src/world/WorldPresentationBinding';
import { WorldPresentationHandoff } from '../src/world/WorldPresentationHandoff';
import { getCameraBaseScroll } from '../src/graphics/cameraBaseScroll';
import {
  resetWorldCameraBase,
  WorldPresentationFrameBinding,
  type WorldPresentationFrameBindingInput,
} from '../src/world/WorldPresentationFrameBinding';
import {
  WORLD_PRESENTATION_SURFACES,
  WORLD_PREVIEW_PRESENTATION_SURFACES,
  type WorldPresentationRequirement,
} from '../src/world/WorldPresentation';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Phase 5 legte das Lifetime-Fundament der World-Presentation-Verdrahtung; Phase 6A gibt
 * `WorldPresentationFrameBinding` die World-Display-Synchronisierung. `WorldPresentationBinding`
 * bleibt die handoffbare, gameplay-freie Darstellung selbst. Diese Tests halten fest, dass der
 * Frame-Binding immer vor der Darstellung faellt, nie im Handoff landet, und dass eine World
 * ohne Activity denselben Weg nimmt wie eine mit - und pruefen das reale Frame-Verhalten.
 */

function descriptor(): WorldDescriptor {
  return {
    worldRevision: 21,
    definitionId: 'world:coop-defense:3',
    seed: 909,
    generatorVersion: 3,
    layoutFingerprint: 'abc123',
  };
}

function context(): WorldRuntimeContext {
  return { descriptor: descriptor() } as WorldRuntimeContext;
}

function runtime(): WorldRuntime {
  return new WorldRuntime(context());
}

function presentationBinding(onDestroy: () => void): WorldPresentationBinding {
  return new WorldPresentationBinding(
    { name: 'layout' } as unknown as ArenaLayout,
    { name: 'arena' } as unknown as ArenaBuilderResult,
    { destroyPresentation: onDestroy },
  );
}

/** Ein hinreichend breites, dynamisches Profil - fuer Kamera-Tests unabhaengig vom Default. */
const WIDE_DYNAMIC_PROFILE: ArenaMetricsProfile = {
  arenaWidth: 4000,
  arenaOffsetX: 0,
  arenaViewportWidth: 1920,
  arenaHeight: 2000,
  arenaOffsetY: 0,
  arenaViewportHeight: 1080,
  usesDynamicCamera: true,
  showStaticArenaFrames: false,
};

interface FakeCamera {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  zoom: number;
}

function fakeCamera(): FakeCamera {
  return { scrollX: 0, scrollY: 0, width: 1920, height: 1080, originX: 0, originY: 0, zoom: 1 };
}

function fakeScene(camera: FakeCamera = fakeCamera()) {
  return { cameras: { main: camera } } as unknown as WorldPresentationFrameBindingInput['scene'];
}

const INTERACTIVE_PRESENTATION: WorldPresentationRequirement = {
  required: true,
  mode: 'interactive',
  surfaces: WORLD_PRESENTATION_SURFACES,
};
const PREVIEW_PRESENTATION: WorldPresentationRequirement = {
  required: true,
  mode: 'preview',
  surfaces: WORLD_PREVIEW_PRESENTATION_SURFACES,
};

function fakeBindingInput(
  scene: WorldPresentationFrameBindingInput['scene'],
  overrides: Partial<WorldPresentationFrameBindingInput> = {},
): WorldPresentationFrameBindingInput {
  return {
    scene,
    getLocalWorldPresentation: () => INTERACTIVE_PRESENTATION,
    getSpectatorCameraInput: () => undefined,
    getLocalPlayerSprite: () => null,
    isLocalPlayerSpectator: () => false,
    isLocalPlayerAlive: () => false,
    isArenaLoading: () => false,
    isArenaCountdownActive: () => false,
    getArenaResult: () => null,
    shadow: {
      updateStaticResidency: vi.fn(),
      getStaticSurfaceWorkingSet: vi.fn(() => null),
      isStaticReadyForView: vi.fn(() => false),
      syncStaticProfile: vi.fn(),
      syncDynamicShadows: vi.fn(),
      clear: vi.fn(),
    } as never,
    lighting: {
      setDynamicOccluderSource: vi.fn(),
      clearDynamicOccluderSource: vi.fn(),
      resolveCanopyTint: vi.fn(() => 0),
    } as never,
    getWorldLayout: () => null,
    getWorldMetrics: () => null,
    getPersistentBaseSite: () => null,
    getPersistentBaseVisualSite: () => null,
    isPersistentBasePlacementOverlayActive: () => false,
    persistentBaseVisuals: { sync: vi.fn() },
    persistentBasePreview: { syncLights: vi.fn() },
    setLocalPlayerStatusRingActive: vi.fn(),
    setLocalPlayerWorldBarsVisible: vi.fn(),
    isLocalPlayerAttachedToWorld: () => false,
    getPlayers: () => [],
    getProjectileShadowSamples: () => [],
    getProjectileLightSamples: () => [],
    getTrainState: () => null,
    getLiveTrainSegments: () => null,
    getTrainVisual: () => null,
    syncTurretLights: vi.fn(),
    syncBaseLights: vi.fn(),
    getSynchronizedNow: () => 0,
    ...overrides,
  };
}

describe('WorldPresentationFrameBinding – eigener Lifetime und reales Verhalten (Phase 6A.1)', () => {
  it('startet unzerstoert und wird durch destroy() idempotent inert', () => {
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));

    expect(binding.isDestroyed()).toBe(false);
    binding.destroy();
    expect(() => binding.destroy()).not.toThrow();

    expect(binding.isDestroyed()).toBe(true);
  });

  it('nimmt bei einer Preview ohne worldCamera-Flaeche den Early-Return-Pfad, obwohl die World sichtbar bleibt', () => {
    const camera = fakeCamera();
    camera.scrollX = 321;
    camera.scrollY = 654;
    const scene = fakeScene(camera);
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(scene, {
      // Preview zeigt die World als Kulisse - aber ohne 'worldCamera' unter ihren Flaechen.
      getLocalWorldPresentation: () => PREVIEW_PRESENTATION,
      getLocalPlayerSprite: () => ({ active: true, x: 999, y: 999 } as never),
      isLocalPlayerAlive: () => true,
    }));

    // showWorld bleibt true - die World ist zu sehen - trotzdem bewegt sich die Kamera nicht.
    binding.syncCamera(16, true);

    expect(camera.scrollX).toBe(0);
    expect(camera.scrollY).toBe(0);
  });

  it('gleicht die Surface-Residency ausschliesslich waehrend showWorld ab', () => {
    const scene = fakeScene();
    const updateSurfaceResidency = vi.spyOn(ArenaBuilder, 'updateSurfaceResidency')
      .mockImplementation(() => {});
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(scene));

    binding.syncSurfaceResidency(false);
    expect(updateSurfaceResidency).not.toHaveBeenCalled();

    binding.syncSurfaceResidency(true);
    expect(updateSurfaceResidency).toHaveBeenCalledTimes(1);

    updateSurfaceResidency.mockRestore();
  });

  it('laesst einen stalen syncCamera()-Aufruf nach destroy() die Kamera einer nachfolgenden World nicht mehr bewegen', () => {
    applyArenaWorldMetrics(WIDE_DYNAMIC_PROFILE);
    const camera = fakeCamera();
    const scene = fakeScene(camera);
    const spectatorInput = { left: false, right: true, up: false, down: false };

    const worldA = new WorldPresentationFrameBinding(fakeBindingInput(scene, {
      isLocalPlayerSpectator: () => true,
      getSpectatorCameraInput: () => spectatorInput,
    }));
    worldA.syncCamera(1000, true);
    expect(camera.scrollX).toBeGreaterThan(0);
    worldA.destroy();

    // World B uebernimmt dieselbe Scene/Kamera - kein Reset beim Detach, wie im Alltag.
    const worldB = new WorldPresentationFrameBinding(fakeBindingInput(scene, {
      isLocalPlayerSpectator: () => true,
      getSpectatorCameraInput: () => spectatorInput,
    }));
    worldB.syncCamera(500, true);
    const scrollAfterB = camera.scrollX;
    expect(scrollAfterB).toBeGreaterThan(0);

    // Ein staler Aufruf auf dem toten Binding A darf Bs Kamera nicht mehr veraendern.
    worldA.syncCamera(1000, true);
    expect(camera.scrollX).toBe(scrollAfterB);

    // Und die Residency des toten Bindings A darf B ebenfalls nicht mehr anfassen.
    const updateSurfaceResidency = vi.spyOn(ArenaBuilder, 'updateSurfaceResidency')
      .mockImplementation(() => {});
    worldA.syncSurfaceResidency(true);
    expect(updateSurfaceResidency).not.toHaveBeenCalled();
    updateSurfaceResidency.mockRestore();
  });

  it('hinterlaesst ohne aktive World-Presentation denselben neutralen Kamerastand wie eine World ohne Weltkamera', () => {
    applyArenaWorldMetrics(WIDE_DYNAMIC_PROFILE);
    const camera = fakeCamera();
    const scene = fakeScene(camera);
    const spectatorInput = { left: false, right: true, up: false, down: false };

    // Eine World scrollt die Kamera weg ...
    const worldA = new WorldPresentationFrameBinding(fakeBindingInput(scene, {
      isLocalPlayerSpectator: () => true,
      getSpectatorCameraInput: () => spectatorInput,
    }));
    worldA.syncCamera(1000, true);
    expect(camera.scrollX).toBeGreaterThan(0);
    worldA.destroy();

    // ... und zwischen zwei Instanzen gibt es gar keine Presentation-Verdrahtung mehr. Dann muss
    // derselbe neutrale Stand gelten wie bei einer World ohne Weltkamera - sonst rechnete das
    // Kamera-Feedback am Frame-Ende auf der Basis der vergangenen World weiter.
    resetWorldCameraBase(scene);

    expect(camera.scrollX).toBe(0);
    expect(camera.scrollY).toBe(0);
    expect(getCameraBaseScroll(scene)).toEqual({ x: 0, y: 0 });
  });
});

describe('WorldRuntime – dedizierter Slot fuer den Frame-Binding', () => {
  it('faengt den Slot bei materialize()-Aufbaufehlern nicht ein - bind/detach sind eigenstaendig', () => {
    const owner = runtime();
    expect(owner.presentationFrame).toBeNull();

    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));
    owner.bindPresentationFrame(binding);

    expect(owner.presentationFrame).toBe(binding);
    expect(binding.isDestroyed()).toBe(false);
  });

  it('lehnt einen zweiten Frame-Binding auf einem bereits belegten Slot ab', () => {
    const owner = runtime();
    owner.bindPresentationFrame(new WorldPresentationFrameBinding(fakeBindingInput(fakeScene())));

    expect(() => owner.bindPresentationFrame(new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()))))
      .toThrow(/already bound/);
  });

  it('detachPresentationFrame() loest den Slot idempotent und ohne die uebrige Runtime zu beruehren', () => {
    const owner = runtime();
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));
    owner.bindPresentationFrame(binding);

    owner.detachPresentationFrame();
    owner.detachPresentationFrame();

    expect(binding.isDestroyed()).toBe(true);
    expect(owner.presentationFrame).toBeNull();
    expect(owner.isDestroyed()).toBe(false);
  });

  it('destroy() loest einen nicht explizit entfernten Frame-Binding als Sicherheitsnetz genau einmal', () => {
    const owner = runtime();
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));
    owner.bindPresentationFrame(binding);

    owner.destroy();

    expect(binding.isDestroyed()).toBe(true);
    expect(owner.presentationFrame).toBeNull();
  });

  it('destroy() ruft ein zuvor bereits geloestes Sicherheitsnetz nicht doppelt', () => {
    const owner = runtime();
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));
    const destroySpy = vi.spyOn(binding, 'destroy');
    owner.bindPresentationFrame(binding);

    owner.detachPresentationFrame();
    owner.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('nimmt nach destroy() keinen Frame-Binding mehr an', () => {
    const owner = runtime();
    owner.destroy();

    expect(() => owner.bindPresentationFrame(new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()))))
      .toThrow(/destroyed runtime/);
  });
});

describe('Detach-Reihenfolge – FrameBinding faellt vor dem Handoff, der Handoff vor dem Runtime-Teardown', () => {
  function spyingBinding(calls: string[]): WorldPresentationFrameBinding {
    const binding = new WorldPresentationFrameBinding(fakeBindingInput(fakeScene()));
    const original = binding.destroy.bind(binding);
    vi.spyOn(binding, 'destroy').mockImplementation(() => {
      calls.push('frame:destroy');
      original();
    });
    return binding;
  }

  it('haelt exakt die Reihenfolge FrameBinding.destroy -> Handoff.release -> Runtime.destroy ein', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(spyingBinding(calls));
    // World-scoped Systeme, deren Abbau erst mit runtime.destroy() laeuft.
    owner.bind({ destroy: () => { calls.push('runtime:destroy'); } });

    const handoff = new WorldPresentationHandoff();
    // Eine aus einem vorherigen Uebergang noch gehaltene Darstellung: ihr Verdraengen macht den
    // Moment von handoff.release() beobachtbar.
    handoff.release(presentationBinding(() => { calls.push('handoff:release'); }));

    // Exakte Kopie der ArenaLifecycleCoordinator-Detach-Sink-Reihenfolge.
    owner.detachPresentationFrame();
    handoff.release(owner.releasePresentation());
    owner.destroy();

    expect(calls).toEqual(['frame:destroy', 'handoff:release', 'runtime:destroy']);
  });

  it('faellt der Frame-Binding vor der Freigabe an den Handoff, wenn eine Darstellung tatsaechlich uebergeht', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(spyingBinding(calls));
    const shown = presentationBinding(() => { calls.push('presentation:destroy'); });
    owner.setPresentation(shown);

    const handoff = new WorldPresentationHandoff();
    owner.detachPresentationFrame();
    handoff.release(owner.releasePresentation());
    owner.destroy();

    // Die Darstellung geht in den Handoff ueber und wird nicht zerstoert.
    expect(handoff.pending).toBe(shown);
    expect(shown.isDestroyed()).toBe(false);
    expect(calls).toEqual(['frame:destroy']);
  });
});

describe('End-zu-Ende ueber WorldLifecycle – dieselbe Verdrahtung wie im Arena-Coordinator', () => {
  interface LifecycleOwner {
    readonly lifecycle: WorldLifecycle;
    readonly handoff: WorldPresentationHandoff;
    readonly current: () => WorldRuntime | null;
  }

  /** Mirror der ArenaLifecycleCoordinator-Attach-/Detach-Sinks (Phase 6A.1). */
  function createOwner(onFrameDestroy?: () => void): LifecycleOwner {
    const handoff = new WorldPresentationHandoff();
    const scene = fakeScene();
    let current: WorldRuntime | null = null;
    const sink: WorldLifecycleSink = {
      publish: () => { /* Wire-Verhalten ist hier nicht Gegenstand */ },
      clear: () => { /* dito */ },
      attach: (worldContext) => {
        current = new WorldRuntime(worldContext);
        const binding = new WorldPresentationFrameBinding(fakeBindingInput(scene));
        if (onFrameDestroy) {
          const original = binding.destroy.bind(binding);
          vi.spyOn(binding, 'destroy').mockImplementation(() => {
            onFrameDestroy();
            original();
          });
        }
        current.bindPresentationFrame(binding);
      },
      detach: () => {
        const owner = current;
        current = null;
        owner?.detachPresentationFrame();
        handoff.release(owner?.releasePresentation() ?? null);
        owner?.destroy();
      },
    };
    return { lifecycle: new WorldLifecycle(sink), handoff, current: () => current };
  }

  it('bindet den Frame-Binding unabhaengig von einer Activity - eine World ohne Activity braucht keinen Dummy', () => {
    const owner = createOwner();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime(context());

    const current = owner.current();
    expect(current).not.toBeNull();
    expect(current!.activity.isAttached()).toBe(false);
    expect(current!.presentationFrame).not.toBeNull();
  });

  it('loest den Frame-Binding beim Instanzende, waehrend eine uebergebene Darstellung stehen bleibt', () => {
    const calls: string[] = [];
    const owner = createOwner(() => { calls.push('frame:destroy'); });
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime(context());
    const current = owner.current()!;
    const shown = presentationBinding(() => { calls.push('presentation:destroy'); });
    current.setPresentation(shown);

    owner.lifecycle.endInstance();

    expect(calls).toEqual(['frame:destroy']);
    expect(owner.handoff.pending).toBe(shown);
    expect(shown.isDestroyed()).toBe(false);
  });
});

describe('Arena-Anbindung des Frame-Bindings', () => {
  it('bindet im Attach-Sink unbedingt und loest im Detach-Sink vor dem Handoff-Release', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const attachStart = source.indexOf('attach: (context) => {');
    const attachEnd = source.indexOf('\n    },', attachStart);
    const attachBody = source.slice(attachStart, attachEnd);
    // Unbedingt im Attach-Sink, nicht hinter einer Activity-Bedingung - jede World bekommt einen.
    // Die Bindung steht auf der Grundeinrueckung des Sinks, also in keinem verschachtelten Block.
    expect(attachBody).toContain(
      '\n      this.worldRuntime.bindPresentationFrame(new WorldPresentationFrameBinding({',
    );

    const detachStart = source.indexOf('detach: () => {', attachEnd);
    const detachEnd = source.indexOf('\n    },', detachStart);
    const detachBody = source.slice(detachStart, detachEnd);
    expect(detachBody.indexOf('runtime?.detachPresentationFrame();'))
      .toBeLessThan(detachBody.indexOf('this.worldPresentationHandoff.release('));
    expect(detachBody.indexOf('this.worldPresentationHandoff.release('))
      .toBeLessThan(detachBody.indexOf('runtime?.destroy();'));

    // Der Frame-Binding landet nie im Handoff - nur die reine Darstellung tut das.
    expect(detachBody).not.toMatch(/worldPresentationHandoff\.release\([^;]*presentationFrame/);
  });

  it('raeumt den Slot im WorldRuntime-Teardown als Sicherheitsnetz zuerst ab', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/world/WorldRuntime.ts'), 'utf8');
    const destroyStart = source.indexOf('  destroy(): void {');
    const destroyEnd = source.indexOf('\n  private assertAlive', destroyStart);
    const body = source.slice(destroyStart, destroyEnd);
    expect(body.indexOf('this.detachPresentationFrame();'))
      .toBeLessThan(body.indexOf('presentation?.destroy();'));
  });
});

describe('WorldPresentationBinding bleibt gameplay-frei', () => {
  it('haelt keine Gameplay-/Physics-Referenzen - die reine Darstellung ist unveraendert (Phase 6A.1 fasst sie nicht an)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/world/WorldPresentationBinding.ts'), 'utf8');
    for (const forbidden of [
      /CombatSystem/, /HostPhysicsSystem/, /PlacementSystem/, /EnemyManager/,
      /PlayerManager/, /BaseManager/, /NetworkBridge/, /\bbridge\b/,
    ]) {
      expect(forbidden.test(source), forbidden.toString()).toBe(false);
    }
  });
});
