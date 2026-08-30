import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import type { RockRegistry } from '../src/arena/RockRegistry';
import type { LightOccluderIndex } from '../src/effects/LightOccluderIndex';
import type { BaseManager } from '../src/entities/BaseManager';
import type { PlacementSystem } from '../src/systems/PlacementSystem';
import type { ArenaLayout } from '../src/types';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldMaterialization } from '../src/world/WorldMaterialization';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Der gebaute Zustand einer World hat genau einen Owner.
 *
 * Vorher lagen Layout, Presentation, Fels-/Bau-Runtime, Basen und Verdeckungsindex als sechs
 * unabhaengige nullable Felder im `ArenaContext`, und ihre Abbaureihenfolge war nur aus dem
 * Teardown-Pfad zu rekonstruieren. Diese Tests halten die Reihenfolge und die Idempotenz fest.
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

function fullMaterialization(parts: Recorder): WorldMaterialization {
  const materialization = new WorldMaterialization(parts.layout, {
    destroyPresentation: () => { parts.calls.push('presentation.destroy'); },
  });
  materialization.setArena(parts.arena);
  materialization.setPlacement(parts.placement);
  materialization.setBases(parts.bases);
  materialization.setRocks(parts.rocks);
  materialization.setLightOccluders(parts.occluders);
  return materialization;
}

describe('WorldMaterialization – ein Owner fuer den gebauten World-Zustand', () => {
  it('haelt die im Aufbaupass entstandenen Teile zusammen', () => {
    const parts = recorder();
    const materialization = fullMaterialization(parts);

    expect(materialization.layout).toBe(parts.layout);
    expect(materialization.arena).toBe(parts.arena);
    expect(materialization.placement).toBe(parts.placement);
    expect(materialization.bases).toBe(parts.bases);
    expect(materialization.rocks).toBe(parts.rocks);
    expect(materialization.lightOccluders).toBe(parts.occluders);
    expect(materialization.isDestroyed()).toBe(false);
  });

  it('raeumt in umgekehrter Aufbaureihenfolge ab und ist idempotent', () => {
    const parts = recorder();
    const materialization = fullMaterialization(parts);

    materialization.destroy({ preservePresentation: false });
    materialization.destroy({ preservePresentation: false });

    expect(parts.calls).toEqual([
      'placement.clearRuntimeRocks',
      'bases.destroy',
      'presentation.destroy',
    ]);
    expect(materialization.isDestroyed()).toBe(true);
    expect(materialization.layout).toBeNull();
    expect(materialization.arena).toBeNull();
    expect(materialization.placement).toBeNull();
    expect(materialization.bases).toBeNull();
    expect(materialization.rocks).toBeNull();
    expect(materialization.lightOccluders).toBeNull();
  });

  it('laesst allein die Presentation stehen, wenn der naechste Aufbau sie uebernimmt', () => {
    const parts = recorder();
    const materialization = fullMaterialization(parts);

    materialization.destroy({ preservePresentation: true });

    // Die Presentation ueberlebt; Bau-Runtime und Basen fallen trotzdem.
    expect(parts.calls).toEqual(['placement.clearRuntimeRocks', 'bases.destroy']);
  });

  it('gibt dem Abschluss-Schritt eine World ohne Geometrie, aber mit lebender Bau-Runtime', () => {
    const parts = recorder();
    const materialization = fullMaterialization(parts);
    const seen: {
      placement: PlacementSystem | null;
      layout: ArenaLayout | null;
      arena: ArenaBuilderResult | null;
      aliveRuntimeObject: boolean;
    }[] = [];

    materialization.destroy({
      preservePresentation: true,
      beforePlacementRelease: (placement) => {
        seen.push({
          placement,
          layout: materialization.layout,
          arena: materialization.arena,
          aliveRuntimeObject: placement?.hasRuntimeRock(7) === true,
        });
        parts.calls.push('beforePlacementRelease');
      },
    });

    expect(seen).toHaveLength(1);
    // Geometrie und Presentation sind abgemeldet – ein Aufraeumschritt kann eine erhaltene
    // Darstellung hier nicht mehr veraendern.
    expect(seen[0].layout).toBeNull();
    expect(seen[0].arena).toBeNull();
    // Die Bau-Runtime steht dagegen noch: nur hier ist "hat das Objekt ueberlebt?" beantwortbar.
    expect(seen[0].placement).toBe(parts.placement);
    expect(seen[0].aliveRuntimeObject).toBe(true);
    expect(parts.calls).toEqual([
      'beforePlacementRelease',
      'placement.clearRuntimeRocks',
      'bases.destroy',
    ]);
  });

  it('raeumt nur ab, was tatsaechlich entstanden ist', () => {
    const parts = recorder();
    const materialization = new WorldMaterialization(parts.layout, {
      destroyPresentation: () => { parts.calls.push('presentation.destroy'); },
    });

    expect(() => materialization.destroy({ preservePresentation: false })).not.toThrow();
    expect(parts.calls).toEqual([]);
  });

  it('nimmt nach dem Abbau keinen neuen Teil mehr auf', () => {
    const parts = recorder();
    const materialization = fullMaterialization(parts);
    materialization.destroy({ preservePresentation: false });

    expect(() => materialization.setArena(parts.arena)).toThrow(/destroyed world materialization/);
    expect(() => materialization.setPlacement(parts.placement)).toThrow(/destroyed world materialization/);
    expect(() => materialization.setBases(parts.bases)).toThrow(/destroyed world materialization/);
    expect(() => materialization.setRocks(parts.rocks)).toThrow(/destroyed world materialization/);
    expect(() => materialization.setLightOccluders(null)).toThrow(/destroyed world materialization/);
  });
});

