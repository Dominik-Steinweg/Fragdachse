import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArenaBuilderResult } from '../../src/arena/ArenaBuilder';
import type { RockRegistry } from '../../src/arena/RockRegistry';
import type { LightOccluderIndex } from '../../src/effects/LightOccluderIndex';
import type { BaseManager } from '../../src/entities/BaseManager';
import type { PlacementSystem } from '../../src/systems/PlacementSystem';
import type { ArenaLayout } from '../../src/types';
import { PersistentBaseWorldBinding } from '../../src/world/PersistentBaseWorldBinding';
import { WorldMaterialization } from '../../src/world/WorldMaterialization';
import { WorldPresentationBinding } from '../../src/world/WorldPresentationBinding';
import { WorldPresentationHandoff } from '../../src/world/WorldPresentationHandoff';
import { WorldLifecycle, type WorldLifecycleSink } from '../../src/world/WorldLifecycle';
import { WorldRuntime } from '../../src/world/WorldRuntime';
import type { WorldDescriptor } from '../../src/world/WorldDescriptor';
import type { WorldRuntimeContext } from '../../src/world/WorldRuntimeContext';

/**
 * World-Gameplay-State und World-Darstellung haben getrennte Lifetimes.
 *
 * Der mutable Gameplay-State faellt mit seiner `WorldRuntime` – ohne World-Instanz simuliert ihn
 * niemand mehr. Die Darstellung kann einen Uebergang ueberleben, aber ausschliesslich ueber den
 * ausdruecklichen Handoff. Diese Tests halten beide Seiten und ihre Reihenfolge fest.
 */

interface Recorder {
  readonly calls: string[];
  readonly layout: ArenaLayout;
  readonly arena: ArenaBuilderResult;
  readonly placement: PlacementSystem;
  readonly bases: BaseManager;
  readonly rocks: RockRegistry;
  readonly occluders: LightOccluderIndex;
}

function recorder(): Recorder {
  const calls: string[] = [];
  return {
    calls,
    layout: { name: 'layout' } as unknown as ArenaLayout,
    arena: { name: 'arena' } as unknown as ArenaBuilderResult,
    placement: {
      clearRuntimeRocks: () => { calls.push('placement.clearRuntimeRocks'); },
      hasRuntimeRock: (id: number) => id === 7,
    } as unknown as PlacementSystem,
    bases: { destroy: () => { calls.push('bases.destroy'); } } as unknown as BaseManager,
    rocks: { name: 'rocks' } as unknown as RockRegistry,
    occluders: { markDirty: vi.fn() } as unknown as LightOccluderIndex,
  };
}

function materialization(parts: Recorder): WorldMaterialization {
  const built = new WorldMaterialization();
  built.setArena(parts.arena, () => { parts.calls.push('arenaGameplay.destroy'); });
  built.setPlacement(parts.placement);
  built.setBases(parts.bases);
  built.setRocks(parts.rocks);
  built.setLightOccluders(parts.occluders);
  return built;
}

function presentation(parts: Recorder): WorldPresentationBinding {
  return new WorldPresentationBinding(parts.layout, parts.arena, {
    destroyPresentation: () => { parts.calls.push('presentation.destroy'); },
  });
}

function descriptor(): WorldDescriptor {
  return {
    worldRevision: 21,
    definitionId: 'world:coop-defense:3',
    seed: 909,
    generatorVersion: 3,
    layoutFingerprint: 'abc123',
  };
}

function runtime(): WorldRuntime {
  return new WorldRuntime({ descriptor: descriptor() } as WorldRuntimeContext);
}

