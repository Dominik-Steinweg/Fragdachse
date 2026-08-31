import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoopMissionPlayerRuntime } from '../src/activity/CoopMissionPlayerRuntime';
import { CoopMissionRuntime } from '../src/activity/CoopMissionRuntime';
import type { CoopDefenseRespawnBudgetSystem } from '../src/systems/CoopDefenseRespawnBudgetSystem';
import type { PlayerProfile } from '../src/types';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
  type PlayerWorldRuntimeSteps,
} from '../src/world/PlayerWorldRuntime';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldRuntime } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Phase 7: Getrennte Player-Lifetimes.
 *
 * Verbindliche Probe der Architektur: Activity A endet, Activity B startet, die World bleibt
 * dieselbe. Die `PlayerWorldRuntime` bleibt, die `CoopMissionPlayerRuntime` von A wird zerstoert
 * und fuer B neu erzeugt.
 */

const WORLD_REVISION = 21;

function worldDescriptor(): WorldDescriptor {
  return {
    worldRevision: WORLD_REVISION,
    definitionId: 'world:coop-defense:3',
    seed: 909,
    generatorVersion: 3,
    layoutFingerprint: 'abc123',
  };
}

function activityDescriptor(activityRevision: number): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision: WORLD_REVISION,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:3',
  };
}

function profile(id: string): PlayerProfile {
  return { id, name: id, colorHex: '#fff' } as unknown as PlayerProfile;
}

function worldSteps(calls: string[]): PlayerWorldRuntimeSteps {
  return {
    attach: [{ id: 'entity', feature: 'entity', run: ({ profile: p }) => { calls.push(`world:attach:${p.id}`); } }],
    detach: [{ id: 'entity', feature: 'entity', run: (id) => { calls.push(`world:detach:${id}`); } }],
  };
}

function budget(calls: string[], label: string): CoopDefenseRespawnBudgetSystem {
  return {
    registerInitialSpawn: (id: string) => { calls.push(`${label}:register:${id}`); return true; },
    handlePlayerDeath: (id: string) => { calls.push(`${label}:death:${id}`); return true; },
    consumeRespawn: (id: string) => { calls.push(`${label}:respawn:${id}`); return true; },
    isTeamWiped: () => false,
    getSnapshot: () => ({ respawnsPerPlayer: 2, players: {} }),
  } as unknown as CoopDefenseRespawnBudgetSystem;
}

function missionPlayers(
  calls: string[],
  label: string,
  respawnBudget: CoopDefenseRespawnBudgetSystem | null = null,
): CoopMissionPlayerRuntime {
  return new CoopMissionPlayerRuntime({
    respawnBudget,
    releaseMissionObjectives: (id) => { calls.push(`${label}:release:${id}`); },
    // Ally-Flowfield-Lifetime wird in den konkreten Navigation-Contracts separat verifiziert.
    ensureAllyFlowField: () => {},
    removeAllyFlowField: () => {},
    publishRespawnBudget: () => { calls.push(`${label}:publish`); },
  });
}

