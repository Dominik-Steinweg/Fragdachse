import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoundParticipationState } from '../src/types';
import type { RoundState } from '../src/network/NetworkBridge';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import {
  isArenaTransitionReady,
  type ArenaTransitionReadiness,
} from '../src/scenes/arena/ArenaTransitionReadiness';

const MATCH_START = 123_456;

function world(worldRevision: number, definitionId = 'world:coop-defense:7'): WorldDescriptor {
  return {
    worldRevision,
    definitionId,
    seed: worldRevision,
    generatorVersion: 3,
    layoutFingerprint: `fingerprint-${worldRevision}`,
  };
}

function activity(worldRevision: number, activityRevision = worldRevision): ActivityDescriptor {
  return {
    activityRevision,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

function roundState(roundStartTime = MATCH_START): RoundState {
  return { status: 'active', roundStartTime };
}

function participation(roundRevision: number): RoundParticipationState {
  return {
    roundStartTime: MATCH_START,
    roundRevision,
    participantIds: ['p1'],
    spectatorIds: [],
  };
}

function readiness(overrides: Partial<ArenaTransitionReadiness> = {}): ArenaTransitionReadiness {
  return {
    phase: 'ARENA',
    worldDescriptor: world(19),
    activityDescriptor: activity(19),
    roundState: roundState(),
    arenaStartTime: MATCH_START,
    participation: participation(19),
    ...overrides,
  };
}

function runtime(descriptor: WorldDescriptor): WorldRuntimeContext {
  return { descriptor } as WorldRuntimeContext;
}

describe('Arena-Transition-Bereitschaft', () => {
  it('erlaubt keinen Build bei ARENA + World + Activity null', () => {
    expect(isArenaTransitionReady(readiness({ activityDescriptor: null }))).toBe(false);
  });

  it('verwirft eine Activity fuer die alte World-Revision', () => {
    expect(isArenaTransitionReady(readiness({ activityDescriptor: activity(18) }))).toBe(false);
  });

  it('erlaubt den Build bei passender World, Activity, Round-State und Participation', () => {
    expect(isArenaTransitionReady(readiness({
      activityDescriptor: activity(19, 31),
      participation: participation(31),
    }))).toBe(true);
  });

  it('erlaubt die Activity-lose LobbyWorld weiterhin', () => {
    expect(isArenaTransitionReady(readiness({
      phase: 'LOBBY',
      worldDescriptor: world(18, 'world:lobby'),
      activityDescriptor: null,
      roundState: null,
      participation: null,
    }))).toBe(true);
  });

  it('verlangt beim LobbyWorld-zu-MatchWorld-Race ein Ende der alten Instanz', () => {
    const calls: string[] = [];
    const sink: WorldLifecycleSink = {
      publish: () => {},
      clear: () => { calls.push('clear'); },
      attach: (context) => { calls.push(`attach:${context.descriptor.worldRevision}`); },
      detach: () => { calls.push('detach'); },
    };
    const lifecycle = new WorldLifecycle(sink);
    const lobby = world(18, 'world:lobby');
    const match = world(19);

    lifecycle.attachRuntime(runtime(lobby));
    expect(() => lifecycle.attachRuntime(runtime(match), activity(19))).toThrow(/does not match/);

    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match), activity(19));

    expect(calls).toEqual(['attach:18', 'detach', 'clear', 'attach:19']);
  });

  it('durchlaeuft Lobby → Match → Lobby → Match ohne Lifecycle-Mismatch', () => {
    const lifecycle = new WorldLifecycle({
      publish: () => {},
      clear: () => {},
      attach: () => {},
      detach: () => {},
    });
    const lobby1 = world(18, 'world:lobby');
    const match1 = world(19);
    const lobby2 = world(20, 'world:lobby');
    const match2 = world(21);

    lifecycle.attachRuntime(runtime(lobby1));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match1), activity(19));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(lobby2));
    lifecycle.endInstance();
    lifecycle.attachRuntime(runtime(match2), activity(21));

    expect(lifecycle.descriptor).toEqual(match2);
    expect(lifecycle.activity.descriptor).toEqual(activity(21));
  });
});

describe('ArenaLifecycleCoordinator – Replacement-Orchestrierung', () => {
  it('leitet LobbyWorld → MatchWorld nicht ueber den Lobby-Teardown um', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const detectStart = source.indexOf('  detectWorldChange(): void {');
    const detectEnd = source.indexOf('\n  /**', detectStart);
    const detectBody = source.slice(detectStart, detectEnd);
    const transitionStart = source.indexOf('  private onTransitionToArena(): void {');
    const transitionEnd = source.indexOf('\n  private startTerrainSnapshotBuild', transitionStart);
    const transitionBody = source.slice(transitionStart, transitionEnd);

    expect(detectBody).toContain('const lobbyToMatch =');
    expect(detectBody).toContain('const matchToLobby =');
    expect(detectBody).toContain("if (lobbyToMatch || (bridge.getGamePhase() === 'ARENA' && !matchToLobby))");
    expect(detectBody).toContain('this.onTransitionToArena();');
    expect(detectBody).toContain('this.onTransitionToLobby();');
    expect(transitionBody).toContain('this.synchronizeLocalWorldLifecycle(worldDescriptor);');

    const cleanupStart = source.indexOf('  private synchronizeLocalWorldLifecycle(');
    const cleanupEnd = source.indexOf('\n  private onTransitionToLobby', cleanupStart);
    const cleanupBody = source.slice(cleanupStart, cleanupEnd);
    expect(cleanupBody.indexOf('this.detachAllWorldPlayers();'))
      .toBeLessThan(cleanupBody.indexOf('this.worldLifecycle.endInstance();'));
    expect(cleanupBody.indexOf('this.worldLifecycle.endInstance();'))
      .toBeLessThan(cleanupBody.indexOf('this.clearWorldAdmission();'));
    expect(source).toContain("this.terminateMatch('Lokale Arena konnte nicht aufgebaut werden.');");
    expect(source).not.toContain('Generator/Fingerprint abweichend');
  });
});
