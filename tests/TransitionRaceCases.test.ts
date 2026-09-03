import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { parseWorldLoadReadyState } from '../src/world/WorldLoadReady';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
  type PlayerAttachStep,
} from '../src/world/PlayerWorldRuntime';
import {
  resolveWorldParticipation,
  type WorldParticipation,
} from '../src/world/WorldParticipation';
import { acceptWorldScoped, isCurrentWorldRevision, worldScoped } from '../src/world/WorldRevision';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import type { PlayerProfile } from '../src/types';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * Transition-/Race-Case-Netz fuer den gemeinsamen World- und Player-Lifecycle.
 *
 * Die Tests simulieren bewusst nur die kleinsten Lifecycle-Grenzen. Phaser-Scene-Aufbau und
 * Browser-Netzwerk gehoeren in den opt-in Smoke-Test; Revisionen, Reihenfolge und Rollbacks
 * muessen bereits an den reinen Vertraegen deterministisch sein.
 */

const PROFILE = { id: 'p1', name: 'Dachs', colorHex: '#fff' } as unknown as PlayerProfile;

function world(overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 12,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

function activity(worldRevision = 12): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

function runtime(descriptor: WorldDescriptor): WorldRuntimeContext {
  return { descriptor } as WorldRuntimeContext;
}

function sink(): { calls: string[]; value: WorldLifecycleSink } {
  const calls: string[] = [];
  const value: WorldLifecycleSink = {
    publish: (descriptor) => { calls.push(`publish:${descriptor.worldRevision}`); },
    publishActivity: (descriptor) => { calls.push(`activity:${descriptor?.activityRevision ?? 'none'}`); },
    clear: () => { calls.push('clear'); },
    attach: (context) => { calls.push(`attach:${context.descriptor.worldRevision}`); },
    detach: () => { calls.push('detach'); },
  };
  return { calls, value };
}

function attachStep(calls: string[]): PlayerAttachStep {
  return {
    id: 'entity',
    feature: 'entity',
    run: () => { calls.push('attach'); },
    rollback: () => { calls.push('rollback'); },
  };
}

function fullFeatures(): ReturnType<typeof resolvePlayerRuntimeFeatures> {
  return resolvePlayerRuntimeFeatures({
    activityKind: null,
    isHost: true,
    participation: 'interactive',
  });
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'ABC123' });
}