describe('WorldMaterialization – der mutable World-Gameplay-State', () => {
  it('haelt die im Aufbaupass entstandenen Teile zusammen', () => {
    const parts = recorder();
    const built = materialization(parts);

    expect(built.placement).toBe(parts.placement);
    expect(built.arena).toBe(parts.arena);
    expect(built.bases).toBe(parts.bases);
    expect(built.rocks).toBe(parts.rocks);
    expect(built.lightOccluders).toBe(parts.occluders);
    expect(built.isDestroyed()).toBe(false);
  });

  it('raeumt in umgekehrter Aufbaureihenfolge ab und ist idempotent', () => {
    const parts = recorder();
    const built = materialization(parts);

    built.destroy();
    built.destroy();

    expect(parts.calls).toEqual(['placement.clearRuntimeRocks', 'bases.destroy', 'arenaGameplay.destroy']);
    expect(built.isDestroyed()).toBe(true);
    expect(built.placement).toBeNull();
    expect(built.arena).toBeNull();
    expect(built.bases).toBeNull();
    expect(built.rocks).toBeNull();
    expect(built.lightOccluders).toBeNull();
  });

  it('raeumt nur ab, was tatsaechlich entstanden ist', () => {
    const parts = recorder();
    const built = new WorldMaterialization();

    expect(() => built.destroy()).not.toThrow();
    expect(parts.calls).toEqual([]);
  });

  it('nimmt nach dem Abbau keinen neuen Teil mehr auf', () => {
    const parts = recorder();
    const built = materialization(parts);
    built.destroy();

    expect(() => built.setPlacement(parts.placement)).toThrow(/destroyed world materialization/);
    expect(() => built.setArena(parts.arena, () => {})).toThrow(/destroyed world materialization/);
    expect(() => built.setBases(parts.bases)).toThrow(/destroyed world materialization/);
    expect(() => built.setRocks(parts.rocks)).toThrow(/destroyed world materialization/);
    expect(() => built.setLightOccluders(null)).toThrow(/destroyed world materialization/);
  });
});

describe('WorldPresentationHandoff – genau ein terminaler Ausgang', () => {
  it('uebergibt die Darstellung an den naechsten Aufbau', () => {
    const parts = recorder();
    const handoff = new WorldPresentationHandoff();
    const binding = presentation(parts);

    handoff.release(binding);
    expect(handoff.pending).toBe(binding);

    expect(handoff.adopt()).toBe(binding);
    expect(handoff.pending).toBeNull();
    // Uebernommen heisst weiterverwendet: Die Darstellung steht noch.
    expect(binding.isDestroyed()).toBe(false);
    expect(parts.calls).toEqual([]);
  });

  it('verwirft eine Darstellung, die niemand uebernimmt – und bleibt dabei idempotent', () => {
    const parts = recorder();
    const handoff = new WorldPresentationHandoff();
    const binding = presentation(parts);

    handoff.release(binding);
    handoff.discard();
    handoff.discard();

    expect(binding.isDestroyed()).toBe(true);
    expect(handoff.pending).toBeNull();
    expect(parts.calls).toEqual(['presentation.destroy']);
  });

  it('haelt nie zwei Darstellungen gleichzeitig', () => {
    const first = recorder();
    const second = recorder();
    const handoff = new WorldPresentationHandoff();
    const firstBinding = presentation(first);

    handoff.release(firstBinding);
    handoff.release(presentation(second));

    // Die erste hat mit der Verdraengung ihren Ausgang gefunden.
    expect(firstBinding.isDestroyed()).toBe(true);
    expect(first.calls).toEqual(['presentation.destroy']);
    expect(second.calls).toEqual([]);
  });
});

