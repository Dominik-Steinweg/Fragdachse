import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import { ActivityRuntimeHost, type ActivityRuntime } from '../src/world/ActivityRuntimeHost';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import { WorldRuntime, type WorldScopedBinding } from '../src/world/WorldRuntime';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Ownership und Teardown der lokalen World-Runtime.
 *
 * `WorldLifecycle` besitzt die Identitaet der replizierten World, `WorldRuntime` ihre lokale
 * Realisierung. Diese Tests halten die Trennung fest: Ein Runtime-Teardown beendet die
 * World-Instanz nicht, und dieselbe Instanz kann eine neue Runtime bekommen.
 */

function descriptor(overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 21,
    definitionId: 'world:coop-defense:3',
    seed: 909,
    generatorVersion: 3,
    layoutFingerprint: 'abc123',
    ...overrides,
  };
}

function activity(worldRevision = 21): ActivityDescriptor {
  return {
    activityRevision: 5,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:3',
  };
}

/** Nur die Identitaet zaehlt hier; der materialisierte Rest gehoert spaeteren Phasen. */
function context(world: WorldDescriptor = descriptor()): WorldRuntimeContext {
  return { descriptor: world } as WorldRuntimeContext;
}

interface RecordedBinding extends WorldScopedBinding {
  destroyCount: number;
  updates: number;
}

function binding(id: string, calls: string[], withUpdate = true): RecordedBinding {
  const recorded: RecordedBinding = {
    destroyCount: 0,
    updates: 0,
    update: withUpdate
      ? (deltaMs: number) => { recorded.updates += 1; calls.push(`update:${id}:${deltaMs}`); }
      : undefined,
    destroy: () => { recorded.destroyCount += 1; calls.push(`destroy:${id}`); },
  };
  return recorded;
}

interface RecordedActivityRuntime extends ActivityRuntime {
  destroyCount: number;
  updates: number;
}

function activityRuntime(id: string, calls: string[]): RecordedActivityRuntime {
  const recorded: RecordedActivityRuntime = {
    destroyCount: 0,
    updates: 0,
    update: (deltaMs: number) => { recorded.updates += 1; calls.push(`update:${id}:${deltaMs}`); },
    destroy: () => { recorded.destroyCount += 1; calls.push(`destroy:${id}`); },
  };
  return recorded;
}

describe('WorldRuntime – Composition Owner einer World', () => {
  it('traegt die Identitaet ihrer World und startet ohne belegte Slots', () => {
    const runtime = new WorldRuntime(context());
    expect(runtime.descriptor.worldRevision).toBe(21);
    expect(runtime.isDestroyed()).toBe(false);
    expect(runtime.activity.isAttached()).toBe(false);
    expect(runtime.activity.descriptor).toBeNull();
  });

  it('taktet die eigenen Child-Owner in Aufbaureihenfolge – die Activity zuletzt', () => {
    const calls: string[] = [];
    const runtime = new WorldRuntime(context());
    runtime.setPersistentBaseBinding(binding('persistentBase', calls));
    runtime.setPresentationBinding(binding('presentation', calls));
    runtime.activity.attach(activity(), activityRuntime('activity', calls));

    runtime.update(16);

    expect(calls).toEqual([
      'update:persistentBase:16',
      'update:presentation:16',
      'update:activity:16',
    ]);
  });

  it('taktet auch ohne Activity und ohne Bindings ohne Sonderpfad', () => {
    const runtime = new WorldRuntime(context());
    expect(() => runtime.update(16)).not.toThrow();
  });

  it('raeumt in umgekehrter Aufbaureihenfolge ab und ist idempotent', () => {
    const calls: string[] = [];
    const persistentBase = binding('persistentBase', calls);
    const presentation = binding('presentation', calls);
    const mission = activityRuntime('activity', calls);
    const runtime = new WorldRuntime(context());
    runtime.setPersistentBaseBinding(persistentBase);
    runtime.setPresentationBinding(presentation);
    runtime.activity.attach(activity(), mission);

    runtime.destroy();
    runtime.destroy();

    expect(calls).toEqual(['destroy:activity', 'destroy:presentation', 'destroy:persistentBase']);
    expect(mission.destroyCount).toBe(1);
    expect(presentation.destroyCount).toBe(1);
    expect(persistentBase.destroyCount).toBe(1);
    expect(runtime.isDestroyed()).toBe(true);
    expect(runtime.activity.isAttached()).toBe(false);
  });

  it('taktet nach dem Teardown nicht mehr', () => {
    const calls: string[] = [];
    const runtime = new WorldRuntime(context());
    const presentation = binding('presentation', calls);
    runtime.setPresentationBinding(presentation);
    runtime.destroy();

    runtime.update(16);

    expect(presentation.updates).toBe(0);
  });

  it('fuehrt pro Slot genau ein Binding und zerstoert das ersetzte', () => {
    const calls: string[] = [];
    const first = binding('first', calls);
    const second = binding('second', calls);
    const runtime = new WorldRuntime(context());

    runtime.setPresentationBinding(first);
    runtime.setPresentationBinding(first);
    expect(first.destroyCount).toBe(0);

    runtime.setPresentationBinding(second);
    expect(first.destroyCount).toBe(1);

    runtime.update(16);
    expect(first.updates).toBe(0);
    expect(second.updates).toBe(1);

    runtime.setPresentationBinding(null);
    expect(second.destroyCount).toBe(1);
    runtime.update(16);
    expect(second.updates).toBe(1);
  });

  it('nimmt nach dem Teardown keinen neuen Child-Owner mehr auf', () => {
    const calls: string[] = [];
    const runtime = new WorldRuntime(context());
    runtime.destroy();

    expect(() => runtime.setPresentationBinding(binding('late', calls))).toThrow(/destroyed runtime/);
    expect(() => runtime.setPersistentBaseBinding(binding('late', calls))).toThrow(/destroyed runtime/);
    expect(() => runtime.activity.attach(activity(), activityRuntime('late', calls))).toThrow(/closed slot/);
    expect(calls).toEqual([]);
  });
});