function bridgeFor(room: TestRoom): NetworkBridge {
  useRoom(room);
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

describe('Transition-/Race-Case-Tests', () => {
  it('serialisiert zwei gleichzeitige Erstanforderungen zu genau einer World-Instanz', () => {
    const recorded = sink();
    const lifecycle = new WorldLifecycle(recorded.value);

    lifecycle.beginCreate(world(), null);
    lifecycle.beginCreate(world(), null);

    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.descriptor?.worldRevision).toBe(12);
    expect(recorded.calls).toEqual(['publish:12']);
  });

  it('verwirft einen Disconnect waehrend joining ohne einen Player-Runtime-Eintrag zu erzeugen', () => {
    const joining = resolveWorldParticipation({
      worldActive: true,
      admitted: true,
      hasRuntimeEntry: false,
      mayAct: true,
    });
    expect(joining).toBe('joining');

    const calls: string[] = [];
    const playerRuntime = new PlayerWorldRuntime({
      attach: [attachStep(calls)],
      detach: [],
    });

    // Der Disconnect nimmt die Admission zurueck; ein noch nicht angehaengter Spieler hat
    // nichts zu detach-en und darf spaeter nicht aus einem alten Join fortgesetzt werden.
    const afterDisconnect: WorldParticipation = resolveWorldParticipation({
      worldActive: true,
      admitted: false,
      hasRuntimeEntry: false,
      mayAct: true,
    });
    playerRuntime.detach(PROFILE.id, fullFeatures());

    expect(afterDisconnect).toBe('none');
    expect(playerRuntime.isAttached(PROFILE.id)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('laesst den letzten Leave und einen neuen Join dieselbe World weiterverwenden', () => {
    const recorded = sink();
    const lifecycle = new WorldLifecycle(recorded.value);
    lifecycle.beginCreate(world(), null);
    lifecycle.attachRuntime(runtime(world()));

    lifecycle.detachRuntime();
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.descriptor?.worldRevision).toBe(12);

    lifecycle.attachRuntime(runtime(world()));
    expect(lifecycle.phase).toBe('active');
    expect(recorded.calls).toEqual(['publish:12', 'attach:12', 'detach', 'attach:12']);
  });

  it('behandelt schnellen Leave und Re-enter atomar auf dem Player-Lifecycle', () => {
    const calls: string[] = [];
    const playerRuntime = new PlayerWorldRuntime({
      attach: [attachStep(calls)],
      detach: [{ id: 'entity', feature: 'entity', run: () => { calls.push('detach'); } }],
    });
    const features = fullFeatures();

    expect(playerRuntime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features)).toBe(true);
    playerRuntime.detach(PROFILE.id, features);
    expect(playerRuntime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features)).toBe(true);

    expect(playerRuntime.isAttached(PROFILE.id)).toBe(true);
    expect(calls).toEqual(['attach', 'detach', 'attach']);
  });

  it('laesst kein verspätetes Runtime-Attach nach World Destroy durch', () => {
    const recorded = sink();
    const lifecycle = new WorldLifecycle(recorded.value);
    lifecycle.beginCreate(world(), null);
    lifecycle.endInstance();

    expect(() => lifecycle.attachRuntime(runtime(world())))
      .toThrow(/stale runtime for ended world revision/);
    expect(recorded.calls).toEqual(['publish:12', 'clear']);

    // Eine wirklich neue Instanz darf danach wieder beobachtet werden.
    lifecycle.attachRuntime(runtime(world({ worldRevision: 13 })));
    expect(lifecycle.descriptor?.worldRevision).toBe(13);
    expect(lifecycle.phase).toBe('active');
  });

  it('beendet eine Activity waehrend joining, ohne die World zu zerstoeren', () => {
    const recorded = sink();
    const lifecycle = new WorldLifecycle(recorded.value);
    lifecycle.beginCreate(world(), activity());

    lifecycle.activity.end();

    expect(lifecycle.activity.descriptor).toBeNull();
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.descriptor?.worldRevision).toBe(12);

    lifecycle.attachRuntime(runtime(world()));
    expect(lifecycle.phase).toBe('active');
    expect(lifecycle.activity.phase).toBe('none');
  });

  it('aktualisiert eine Activity derselben World ohne World-Teardown', () => {
    const recorded = sink();
    const lifecycle = new WorldLifecycle(recorded.value);
    lifecycle.beginCreate(world(), null);

    lifecycle.beginCreate(world(), activity());
    lifecycle.beginCreate(world(), null);

    expect(lifecycle.descriptor?.worldRevision).toBe(12);
    expect(lifecycle.activity.descriptor).toBeNull();
    expect(recorded.calls).toEqual(['publish:12', 'activity:31', 'activity:none']);
  });

  it('repliziert Activity-Wechsel innerhalb derselben World ohne neue World-Revision', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);

      useRoom(hostRoom);
      host.publishWorldAndActivity(world({ worldRevision: 12 }), null);
      host.publishActivity(activity(12));
      useRoom(clientRoom);
      expect(client.getWorldDescriptor()?.worldRevision).toBe(12);
      expect(client.getActivityDescriptor()?.activityRevision).toBe(31);

      useRoom(hostRoom);
      host.publishActivity(null);
      useRoom(clientRoom);
      expect(client.getWorldDescriptor()?.worldRevision).toBe(12);
      expect(client.getActivityDescriptor()).toBeNull();
    } finally {
      clearActiveSession();
    }
  });

  it('wendet keine Baseline der alten World auf die neue Revision an', () => {
    const oldRevision = worldScoped(12, { playerId: 'p1', x: 10 });
    const newRevision = worldScoped(13, { playerId: 'p1', x: 90 });
    const oldLoadReady = {
      worldRevision: 12,
      progress: 100,
      stage: 'ready' as const,
      ready: true,
    };

    expect(acceptWorldScoped(13, oldRevision)).toBeNull();
    expect(acceptWorldScoped(13, newRevision)).toEqual({ playerId: 'p1', x: 90 });
    expect(parseWorldLoadReadyState(oldLoadReady, 13)).toBeNull();
    expect(isCurrentWorldRevision(13, 12)).toBe(false);
    expect(isCurrentWorldRevision(13, 13)).toBe(true);
  });

  it('bindet Placement-/Loadout-RPCs an die World-Revision', async () => {
    const source = readFileSync(resolve(process.cwd(), 'src/network/NetworkBridge.ts'), 'utf8');
    const sendStart = source.indexOf('  async sendLoadoutUse(');
    const registerStart = source.indexOf('  registerLoadoutUseHandler(');
    expect(sendStart).toBeGreaterThan(0);
    expect(registerStart).toBeGreaterThan(sendStart);

    const sendBody = source.slice(sendStart, registerStart);
    const registerBody = source.slice(registerStart);
    expect(sendBody).toContain('wr: worldRevision');
    expect(registerBody).toContain('const { slot, angle, tx, ty, sid, prm, px, py, wr } = data');
    expect(registerBody).toContain('this.acceptsWorldRpc(data)');

    // Der eigentliche Race-Schutz ist dieselbe zentrale Revisionserkennung wie bei Snapshots:
    // ein alter Request ist nicht „fast genug“, sondern gehoert schlicht nicht zur World.
    expect(isCurrentWorldRevision(13, 12)).toBe(false);
    expect(isCurrentWorldRevision(13, 13)).toBe(true);

    // Echtes RPC-Race: der Request wurde noch in World 12 erzeugt, wird aber erst in World 13
    // verarbeitet. Der Host-Handler darf die Platzierungs-/Loadout-Mutation nicht erreichen.
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const handler = vi.fn(() => ({ ok: true }));
      host.registerLoadoutUseHandler(handler);
      host.publishWorldAndActivity(world({ worldRevision: 12 }), null);
      host.publishWorldAndActivity(world({ worldRevision: 13 }), null);

      useRoom(hostRoom);
      const stale = await clientRoom.room.callHost('lu', {
        slot: 'utility', angle: 0, tx: 10, ty: 10, wr: 12,
      }, 500);
      expect(stale).toEqual({ ok: false, reason: 'blocked' });
      expect(handler).not.toHaveBeenCalled();

      const current = await clientRoom.room.callHost('lu', {
        slot: 'utility', angle: 0, tx: 10, ty: 10, wr: 13,
      }, 500);
      expect(current).toEqual({ ok: true });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      clearActiveSession();
    }
  });
});
