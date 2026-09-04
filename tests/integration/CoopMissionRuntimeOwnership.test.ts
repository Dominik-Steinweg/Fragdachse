import { describe, expect, it, vi } from 'vitest';
import {
  CoopMissionRuntime,
  type CoopMissionEnemyBehaviourRuntime,
  type CoopMissionEnemySpecialRuntime,
  type CoopMissionEncounterRuntime,
  type CoopMissionNavigationRuntime,
  type CoopMissionObjectiveRuntime,
} from '../../src/activity/CoopMissionRuntime';
import type { CoopMissionPlayerRuntime } from '../../src/activity/CoopMissionPlayerRuntime';
import type { EnemyManager } from '../../src/entities/EnemyManager';
import type { CoopDefenseMapEventDirector } from '../../src/systems/CoopDefenseMapEventDirector';
import type { NecromancySystem } from '../../src/systems/NecromancySystem';
import type { ActivityDescriptor } from '../../src/world/ActivityDescriptor';
import { ActivityRuntimeHost } from '../../src/world/ActivityRuntimeHost';

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