describe('WorldRuntime – Gameplay faellt, Darstellung kann uebergehen', () => {
  it('raeumt Gameplay-State und Darstellung gemeinsam ab, wenn nichts uebergeben wurde', () => {
    const parts = recorder();
    const owner = runtime();
    const built = materialization(parts);
    const shown = presentation(parts);
    owner.materialize(built);
    owner.setPresentation(shown);

    owner.destroy();

    expect(built.isDestroyed()).toBe(true);
    expect(shown.isDestroyed()).toBe(true);
    expect(owner.materialization).toBeNull();
    expect(owner.presentation).toBeNull();
  });

  it('laesst eine uebergebene Darstellung stehen und raeumt nur das Gameplay ab', () => {
    const parts = recorder();
    const owner = runtime();
    const built = materialization(parts);
    const shown = presentation(parts);
    owner.materialize(built);
    owner.setPresentation(shown);

    expect(owner.releasePresentation()).toBe(shown);
    owner.destroy();

    expect(shown.isDestroyed()).toBe(false);
    expect(built.isDestroyed()).toBe(true);
    expect(parts.calls).not.toContain('presentation.destroy');
  });

  it('schliesst den persistenten Basisbestand ohne Darstellung, aber mit lebender Bau-Runtime ab', () => {
    const parts = recorder();
    const owner = runtime();
    const built = materialization(parts);
    const shown = presentation(parts);
    const seen: { placementAlive: boolean; presentationGone: boolean; constructionAlive: boolean }[] = [];
    let constructionAlive = true;
    const persistentBase = new PersistentBaseWorldBinding({
      finalizeRuntimeObjects: () => {
        seen.push({
          placementAlive: built.placement !== null,
          presentationGone: owner.presentation === null,
          constructionAlive,
        });
        parts.calls.push('persistentBase.finalize');
      },
      releaseRewardRuntime: () => { parts.calls.push('persistentBase.releaseReward'); },
    });
    persistentBase.bindRewardRuntime('base_health_pedestal', { runtimeId: 4, gridX: 1, gridY: 2 });
    owner.materialize(built);
    owner.setPresentation(shown);
    owner.setPersistentBase(persistentBase);
    owner.bind({
      destroy: () => {
        constructionAlive = false;
        parts.calls.push('construction.destroy');
      },
    });

    owner.destroy();

    expect(seen).toEqual([{ placementAlive: true, presentationGone: true, constructionAlive: true }]);
    // Die Darstellung geht zuerst, dann der Bestand, dann die Bau-Runtime.
    expect(parts.calls).toEqual([
      'presentation.destroy',
      'persistentBase.finalize',
      'persistentBase.releaseReward',
      'construction.destroy',
      'placement.clearRuntimeRocks',
      'bases.destroy',
      'arenaGameplay.destroy',
    ]);
    expect(persistentBase.rewardRuntimes.size).toBe(0);
  });

  it('loest world-scoped Bindings scene-langlebiger Systeme in umgekehrter Reihenfolge', () => {
    const calls: string[] = [];
    const owner = runtime();
    owner.bind({ destroy: () => { calls.push('first'); } });
    owner.bind({ destroy: () => { calls.push('second'); } });

    owner.destroy();

    expect(calls).toEqual(['second', 'first']);
  });

  it('materialisiert genau einmal und nimmt nach dem Teardown nichts mehr auf', () => {
    const parts = recorder();
    const owner = runtime();
    owner.materialize(materialization(parts));
    expect(() => owner.materialize(materialization(recorder()))).toThrow(/already materialized/);

    owner.destroy();
    expect(() => owner.materialize(materialization(recorder()))).toThrow(/destroyed runtime/);
    expect(() => owner.setPresentation(presentation(recorder()))).toThrow(/destroyed runtime/);
    expect(() => owner.bind({ destroy: () => { /* noop */ } })).toThrow(/destroyed runtime/);
  });

});

