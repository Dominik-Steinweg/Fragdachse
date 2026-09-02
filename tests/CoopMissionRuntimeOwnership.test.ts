import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CoopMissionRuntime,
  type CoopMissionEnemyBehaviourRuntime,
  type CoopMissionEnemySpecialRuntime,
  type CoopMissionEncounterRuntime,
  type CoopMissionNavigationRuntime,
  type CoopMissionObjectiveRuntime,
} from '../src/activity/CoopMissionRuntime';
import type { CoopMissionPlayerRuntime } from '../src/activity/CoopMissionPlayerRuntime';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { CoopDefenseMapEventDirector } from '../src/systems/CoopDefenseMapEventDirector';
import type { NecromancySystem } from '../src/systems/NecromancySystem';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { ActivityRuntimeHost } from '../src/world/ActivityRuntimeHost';

/** Minimaler, deterministischer .ts-Sammler fuer die Source-Ratchet-Pruefung unten. */
function collectTypeScriptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTypeScriptFiles(full, out);
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

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

  it('materialisiert Activity B in derselben World frisch und loest Bindings vor alten Entities', () => {
    const calls: string[] = [];
    let generation = 0;
    const recipe = (runtime: CoopMissionRuntime): void => {
      const id = ++generation;
      runtime.setEnemyManager({
        destroy: () => { calls.push(`enemy:${id}:destroy`); },
        setLethalDamageGuard: () => {},
        setEnemySpawnedCallback: () => {},
        setVisualSink: () => {},
      } as unknown as EnemyManager);
    };
    const bind = (runtime: CoopMissionRuntime, label: string): void => {
      runtime.bind({
        attach: (current) => {
          calls.push(`${label}:attach:${current.enemyManager ? 'enemy' : 'empty'}`);
        },
        detach: () => {
          calls.push(`${label}:detach:${runtime.enemyManager ? 'enemy' : 'empty'}`);
        },
      });
    };

    const host = new ActivityRuntimeHost(21);
    const first = new CoopMissionRuntime(descriptor());
    recipe(first);
    bind(first, 'A');
    host.attach(descriptor(), first);

    const second = new CoopMissionRuntime({ ...descriptor(), activityRevision: 32 });
    bind(second, 'B');
    host.attach({ ...descriptor(), activityRevision: 32 }, second);
    recipe(second);

    expect(generation).toBe(2);
    expect(second.enemyManager).not.toBeNull();
    expect(calls).toContain('A:detach:enemy');
    expect(calls.indexOf('A:detach:enemy')).toBeLessThan(calls.indexOf('enemy:1:destroy'));
    expect(calls).toContain('B:attach:enemy');
  });

  it('trennt den vollstaendigen Activity-Graphen bei A -> B und entfernt A-Callbacks', () => {
    const calls: string[] = [];
    let activeCallback: string | null = null;
    const host = new ActivityRuntimeHost(21);

    const materialize = (runtime: CoopMissionRuntime, label: string) => {
      const enemy = {
        setLethalDamageGuard: () => {},
        setEnemySpawnedCallback: () => {},
        destroy: () => { calls.push(`${label}:enemy`); },
        setVisualSink: () => {},
      } as unknown as EnemyManager;
      const navigation = {
        coordinator: { destroy: () => { calls.push(`${label}:navigation`); } },
        enemy: flowField(`${label}:flow-enemy`, calls),
        player: flowField(`${label}:flow-player`, calls),
        strategic: flowField(`${label}:flow-strategic`, calls),
        boss: flowField(`${label}:flow-boss`, calls),
        targetCatalog: clearable(`${label}:catalog`, calls),
        strategicTarget: clearable(`${label}:strategic-target`, calls),
        releaseGridChanges: () => { calls.push(`${label}:grid-listener`); },
      } as unknown as CoopMissionNavigationRuntime;
      const objectives = {
        secondaryObjectives: resettable(`${label}:secondary`, calls),
        missionProgress: resettable(`${label}:progress`, calls),
        barriers: { destroy: () => { calls.push(`${label}:barriers`); } },
        carry: { destroy: () => { calls.push(`${label}:carry`); } },
        repair: resettable(`${label}:repair`, calls),
        placementReward: resettable(`${label}:placement`, calls),
        roundState: null,
      } as unknown as CoopMissionObjectiveRuntime;

      runtime.setEnemyManager(enemy);
      runtime.setNavigation(navigation);
      runtime.setEncounter({
        spawnExecutor: {},
        persistentPressure: resettable(`${label}:pressure`, calls),
        boss: resettable(`${label}:boss`, calls),
        director: resettable(`${label}:director`, calls),
      } as unknown as CoopMissionEncounterRuntime);
      runtime.setEnemyBehaviour({
        trainAwareness: clearable(`${label}:train`, calls),
        burrow: clearable(`${label}:burrow`, calls),
        dodge: clearable(`${label}:dodge`, calls),
        combatPositioning: clearable(`${label}:positioning`, calls),
        ability: clearable(`${label}:ability`, calls),
        attack: {},
      } as unknown as CoopMissionEnemyBehaviourRuntime);
      runtime.setEnemySpecials({
        timebomb: clearable(`${label}:timebomb`, calls),
        voidHunter: clearable(`${label}:void-hunter`, calls),
      } as unknown as CoopMissionEnemySpecialRuntime);
      runtime.setNecromancy({
        setCorpseSink: () => {},
        clear: () => { calls.push(`${label}:necromancy`); },
      } as unknown as NecromancySystem);
      runtime.setObjectives(objectives);
      runtime.setPlayerActivity({
        destroy: () => { calls.push(`${label}:player-activity`); },
      } as unknown as CoopMissionPlayerRuntime);
      runtime.setMapEventDirector(
        resettable(`${label}:map-events`, calls) as unknown as CoopDefenseMapEventDirector,
      );
      runtime.bind({
        attach: () => { activeCallback = label; },
        detach: () => { if (activeCallback === label) activeCallback = null; },
      });
      return { enemy, navigation, objectives };
    };

    const first = new CoopMissionRuntime(descriptor());
    const graphA = materialize(first, 'A');
    host.attach(descriptor(), first);

    const second = new CoopMissionRuntime({ ...descriptor(), activityRevision: 32 });
    const graphB = materialize(second, 'B');
    host.attach({ ...descriptor(), activityRevision: 32 }, second);

    expect(graphB.enemy).not.toBe(graphA.enemy);
    expect(graphB.navigation).not.toBe(graphA.navigation);
    expect(graphB.objectives).not.toBe(graphA.objectives);
    expect(first.enemyManager).toBeNull();
    expect(first.flowFieldCoordinator).toBeNull();
    expect(first.coopDefenseMissionProgressSystem).toBeNull();
    expect(second.enemyManager).toBe(graphB.enemy);
    expect(second.flowFieldCoordinator).toBe(graphB.navigation.coordinator);
    expect(second.coopDefenseMissionProgressSystem).toBe(graphB.objectives.missionProgress);
    expect(activeCallback).toBe('B');
    expect(calls).toContain('A:enemy');
    expect(calls).toContain('A:navigation');
    expect(calls).toContain('A:map-events');
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
    expect(source).toContain('this.coopMissionComposition.materializeCore(');
    expect(source).toContain('this.coopMissionComposition.materializeDependents(');
    expect(source).not.toContain('materializeCoopMissionActivityCompositions');
    expect(source).toContain('this.worldLifecycle.syncObservedActivity(bridge.getActivityDescriptor());');
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

    // Phase 11A entfernt auch die gerichteten Context-Lesefassaden. Die CoopMissionRuntime ist
    // der einzige Zugriffspfad fuer ihren Runtime-Graphen.
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
      expect(source, compatibilityField).not.toContain(`this.ctx.${compatibilityField}`);
    }
  });

  it('loest alle laenger lebenden EnemyManager-Bindings ueber ihre World-Owner am Activity-Detach', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const start = source.indexOf('    runtime.bind({');
    const end = source.indexOf('    this.attachCoopMissionBaseBinding(activity, runtime);', start);
    const binding = source.slice(start, end);
    for (const consumer of [
      'combatSystem',
      'hostPhysics',
    ]) {
      expect(binding).toContain(`this.ctx.${consumer}`);
      expect(binding).toMatch(new RegExp(`this\\.ctx\\.${consumer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\??\\.setEnemyManager\\(null\\)`));
    }
    expect(binding).toContain('this.ctx.hostPhysics.setEnemyRockContactCallback(null);');
    expect(binding).toContain('this.worldTrainRuntime?.setEnemyManager(null);');

    expect(binding).toContain('this.worldCombatGameplayBinding?.updateEnemyManager(null);');
    expect(binding).toContain('this.worldPlayerGameplayRuntime?.updateEnemyManager(null);');
    const playerOwner = readFileSync(resolve(process.cwd(), 'src/world/WorldPlayerGameplayRuntime.ts'), 'utf8');
    for (const system of ['guardianSpirit', 'slimeTrail', 'flamethrowerUpgrade', 'weaponUpgrade', 'ak47StrategicTarget']) {
      expect(playerOwner).toContain(`this.systems.${system}?.clear();`);
      expect(playerOwner).toContain(`this.systems.${system}?.setEnemyManager(enemyManager);`);
    }
    expect(readFileSync(resolve(process.cwd(), 'src/world/WorldCombatGameplayBinding.ts'), 'utf8'))
      .toContain('this.systems?.energyShield.setEnemyManager(enemyManager);');

    const mapEventComposition = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionMapEventComposition.ts'),
      'utf8',
    );
    expect(mapEventComposition).toContain('this.options.train.materializeAuthoredTrain');
    expect(mapEventComposition).toContain('this.options.train.releaseActivityTrain');
    expect(mapEventComposition).toContain('new CoopDefenseAirstrikeEventHandler');
    expect(mapEventComposition).toContain('new CoopDefenseGroundHazardEventHandler');

    for (const system of [
      'Ak47StrategicTargetSystem',
      'FlamethrowerUpgradeSystem',
      'GuardianSpiritSystem',
      'SlimeTrailSystem',
      'WeaponUpgradeSystem',
    ]) {
      const implementation = readFileSync(resolve(process.cwd(), `src/systems/${system}.ts`), 'utf8');
      expect(implementation).toContain('setEnemyManager(enemyManager: EnemyManager | null): void');
      expect(implementation).not.toContain('private readonly enemyManager: EnemyManager');
    }
  });

  it('hält die konkrete 10B.2-Kampfkonstruktion in der Activity-Composition', () => {
    const coordinator = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const composition = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionCombatComposition.ts'),
      'utf8',
    );
    const activityComposition = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionComposition.ts'),
      'utf8',
    );
    for (const constructor of [
      'new EnemyManager',
      'new FlowFieldCoordinator',
      'new CoopDefenseSpawnExecutor',
      'new CoopDefensePersistentPressureSystem',
      'new CoopDefenseBossSystem',
      'new CoopDefenseMapDirector',
    ]) {
      expect(coordinator, `${constructor} leaked back into coordinator`).not.toContain(constructor);
      expect(composition).toContain(constructor);
    }
    expect(activityComposition).toContain('getBaseSpecs()');
    expect(activityComposition).toContain('getActiveBaseIds()');
    expect(composition).toContain('releaseGridChanges');
    expect(composition).toContain('scene.game.events.off');
    expect(activityComposition).toContain('new CoopMissionCombatComposition');
    for (const child of [
      'new CoopMissionObjectiveComposition',
      'new CoopMissionPlayerComposition',
      'new CoopMissionEnemyBehaviourComposition',
      'new CoopMissionEnemySupportComposition',
      'new CoopMissionMapEventComposition',
    ]) {
      expect(activityComposition).toContain(child);
    }
    expect(coordinator).toContain('this.coopMissionComposition.materializeCore(configuration, runtime, layout)');
    expect(coordinator).not.toContain('createCombatComposition(');
    expect(coordinator).not.toContain('new CoopMissionEnemyBehaviourComposition(');
    expect(coordinator).not.toContain('new CoopMissionEnemySupportComposition(');
    expect(coordinator).not.toContain('new CoopMissionMapEventComposition(');
    expect(coordinator).not.toContain('new CoopMissionPlayerComposition(');
    expect(coordinator).not.toContain('new CoopMissionObjectiveComposition(');
    for (const concreteWorldGraph of [
      'TrainManager',
      'TrainRenderer',
      'new PowerUpSystem',
      'getCoopDefenseConstructionDefinition',
      'COOP_DEFENSE_CONSTRUCTION_IDS',
    ]) {
      expect(coordinator, `${concreteWorldGraph} leaked into coordinator`).not.toContain(concreteWorldGraph);
    }
  });

  it('taktet die Activity-Client-Presentation ueber genau einen kanonischen Schritt', () => {
    const CLIENT_UPDATE_PATH = 'src/scenes/arena/ClientUpdateCoordinator.ts';
    const clientUpdate = readFileSync(resolve(process.cwd(), CLIENT_UPDATE_PATH), 'utf8');
    // Spiegelbild zum Host-Pendant (tests/HostUpdatePhaseContracts.test.ts): der Frame-Owner
    // kennt den Praesentations-Schritt der Activity nur an genau einer Stelle.
    expect([...clientUpdate.matchAll(/clientPresentationStep\(/g)]).toHaveLength(1);
    expect(clientUpdate).not.toContain('getCoopMissionRuntime');
    expect(clientUpdate).not.toContain('enemyManager?.applySnapshot');
    expect(clientUpdate).not.toContain('enemyManager?.updateClientInterpolation');
    expect(clientUpdate).not.toContain('syncCoopDefenseCarry');

    // Ausserhalb des Frame-Owners darf kein weiterer Aufruf des kanonischen Schritts entstehen.
    for (const dir of ['src/scenes', 'src/world']) {
      for (const file of collectTypeScriptFiles(resolve(process.cwd(), dir))) {
        const relativePath = relative(process.cwd(), file).split(sep).join('/');
        if (relativePath === CLIENT_UPDATE_PATH) continue;
        expect(readFileSync(file, 'utf8'), relativePath).not.toContain('clientPresentationStep(');
      }
    }
  });
});