describe('ActivityRuntimeHost – Slot der lokal materialisierten Activity', () => {
  it('belegt, taktet und loest den Slot', () => {
    const calls: string[] = [];
    const host = new ActivityRuntimeHost(21);
    const mission = activityRuntime('mission', calls);

    host.attach(activity(), mission);
    expect(host.isAttached()).toBe(true);
    expect(host.descriptor?.activityRevision).toBe(5);

    host.update(16);
    expect(mission.updates).toBe(1);

    host.detach();
    host.detach();
    expect(mission.destroyCount).toBe(1);
    expect(host.isAttached()).toBe(false);
    expect(host.descriptor).toBeNull();
    expect(() => host.update(16)).not.toThrow();
  });

  it('fuehrt nie zwei Activity-Runtimes gleichzeitig', () => {
    const calls: string[] = [];
    const host = new ActivityRuntimeHost(21);
    const first = activityRuntime('first', calls);
    const second = activityRuntime('second', calls);

    host.attach(activity(), first);
    host.attach({ ...activity(), activityRevision: 6 }, second);

    expect(first.destroyCount).toBe(1);
    expect(host.descriptor?.activityRevision).toBe(6);
    host.update(16);
    expect(first.updates).toBe(0);
    expect(second.updates).toBe(1);
  });

  it('lehnt die Activity einer anderen World-Instanz ab', () => {
    const calls: string[] = [];
    const host = new ActivityRuntimeHost(21);
    const stale = activityRuntime('stale', calls);

    expect(() => host.attach(activity(20), stale)).toThrow(/world revision/);
    expect(host.isAttached()).toBe(false);
    expect(stale.destroyCount).toBe(0);
  });
});

describe('WorldLifecycle + WorldRuntime – Identitaet ueberlebt die lokale Runtime', () => {
  interface LifecycleOwner {
    readonly lifecycle: WorldLifecycle;
    /** Alle jemals aufgebauten Runtimes dieser Anbindung, in Aufbaureihenfolge. */
    readonly runtimes: readonly WorldRuntime[];
    /** Die aktuell stehende Runtime; `null`, solange keine steht. */
    readonly current: () => WorldRuntime | null;
  }

  /** Dieselbe Anbindung wie im Arena-Coordinator: Der Sink besitzt die lokale Runtime. */
  function createLifecycle(): LifecycleOwner {
    const runtimes: WorldRuntime[] = [];
    let current: WorldRuntime | null = null;
    const sink: WorldLifecycleSink = {
      publish: () => { /* Wire-Verhalten ist hier nicht Gegenstand */ },
      clear: () => { /* dito */ },
      attach: (worldContext) => {
        current = new WorldRuntime(worldContext);
        runtimes.push(current);
      },
      detach: () => {
        const runtime = current;
        current = null;
        runtime?.destroy();
      },
    };
    return { lifecycle: new WorldLifecycle(sink), runtimes, current: () => current };
  }

  it('erzeugt die Runtime beim Attach und zerstoert sie beim Detach – ohne die Instanz zu beenden', () => {
    const owner = createLifecycle();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime(context());

    const first = owner.current();
    expect(first?.isDestroyed()).toBe(false);

    owner.lifecycle.detachRuntime();

    expect(first?.isDestroyed()).toBe(true);
    expect(owner.current()).toBeNull();
    // Die replizierte Instanz lebt weiter; nur ihre lokale Realisierung ist gefallen.
    expect(owner.lifecycle.descriptor?.worldRevision).toBe(21);
    expect(owner.lifecycle.phase).toBe('creating');
  });

  it('baut fuer dieselbe World-Instanz eine neue Runtime auf', () => {
    const owner = createLifecycle();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime(context());
    const first = owner.current();
    owner.lifecycle.detachRuntime();
    owner.lifecycle.attachRuntime(context());
    const second = owner.current();

    expect(owner.runtimes).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(second?.isDestroyed()).toBe(false);
    expect(second?.descriptor.worldRevision).toBe(21);
    expect(owner.lifecycle.isActive()).toBe(true);
  });

  it('zerstoert die Runtime auch mit dem Ende der World-Instanz', () => {
    const owner = createLifecycle();
    owner.lifecycle.beginCreate(descriptor(), null);
    owner.lifecycle.attachRuntime(context());
    const runtime = owner.current();

    owner.lifecycle.endInstance();

    expect(runtime?.isDestroyed()).toBe(true);
    expect(owner.current()).toBeNull();
    expect(owner.lifecycle.descriptor).toBeNull();
    expect(owner.lifecycle.phase).toBe('none');
  });
});

describe('Arena-Anbindung', () => {
  it('haengt die lokale World-Runtime hinter den bestehenden WorldLifecycle', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    expect(source).toContain('this.worldRuntime = new WorldRuntime(context);');
    expect(source).toContain('runtime?.destroy();');
    expect(source).toContain('this.worldRuntime?.update(deltaMs);');

    const scene = readFileSync(resolve(__dirname, '../src/scenes/ArenaScene.ts'), 'utf8');
    expect(scene).toContain('this.lifecycle.updateWorldRuntime(delta);');
  });
});