describe('Player-Lifetimes – World bleibt, Activity wird ersetzt', () => {
  it('haelt die World-Runtime des Spielers ueber einen Activity-Wechsel hinweg', () => {
    const calls: string[] = [];
    const world = new WorldRuntime({ descriptor: worldDescriptor() } as WorldRuntimeContext);
    const players = new PlayerWorldRuntime(worldSteps(calls));
    world.setPlayers(players);
    players.attach(
      { profile: profile('p1'), reconnectAfterDeath: false },
      resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' }),
    );

    // Activity A nimmt den bereits stehenden Spieler auf.
    const activityA = new CoopMissionRuntime(activityDescriptor(1));
    const playersA = missionPlayers(calls, 'A', budget(calls, 'A'));
    activityA.setPlayerActivity(playersA);
    for (const playerId of players.attachedPlayerIds()) playersA.attach(playerId);
    world.activity.attach(activityDescriptor(1), activityA);

    calls.length = 0;

    // A -> B in derselben World.
    const activityB = new CoopMissionRuntime(activityDescriptor(2));
    world.activity.attach(activityDescriptor(2), activityB);
    const playersB = missionPlayers(calls, 'B', budget(calls, 'B'));
    activityB.setPlayerActivity(playersB);
    for (const playerId of players.attachedPlayerIds()) playersB.attach(playerId);

    // A ist vollstaendig weg, B frisch materialisiert - die World-Runtime blieb unberuehrt.
    expect(calls).toEqual(['A:release:p1', 'B:register:p1']);
    expect(playersA.isAttached('p1')).toBe(false);
    expect(playersB.isAttached('p1')).toBe(true);
    expect(players.isAttached('p1')).toBe(true);
    expect(world.players).toBe(players);
  });

  it('nimmt den Missionsanteil ueber den realen Materialisierungspfad neu auf', () => {
    const calls: string[] = [];
    const world = new WorldRuntime({ descriptor: worldDescriptor() } as WorldRuntimeContext);
    const players = new PlayerWorldRuntime(worldSteps(calls));
    world.setPlayers(players);
    for (const id of ['p1', 'p2']) {
      players.attach(
        { profile: profile(id), reconnectAfterDeath: false },
        resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' }),
      );
    }

    let generation = 0;
    // Genau das Rezept, das der Koordinator merkt: neue Runtime, dann die stehende Besetzung.
    const recipe = (runtime: CoopMissionRuntime): void => {
      const label = `gen${++generation}`;
      const playerActivity = missionPlayers(calls, label, budget(calls, label));
      runtime.setPlayerActivity(playerActivity);
      for (const playerId of players.attachedPlayerIds()) playerActivity.attach(playerId);
    };

    const activityA = new CoopMissionRuntime(activityDescriptor(1));
    recipe(activityA);
    world.activity.attach(activityDescriptor(1), activityA);

    calls.length = 0;
    const activityB = new CoopMissionRuntime(activityDescriptor(2));
    world.activity.attach(activityDescriptor(2), activityB);
    recipe(activityB);

    expect(generation).toBe(2);
    expect(calls).toEqual([
      'gen1:release:p1',
      'gen1:release:p2',
      'gen2:register:p1',
      'gen2:register:p2',
    ]);
    // A haelt nach ihrem Ende keinen Spieleranteil mehr; B fuehrt die vollstaendige Besetzung.
    expect(activityA.playerActivity).toBeNull();
    expect(activityB.playerActivity?.attachedPlayerIds()).toEqual(['p1', 'p2']);
    // Die World-Runtime der Spieler blieb dieselbe; niemand ist neu eingetreten.
    expect(calls.some((entry) => entry.startsWith('world:'))).toBe(false);
  });

  it('loest mit dem Ende der World erst ihre Spieler und dann ihre Activity', () => {
    const calls: string[] = [];
    const world = new WorldRuntime({ descriptor: worldDescriptor() } as WorldRuntimeContext);
    const players = new PlayerWorldRuntime(worldSteps(calls));
    world.setPlayers(players);
    players.attach(
      { profile: profile('p1'), reconnectAfterDeath: false },
      resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' }),
    );
    const activity = new CoopMissionRuntime(activityDescriptor(1));
    const missionPlayerRuntime = missionPlayers(calls, 'A');
    activity.setPlayerActivity(missionPlayerRuntime);
    missionPlayerRuntime.attach('p1');
    world.activity.attach(activityDescriptor(1), activity);

    calls.length = 0;
    world.destroy();
    world.destroy();

    // Der World-Anteil geht zuerst; der Missionsanteil faellt mit der Activity danach.
    expect(calls).toEqual(['world:detach:p1', 'A:release:p1']);
    expect(world.players).toBeNull();
    expect(players.attachedPlayerIds()).toEqual([]);
  });
});