describe('Uebergaenge – die Darstellung reist, der Gameplay-State nicht', () => {
  /** Dieselbe Verdrahtung wie im Arena-Coordinator: Der Sink uebergibt, bevor er zerstoert. */
  function createOwner(): {
    readonly lifecycle: WorldLifecycle;
    readonly handoff: WorldPresentationHandoff;
    readonly build: (parts: Recorder) => { built: WorldMaterialization; shown: WorldPresentationBinding };
  } {
    const handoff = new WorldPresentationHandoff();
    let current: WorldRuntime | null = null;
    const sink: WorldLifecycleSink = {
      publish: () => { /* Wire-Verhalten ist hier nicht Gegenstand */ },
      clear: () => { /* dito */ },
      attach: (worldContext) => { current = new WorldRuntime(worldContext); },
      detach: () => {
        const owner = current;
        current = null;
        handoff.release(owner?.releasePresentation() ?? null);
        owner?.destroy();
      },
    };
    return {
      lifecycle: new WorldLifecycle(sink),
      handoff,
      build: (parts) => {
        const built = materialization(parts);
        // Ein Uebergang, der die Darstellung uebernimmt, fuehrt genau dieselbe weiter.
        const shown = handoff.adopt() ?? presentation(parts);
        current!.materialize(built);
        current!.setPresentation(shown);
        return { built, shown };
      },
    };
  }

  it('laesst beim Instanzende nur die Darstellung stehen', () => {
    const parts = recorder();
    const owner = createOwner();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime({ descriptor: descriptor() } as WorldRuntimeContext);
    const { built, shown } = owner.build(parts);

    // Rundenstart, Match-Exit und Lobby-Fast-Reinstance beenden alle die Instanz.
    owner.lifecycle.endInstance();

    expect(built.isDestroyed()).toBe(true);
    expect(shown.isDestroyed()).toBe(false);
    expect(owner.handoff.pending).toBe(shown);
    expect(parts.calls).toEqual(['placement.clearRuntimeRocks', 'bases.destroy', 'arenaGameplay.destroy']);
  });

  it('fuehrt beim Fast-Reinstance dieselbe Darstellung weiter und baut den Gameplay-State neu', () => {
    const parts = recorder();
    const owner = createOwner();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime({ descriptor: descriptor() } as WorldRuntimeContext);
    const first = owner.build(parts);
    owner.lifecycle.endInstance();

    const next = { ...descriptor(), worldRevision: 22 };
    owner.lifecycle.beginCreate(next, null);
    owner.lifecycle.attachRuntime({ descriptor: next } as WorldRuntimeContext);
    const second = owner.build(parts);

    expect(second.shown).toBe(first.shown);
    expect(second.built).not.toBe(first.built);
    expect(owner.handoff.pending).toBeNull();
    expect(first.shown.isDestroyed()).toBe(false);
  });

  it('verwirft die Darstellung, wenn kein Uebergang sie uebernimmt', () => {
    const parts = recorder();
    const owner = createOwner();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime({ descriptor: descriptor() } as WorldRuntimeContext);
    const { shown } = owner.build(parts);
    owner.lifecycle.endInstance();

    // Lobby-Rueckkehr: Der Teardown verwirft, was niemand weiterfuehrt.
    owner.handoff.discard();

    expect(shown.isDestroyed()).toBe(true);
    expect(parts.calls).toContain('presentation.destroy');
  });
});

