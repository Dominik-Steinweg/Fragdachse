import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import type { ArenaLayout } from '../src/types';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import { WorldPresentationBinding } from '../src/world/WorldPresentationBinding';
import { WorldPresentationHandoff } from '../src/world/WorldPresentationHandoff';
import {
  WorldPresentationFrameBinding,
  type WorldPresentationFrameConsumers,
} from '../src/world/WorldPresentationFrameBinding';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Phase 5 – Lifetime-Fundament der World-Presentation-Verdrahtung.
 *
 * `WorldPresentationFrameBinding` ist der world-scoped Owner der *aktiven* Presentation-
 * Verdrahtung; `WorldPresentationBinding` bleibt die handoffbare, gameplay-freie Darstellung
 * selbst. Diese Tests halten fest, dass Ersteres immer vor Letzterem faellt, nie im Handoff
 * landet, und dass eine World ohne Activity denselben Weg nimmt wie eine mit.
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

describe('WorldPresentationFrameBinding – eigener Lifetime', () => {
  it('startet unzerstoert und wird durch destroy() idempotent inert', () => {
    const calls: string[] = [];
    const binding = new WorldPresentationFrameBinding({ release: () => { calls.push('release'); } });

    expect(binding.isDestroyed()).toBe(false);
    binding.destroy();
    binding.destroy();

    expect(binding.isDestroyed()).toBe(true);
    expect(calls).toEqual(['release']);
  });

  it('kommt ohne Consumer-Port aus - Phase 5 hat keinen zu binden', () => {
    const binding = new WorldPresentationFrameBinding();
    expect(() => binding.destroy()).not.toThrow();
    expect(binding.isDestroyed()).toBe(true);
  });

  it('laesst einen stalen Aufruf auf einem zerstoerten Frame-Binding die naechste World nicht mehr beeinflussen', () => {
    // Simuliert, wie ein zukuenftiger (Phase-6-)Consumer die World-Sicht scene-langlebiger
    // Renderer/Lighting/Occluder/Listener installieren und beim Detach wieder loesen wuerde.
    const shared = { owner: null as string | null };
    const bindingFor = (owner: string): WorldPresentationFrameBinding => {
      shared.owner = owner;
      const consumers: WorldPresentationFrameConsumers = {
        release: () => { if (shared.owner === owner) shared.owner = null; },
      };
      return new WorldPresentationFrameBinding(consumers);
    };

    const frameA = bindingFor('A');
    frameA.destroy();
    expect(shared.owner).toBeNull();

    const frameB = bindingFor('B');
    expect(shared.owner).toBe('B');

    // Ein staler zweiter destroy() auf dem toten Binding A darf B nicht mehr beruehren.
    frameA.destroy();
    expect(shared.owner).toBe('B');
    expect(frameB.isDestroyed()).toBe(false);

    frameB.destroy();
    expect(shared.owner).toBeNull();
  });
});

describe('WorldRuntime – dedizierter Slot fuer den Frame-Binding', () => {
  it('faengt den Slot bei materialize()-Aufbaufehlern nicht ein - bind/detach sind eigenstaendig', () => {
    const owner = runtime();
    expect(owner.presentationFrame).toBeNull();

    const calls: string[] = [];
    const binding = new WorldPresentationFrameBinding({ release: () => { calls.push('release'); } });
    owner.bindPresentationFrame(binding);

    expect(owner.presentationFrame).toBe(binding);
    expect(calls).toEqual([]);
  });

  it('lehnt einen zweiten Frame-Binding auf einem bereits belegten Slot ab', () => {
    const owner = runtime();
    owner.bindPresentationFrame(new WorldPresentationFrameBinding());

    expect(() => owner.bindPresentationFrame(new WorldPresentationFrameBinding()))
      .toThrow(/already bound/);
  });

  it('detachPresentationFrame() loest den Slot idempotent und ohne die uebrige Runtime zu beruehren', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(new WorldPresentationFrameBinding({ release: () => { calls.push('release'); } }));

    owner.detachPresentationFrame();
    owner.detachPresentationFrame();

    expect(calls).toEqual(['release']);
    expect(owner.presentationFrame).toBeNull();
    expect(owner.isDestroyed()).toBe(false);
  });

  it('destroy() loest einen nicht explizit entfernten Frame-Binding als Sicherheitsnetz genau einmal', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(new WorldPresentationFrameBinding({ release: () => { calls.push('release'); } }));

    owner.destroy();

    expect(calls).toEqual(['release']);
    expect(owner.presentationFrame).toBeNull();
  });

  it('destroy() ruft ein zuvor bereits geloestes Sicherheitsnetz nicht doppelt', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(new WorldPresentationFrameBinding({ release: () => { calls.push('release'); } }));

    owner.detachPresentationFrame();
    owner.destroy();

    expect(calls).toEqual(['release']);
  });

  it('nimmt nach destroy() keinen Frame-Binding mehr an', () => {
    const owner = runtime();
    owner.destroy();

    expect(() => owner.bindPresentationFrame(new WorldPresentationFrameBinding()))
      .toThrow(/destroyed runtime/);
  });
});