describe('CoopMissionPlayerRuntime – activity-scoped Spielerzustand', () => {
  it('fuehrt Lebensbudget und Zielfreigabe genau fuer aufgenommene Spieler', () => {
    const calls: string[] = [];
    const runtime = missionPlayers(calls, 'A', budget(calls, 'A'));

    expect(runtime.hasRespawnBudget).toBe(true);
    runtime.attach('p1');
    runtime.attach('p1');
    // Ein Wiedereintritt in dieselbe Runde eroeffnet kein zweites Leben.
    runtime.attach('p2', true);
    expect(calls).toEqual(['A:register:p1']);

    calls.length = 0;
    runtime.handlePlayerDeath('p1');
    expect(runtime.consumeRespawn('p1')).toBe(true);
    expect(calls).toEqual(['A:death:p1', 'A:publish', 'A:respawn:p1', 'A:publish']);

    calls.length = 0;
    runtime.detach('p1');
    runtime.detach('p1');
    runtime.detach('unbekannt');
    expect(calls).toEqual(['A:release:p1']);

    calls.length = 0;
    runtime.destroy();
    runtime.destroy();
    expect(calls).toEqual(['A:release:p2']);
    // Nach dem Ende nimmt die Mission niemanden mehr auf.
    runtime.attach('p3');
    expect(runtime.isAttached('p3')).toBe(false);
  });

  it('laesst ohne authored Budget jeden Respawn zu und meldet keinen Team-Wipe', () => {
    const calls: string[] = [];
    const runtime = missionPlayers(calls, 'A');
    runtime.attach('p1');
    runtime.handlePlayerDeath('p1');
    expect(runtime.hasRespawnBudget).toBe(false);
    expect(runtime.consumeRespawn('p1')).toBe(true);
    expect(runtime.isTeamWiped(['p1'], [])).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('Phase 7 – Ownership im Koordinator', () => {
  const coordinator = readFileSync(
    resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
    'utf8',
  );
  const composition = readFileSync(
    resolve(process.cwd(), 'src/world/PlayerWorldRuntimeComposition.ts'),
    'utf8',
  );

  it('erzeugt die Player-Runtime mit der World-Instanz', () => {
    expect(coordinator).toContain('this.worldRuntime.setPlayers(this.composePlayerRuntime());');
    expect(coordinator).toContain('return composePlayerWorldRuntime({');
    // Genau ein Erzeuger: die World. Ein scene-langlebiges Feld waere wieder eine zweite Lifetime.
    expect([...composition.matchAll(/new PlayerWorldRuntime\(/g)]).toHaveLength(1);
    expect(coordinator).toContain('return this.worldRuntime?.players ?? null;');
  });

  it('materialisiert den Missionsanteil der Spieler mit der Activity', () => {
    const activityComposition = readFileSync(
      resolve(process.cwd(), 'src/activity/CoopMissionPlayerComposition.ts'),
      'utf8',
    );
    expect(coordinator).toContain('this.coopMissionComposition.materializeDependents(');
    expect(coordinator).not.toContain('new CoopMissionPlayerComposition(');
    expect(activityComposition).toContain('runtime.setPlayerActivity(playerActivity);');
    // Beim Wechsel in derselben World nimmt die neue Mission die stehende Besetzung auf.
    expect(activityComposition).toContain("for (const playerId of this.options.playerWorldRuntime?.attachedPlayerIds() ?? []) {");
  });

  it('haelt Attach und Detach in der richtigen Reihenfolge', () => {
    const attachStart = coordinator.indexOf('  attachPlayerToWorld(');
    const attachBody = coordinator.slice(attachStart, coordinator.indexOf('\n  }', attachStart));
    expect(attachBody.indexOf('playerRuntime.attach('))
      .toBeLessThan(attachBody.indexOf('this.playerActivityRuntime?.attach('));

    const detachStart = coordinator.indexOf('  detachPlayerFromWorld(playerId: string): void {');
    const detachBody = coordinator.slice(detachStart, coordinator.indexOf('\n  }', detachStart));
    expect(detachBody.indexOf('this.playerActivityRuntime?.detach(playerId);'))
      .toBeLessThan(detachBody.indexOf('this.playerRuntime?.detach(playerId);'));
  });

  it('kennt keinen missionsgebundenen Player-State mehr im World-Lifecycle', () => {
    expect(coordinator).not.toContain("feature: 'missionStatus'");
    expect(coordinator).not.toContain("id: 'ally-flow-field'");
    expect(coordinator).not.toContain('this.ensureAllyFlowField(');
    expect(coordinator).not.toContain('this.ctx.coopDefenseRespawnBudgetSystem');
    const worldRuntimeSource = readFileSync(
      resolve(process.cwd(), 'src/world/PlayerWorldRuntime.ts'),
      'utf8',
    );
    expect(worldRuntimeSource).not.toContain('missionStatus');
    // Der Detach folgt dem Ledger, nicht einer erneut aufgeloesten Policy.
    expect(worldRuntimeSource).toContain('private readonly materializedFeatures = new Map<string, PlayerRuntimeFeatures>();');
    expect(worldRuntimeSource).toContain('detach(playerId: string): void {');
  });
});