describe('WorldRuntime – Besitz des gebauten World-Zustands', () => {
  function runtime(): WorldRuntime {
    const world: WorldDescriptor = {
      worldRevision: 21,
      definitionId: 'world:coop-defense:3',
      seed: 909,
      generatorVersion: 3,
      layoutFingerprint: 'abc123',
    };
    return new WorldRuntime({ descriptor: world } as WorldRuntimeContext);
  }

  it('materialisiert genau einmal', () => {
    const parts = recorder();
    const owner = runtime();
    const materialization = fullMaterialization(parts);

    expect(owner.materialization).toBeNull();
    owner.materialize(materialization);
    expect(owner.materialization).toBe(materialization);
    expect(() => owner.materialize(fullMaterialization(recorder()))).toThrow(/already materialized/);
  });

  it('raeumt den gebauten World-Zustand mit der Runtime ab', () => {
    const parts = recorder();
    const owner = runtime();
    const materialization = fullMaterialization(parts);
    owner.materialize(materialization);

    owner.destroy();

    expect(materialization.isDestroyed()).toBe(true);
    expect(owner.materialization).toBeNull();
    expect(parts.calls).toContain('presentation.destroy');
  });

  it('raeumt einen freigegebenen Aufbau nicht mehr ab', () => {
    const parts = recorder();
    const owner = runtime();
    const materialization = fullMaterialization(parts);
    owner.materialize(materialization);

    // Exit-Fade, Lobby-Fast-Reinstance und Rundenstart beenden die Instanz, waehrend die Arena
    // noch steht: Wer sie weiterfuehrt, uebernimmt sie ausdruecklich.
    expect(owner.releaseMaterialization()).toBe(materialization);
    expect(owner.materialization).toBeNull();
    owner.destroy();

    expect(materialization.isDestroyed()).toBe(false);
    expect(parts.calls).toEqual([]);
  });

  it('nimmt nach dem Teardown keinen Aufbau mehr auf', () => {
    const parts = recorder();
    const owner = runtime();
    owner.destroy();

    expect(() => owner.materialize(fullMaterialization(parts))).toThrow(/destroyed runtime/);
  });
});

describe('Arena-Anbindung des gebauten World-Zustands', () => {
  it('liest den gebauten Zustand ausschliesslich ueber seinen Owner', () => {
    const scene = readFileSync(resolve(__dirname, '../src/scenes/ArenaScene.ts'), 'utf8');
    // Die alten Einzelfelder sind reine Lesefassaden auf den Owner.
    expect(scene).toContain('get arenaResult() { return this.worldMaterialization?.arena ?? null; }');
    expect(scene).toContain('get currentLayout() { return this.worldMaterialization?.layout ?? null; }');
    expect(scene).toContain('get placementSystem() { return this.worldMaterialization?.placement ?? null; }');
    expect(scene).toContain('get rockRegistry() { return this.worldMaterialization?.rocks ?? null; }');
    expect(scene).toContain('get baseManager() { return this.worldMaterialization?.bases ?? null; }');
    expect(scene).toContain('get lightOccluderIndex() { return this.worldMaterialization?.lightOccluders ?? null; }');

    const lifecycle = readFileSync(
      resolve(__dirname, '../src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    // Genau ein Aufbau und genau ein Abbau – beide ueber den Owner.
    expect([...lifecycle.matchAll(/new WorldMaterialization\(/g)]).toHaveLength(1);
    expect(lifecycle).toContain('this.worldRuntime?.materialize(materialization);');
    expect([...lifecycle.matchAll(/this\.destroyWorldMaterialization\(/g)]).toHaveLength(1);
    // Der Abbau haengt am World-Teardown, nicht am Ende der Instanz (TD-3).
    expect(lifecycle).toContain('runtime?.releaseMaterialization();');
    expect(lifecycle).toContain('this.destroyWorldMaterialization(preserveAuthoredPresentation);');

    const context = readFileSync(
      resolve(__dirname, '../src/scenes/arena/ArenaContext.ts'),
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
      expect(context, `${field} bleibt eine Lesefassade`).toMatch(
        new RegExp(`readonly ${field}\\s*:`),
      );
    }
  });
});