describe('Detach-Reihenfolge – FrameBinding faellt vor dem Handoff, der Handoff vor dem Runtime-Teardown', () => {
  it('haelt exakt die Reihenfolge FrameBinding.destroy -> Handoff.release -> Runtime.destroy ein', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(
      new WorldPresentationFrameBinding({ release: () => { calls.push('frame:destroy'); } }),
    );
    // World-scoped Systeme, deren Abbau erst mit runtime.destroy() laeuft.
    owner.bind({ destroy: () => { calls.push('runtime:destroy'); } });

    const handoff = new WorldPresentationHandoff();
    // Eine aus einem vorherigen Uebergang noch gehaltene Darstellung: ihr Verdraengen macht den
    // Moment von handoff.release() beobachtbar.
    handoff.release(presentationBinding(() => { calls.push('handoff:release'); }));

    // Exakte Kopie der ArenaLifecycleCoordinator-Detach-Sink-Reihenfolge (Phase 5).
    owner.detachPresentationFrame();
    handoff.release(owner.releasePresentation());
    owner.destroy();

    expect(calls).toEqual(['frame:destroy', 'handoff:release', 'runtime:destroy']);
  });

  it('faellt der Frame-Binding vor der Freigabe an den Handoff, wenn eine Darstellung tatsaechlich uebergeht', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bindPresentationFrame(
      new WorldPresentationFrameBinding({ release: () => { calls.push('frame:destroy'); } }),
    );
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

  /**
   * Mirror der ArenaLifecycleCoordinator-Attach-/Detach-Sinks (Phase 5).
   *
   * `consumers` steht fuer das, was ein zukuenftiger Aufrufer beim Bind mitgeben wuerde - Phase 5
   * hat noch keinen echten Consumer, deshalb bleibt es optional statt eines zweiten Bind-Aufrufs.
   */
  function createOwner(consumers?: () => WorldPresentationFrameConsumers | undefined): LifecycleOwner {
    const handoff = new WorldPresentationHandoff();
    let current: WorldRuntime | null = null;
    const sink: WorldLifecycleSink = {
      publish: () => { /* Wire-Verhalten ist hier nicht Gegenstand */ },
      clear: () => { /* dito */ },
      attach: (worldContext) => {
        current = new WorldRuntime(worldContext);
        current.bindPresentationFrame(new WorldPresentationFrameBinding(consumers?.()));
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
    const owner = createOwner(() => ({ release: () => { calls.push('frame:destroy'); } }));
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
      '\n      this.worldRuntime.bindPresentationFrame(new WorldPresentationFrameBinding());',
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
  it('haelt keine Gameplay-/Physics-Referenzen - die reine Darstellung ist unveraendert (Phase 5 fasst sie nicht an)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/world/WorldPresentationBinding.ts'), 'utf8');
    for (const forbidden of [
      /CombatSystem/, /HostPhysicsSystem/, /PlacementSystem/, /EnemyManager/,
      /PlayerManager/, /BaseManager/, /NetworkBridge/, /\bbridge\b/,
    ]) {
      expect(forbidden.test(source), forbidden.toString()).toBe(false);
    }
  });
});