describe('Arena-Anbindung der getrennten Lifetimes', () => {
  it('kapselt ArenaLifecycleCoordinator und Runtime-Owner vollständig hinter ArenaRuntime', () => {
    const scene = readFileSync(resolve(__dirname, '../../src/scenes/ArenaScene.ts'), 'utf8');
    const runtime = readFileSync(resolve(__dirname, '../../src/scenes/arena/ArenaRuntime.ts'), 'utf8');
    const barrel = readFileSync(resolve(__dirname, '../../src/scenes/arena/index.ts'), 'utf8');

    // ArenaScene darf ArenaLifecycleCoordinator weder typseitig noch als Wert kennen:
    expect(scene).not.toContain('ArenaLifecycleCoordinator');
    expect(scene).not.toMatch(/\.flow\b/);
    expect(scene).not.toMatch(/private get (lifecycle|worldRuntime|world|arenaResult|currentLayout|placementSystem|rockRegistry|baseManager|targetingSystems|playerSystems|combatSystems|supportSystems|powerUpSystem|trainManager|coopMissionRuntime|enemyManager|captureTheBeerSystem)\b/);
    expect(scene).not.toContain('this.worldRuntime');

    // In ArenaScene dürfen keine World-/Activity-Owner oder Materialisierungen traversiert werden:
    for (const forbiddenOwnerAccess of [
      'getWorldRuntime',
      'getCoopMissionRuntime',
      'getWorldPlayerGameplayRuntime',
      'getWorldTargetingRuntime',
      'getWorldCombatGameplayBinding',
      'getWorldPowerUpRuntime',
      'getCaptureTheBeerActivityRuntime',
      'getConstructionWorldRuntime',
      'getWorldTrainRuntime',
      'materialization',
    ]) {
      expect(scene, forbiddenOwnerAccess).not.toContain(forbiddenOwnerAccess);
    }

    // ArenaRuntime hält den Coordinator als privates Detail:
    expect(runtime).toMatch(/private\s+readonly\s+flow:\s*ArenaLifecycleCoordinator/);
    expect(runtime).not.toMatch(/public\s+(get\s+)?flow\b/);

    // Barrel-Export enthält den Coordinator nicht mehr:
    expect(barrel).not.toContain('ArenaLifecycleCoordinator');
  });

  it('baut WorldComposition isoliert auf und hält World-Kinder aus ArenaLifecycleCoordinator heraus', () => {
    const lifecycle = readFileSync(
      resolve(__dirname, '../../src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const composition = readFileSync(
      resolve(__dirname, '../../src/world/WorldComposition.ts'),
      'utf8',
    );
    // Genau ein Aufbau je Owner, und der Gameplay-State faellt ausschliesslich mit der Runtime.
    expect([...composition.matchAll(/new WorldMaterialization\(/g)]).toHaveLength(1);
    expect([...composition.matchAll(/new WorldPresentationBinding\(/g)]).toHaveLength(1);
    expect(composition).toContain('input.runtime.materialize(materialization);');
    expect(composition).toContain('materialization.setArena(arena');
    expect(composition).toContain('input.runtime.setPresentation(presentation);');
    expect(composition).toContain('input.runtime.setPersistentBase(persistentBase);');
    expect(lifecycle).toContain('materializeWorldComposition({');
    // Der Handoff ist der einzige Weg, auf dem etwas die Runtime ueberlebt.
    expect(lifecycle).toContain('this.worldPresentationHandoff.release(runtime?.releasePresentation() ?? null);');
    expect(composition).toContain('input.handoff.adopt();');
    expect(composition).toContain('input.handoff.discard();');
    // Der Gameplay-State reist nicht mehr mit: Es gibt keine Freigabe der Materialisierung.
    expect(lifecycle + composition).not.toContain('releaseMaterialization');

    // Der Flow kennt weder konkrete World-Kinder noch deren Shared-Service-Bindungen.
    for (const concreteConstruction of [
      'new WorldMaterialization(',
      'new WorldPresentationBinding(',
      'new PlacementSystem(',
      'new BaseManager(',
      'new RockRegistry(',
      'new FireObstacleIndex(',
      'new LightOccluderIndex(',
    ]) {
      expect(lifecycle, concreteConstruction).not.toContain(concreteConstruction);
    }
    expect(composition).toContain('new PlacementSystem(');
    expect(composition).toContain('new BaseManager(');
    expect(composition).toContain('new RockRegistry(');

    const context = readFileSync(
      resolve(__dirname, '../../src/scenes/arena/ArenaContext.ts'),
      'utf8',
    );
    for (const field of [
      'arenaResult',
      'currentLayout',
      'placementSystem',
      'rockRegistry',
      'baseManager',
      'lightOccluderIndex',
    ]) {
      expect(context, `${field} bleibt ausserhalb des ArenaContext`).not.toMatch(
        new RegExp(`readonly ${field}\\s*:`),
      );
    }
  });
});