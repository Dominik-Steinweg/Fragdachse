import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CoopMissionRuntime,
  type CoopMissionEnemyBehaviourRuntime,
  type CoopMissionEnemySpecialRuntime,
  type CoopMissionEncounterRuntime,
  type CoopMissionNavigationRuntime,
} from '../src/activity/CoopMissionRuntime';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';
import type { NecromancySystem } from '../src/systems/NecromancySystem';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { ActivityRuntimeHost } from '../src/world/ActivityRuntimeHost';

function descriptor(kind: ActivityDescriptor['kind'] = 'coop-mission'): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision: 21,
    kind,
    definitionId: kind === 'coop-mission'
      ? 'activity:coop-mission:1'
      : 'activity:deathmatch:default',
  };
}

function clearable(name: string, calls: string[]): { clear: () => void } {
  return { clear: () => { calls.push(name); } };
}

function resettable(name: string, calls: string[]): { reset: () => void } {
  return { reset: () => { calls.push(name); } };
}

function flowField(name: string, calls: string[]): CoopMissionNavigationRuntime['enemy'] {
  return { destroy: () => { calls.push(name); } } as unknown as CoopMissionNavigationRuntime['enemy'];
}

describe('CoopMissionRuntime – konkrete Activity-Ownership', () => {
  it('akzeptiert ausschliesslich Coop-Missionen', () => {
    expect(() => new CoopMissionRuntime(descriptor('deathmatch'))).toThrow(/not coop-mission/);
  });

  it('raeumt nur materialisierte Child-Owner abhaengigkeitsgerecht und idempotent ab', () => {
    const calls: string[] = [];
    const bindingSnapshots: Array<CoopMissionRuntime | null> = [];
    const runtime = new CoopMissionRuntime(descriptor(), (current) => {
      bindingSnapshots.push(current);
    });

    const enemyManager = {
      setLethalDamageGuard: (value: unknown) => { calls.push(`enemy:lethal:${String(value)}`); },
      setEnemySpawnedCallback: (value: unknown) => { calls.push(`enemy:spawn:${String(value)}`); },
      destroy: () => { calls.push('enemy:destroy'); },
      setVisualSink: (value: unknown) => { calls.push(`enemy:visual:${String(value)}`); },
    } as unknown as EnemyManager;
    runtime.setEnemyManager(enemyManager);

    const navigation = {
      coordinator: {
        destroy: () => { calls.push('navigation:coordinator'); },
      },
      enemy: flowField('navigation:enemy', calls),
      player: flowField('navigation:player', calls),
      strategic: flowField('navigation:strategic', calls),
      boss: flowField('navigation:boss', calls),
      targetCatalog: clearable('navigation:catalog', calls),
      strategicTarget: clearable('navigation:target', calls),
      releaseGridChanges: () => { calls.push('navigation:grid-listener'); },
    } as unknown as CoopMissionNavigationRuntime;
    runtime.setNavigation(navigation);

    runtime.setEncounter({
      spawnExecutor: {},
      persistentPressure: resettable('encounter:pressure', calls),
      boss: resettable('encounter:boss', calls),
      director: resettable('encounter:director', calls),
    } as unknown as CoopMissionEncounterRuntime);

    runtime.setEnemyBehaviour({
      trainAwareness: clearable('behaviour:train', calls),
      burrow: clearable('behaviour:burrow', calls),
      dodge: clearable('behaviour:dodge', calls),
      combatPositioning: clearable('behaviour:positioning', calls),
      ability: clearable('behaviour:ability', calls),
      attack: {},
    } as unknown as CoopMissionEnemyBehaviourRuntime);

    runtime.setEnemySpecials({
      timebomb: clearable('special:timebomb', calls),
      voidHunter: clearable('special:void-hunter', calls),
    } as unknown as CoopMissionEnemySpecialRuntime);

    runtime.setNecromancy({
      setCorpseSink: (value: unknown) => { calls.push(`necromancy:sink:${String(value)}`); },
      clear: () => { calls.push('necromancy:clear'); },
    } as unknown as NecromancySystem);
    runtime.setMapEventDirector(
      resettable('event:director', calls) as unknown as CoopDefenseMapEventDirector,
    );

    runtime.destroy();
    runtime.destroy();

    expect(calls).toEqual([
      'event:director',
      'encounter:director',
      'encounter:pressure',
      'encounter:boss',
      'special:void-hunter',
      'special:timebomb',
      'behaviour:ability',
      'behaviour:burrow',
      'behaviour:dodge',
      'behaviour:positioning',
      'behaviour:train',
      'necromancy:sink:null',
      'necromancy:clear',
      'enemy:lethal:null',
      'enemy:spawn:null',
      'enemy:destroy',
      'enemy:visual:null',
      'navigation:target',
      'navigation:catalog',
      'navigation:enemy',
      'navigation:player',
      'navigation:strategic',
      'navigation:boss',
      'navigation:grid-listener',
      'navigation:coordinator',
    ]);
    expect(bindingSnapshots.at(-1)).toBeNull();
    expect(bindingSnapshots.filter((entry) => entry === null)).toHaveLength(1);
  });

  it('wird ueber den ActivityRuntimeHost getaktet und zerstoert', () => {
    const host = new ActivityRuntimeHost(21);
    const runtime = new CoopMissionRuntime(descriptor());
    const update = vi.spyOn(runtime, 'update');
    const destroy = vi.spyOn(runtime, 'destroy');

    host.attach(descriptor(), runtime);
    host.update(16);
    host.detach();
    host.detach();

    expect(update).toHaveBeenCalledExactlyOnceWith(16);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('CoopMissionRuntime – Migrationsgrenzen', () => {
  it('haelt Runtime/Domain frei von ArenaContext und konkreter Netzwerk-Infrastruktur', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionRuntime.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/ArenaContext|NetworkBridge|network\/bridge|\bbridge\b/);
  });

  it('bindet Coop am Activity-Lifecycle und entfernt die globale Enemy-Teardown-Liste', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    expect(source).toContain('activity: {');
    expect(source).toContain('worldRuntime.activity.attach(activity, runtime);');
    const teardownStart = source.indexOf('  tearDownArena(');
    const teardownEnd = source.indexOf('\n  /**', teardownStart);
    const teardown = source.slice(teardownStart, teardownEnd);
    expect(teardown).toContain('this.detachLocalActivityForTeardown();');
    for (const legacyTeardown of [
      'this.ctx.enemyManager?.destroy()',
      'this.ctx.coopDefenseMapDirector?.reset()',
      'this.ctx.coopDefenseBossSystem?.reset()',
      'this.ctx.enemyFlowFieldService?.destroy()',
      'this.ctx.flowFieldCoordinator?.destroy()',
    ]) {
      expect(teardown).not.toContain(legacyTeardown);
    }

    // Die alten Context-Felder sind nur noch gerichtete Lesefassaden. Ein zweiter Writer wuerde
    // neben der CoopMissionRuntime wieder eine gleichwertige mutable Wahrheit eroeffnen.
    for (const compatibilityField of [
      'enemyManager',
      'flowFieldCoordinator',
      'enemyFlowFieldService',
      'enemyPlayerFlowFieldService',
      'enemyStrategicFlowFieldService',
      'enemyBossFlowFieldService',
      'coopDefenseSpawnExecutor',
      'coopDefensePersistentPressureSystem',
      'coopDefenseBossSystem',
      'coopDefenseMapDirector',
      'coopDefenseMapEventDirector',
      'coopDefenseEnemyAttackSystem',
      'coopDefenseEnemyAbilitySystem',
      'coopDefenseEnemyBurrowSystem',
      'coopDefenseEnemyDodgeSystem',
      'coopDefenseEnemyCombatPositioningSystem',
      'coopDefenseVoidHunterSystem',
      'coopDefenseTimebombSystem',
      'necromancySystem',
    ]) {
      expect(
        [...source.matchAll(new RegExp(`this\\.ctx\\.${compatibilityField}\\s*=`, 'g'))],
        `${compatibilityField} gained another writer`,
      ).toHaveLength(1);
    }
  });
});
