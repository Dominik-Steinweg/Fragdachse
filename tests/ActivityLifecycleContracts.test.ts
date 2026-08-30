import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActivityLifecycle, type ActivityLifecycleSink } from '../src/world/ActivityLifecycle';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Activity-Lebenszyklus neben dem der World.
 *
 * Eine Activity setzt zwingend eine aktive World voraus – umgekehrt nicht. Deshalb ist sie ein
 * eigener Lebenszyklus und kein weiteres Feld in der World: eine friedliche World laeuft mit
 * `activity.phase === 'none'` weiter, ohne dass irgendwo Missionssysteme "auf null" stehen.
 */

function descriptor(overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 12,
    definitionId: 'world:coop-defense:7',
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

function mission(worldRevision = 12): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

function runtime(world: WorldDescriptor): WorldRuntimeContext {
  return { descriptor: world } as WorldRuntimeContext;
}

function createSinks() {
  const calls: string[] = [];
  const activity: ActivityLifecycleSink = {
    attach: (a) => { calls.push(`activity:attach:${a.activityRevision}`); },
    detach: () => { calls.push('activity:detach'); },
  };
  const world: WorldLifecycleSink = {
    publish: (w) => { calls.push(`world:publish:${w.worldRevision}`); },
    publishActivity: (a) => { calls.push(`world:activity:${a?.activityRevision ?? 'none'}`); },
    clear: () => { calls.push('world:clear'); },
    attach: (c) => { calls.push(`world:attach:${c.descriptor.worldRevision}`); },
    detach: () => { calls.push('world:detach'); },
    activity,
  };
  return { calls, world };
}

describe('ActivityLifecycle – setzt eine World voraus', () => {
  it('laesst sich ohne World-Instanz nicht eroeffnen', () => {
    const lifecycle = new ActivityLifecycle({ attach: () => {}, detach: () => {} }, () => false);
    expect(() => lifecycle.begin(mission())).toThrow(/needs an active world instance/);
    expect(lifecycle.phase).toBe('none');
    expect(lifecycle.descriptor).toBeNull();
    expect(lifecycle.kind).toBeNull();
  });

  it('bleibt fuer eine World ohne Activity vollstaendig leer', () => {
    const { calls, world } = createSinks();
    const lifecycle = new WorldLifecycle(world);
    lifecycle.beginCreate(descriptor(), null);
    lifecycle.attachRuntime(runtime(descriptor()));

    expect(lifecycle.isActive()).toBe(true);
    // Die World laeuft; ihre Activity existiert schlicht nicht.
    expect(lifecycle.activity.phase).toBe('none');
    expect(lifecycle.activity.descriptor).toBeNull();
    expect(lifecycle.activity.is('coop-mission')).toBe(false);
    expect(calls.some((call) => call.startsWith('activity:'))).toBe(false);
  });
});

describe('ActivityLifecycle – Reihenfolge gegenueber der World', () => {
  it('steht erst nach ihrer World und faellt vor ihr', () => {
    const { calls, world } = createSinks();
    const lifecycle = new WorldLifecycle(world);

    lifecycle.beginCreate(descriptor(), mission());
    expect(lifecycle.activity.phase).toBe('creating');
    expect(lifecycle.activity.isActive()).toBe(false);

    lifecycle.attachRuntime(runtime(descriptor()));
    expect(lifecycle.activity.isActive()).toBe(true);
    expect(lifecycle.activity.is('coop-mission')).toBe(true);

    lifecycle.endInstance();
    expect(lifecycle.activity.phase).toBe('none');
    expect(calls).toEqual([
      'world:publish:12',
      'world:attach:12',
      'activity:attach:31',
      'activity:detach',
      'world:detach',
      'world:clear',
    ]);
  });

  it('laesst die Activity-Instanz einen lokalen Teardown ueberleben', () => {
    const { calls, world } = createSinks();
    const lifecycle = new WorldLifecycle(world);
    lifecycle.beginCreate(descriptor(), mission());
    lifecycle.attachRuntime(runtime(descriptor()));

    lifecycle.detachRuntime();
    // Nur die Runtimes fallen; die Activity gehoert weiter zur eroeffneten Instanz.
    expect(lifecycle.activity.phase).toBe('creating');
    expect(lifecycle.activity.descriptor?.activityRevision).toBe(31);

    lifecycle.attachRuntime(runtime(descriptor()));
    expect(lifecycle.activity.isActive()).toBe(true);
    expect(calls.filter((call) => call === 'activity:attach:31')).toHaveLength(2);
  });

  it('behandelt wiederholtes Aktivieren, lokales Detach und Ende idempotent', () => {
    const { calls, world } = createSinks();
    const lifecycle = new WorldLifecycle(world);
    const worldDescriptor = descriptor();
    const activityDescriptor = mission();
    lifecycle.beginCreate(worldDescriptor, activityDescriptor);
    lifecycle.attachRuntime(runtime(worldDescriptor));

    lifecycle.activity.activate();
    lifecycle.activity.activate();
    expect(lifecycle.activity.descriptor).toBe(activityDescriptor);

    lifecycle.activity.detachRuntime();
    lifecycle.activity.detachRuntime();
    expect(lifecycle.activity.phase).toBe('creating');
    expect(lifecycle.activity.descriptor).toBe(activityDescriptor);

    lifecycle.activity.end();
    lifecycle.activity.end();
    expect(lifecycle.activity.phase).toBe('none');
    expect(lifecycle.activity.descriptor).toBeNull();
    expect(calls).toEqual([
      'world:publish:12',
      'world:attach:12',
      'activity:attach:31',
      'activity:detach',
    ]);
  });

  it('vererbt die Mission der Vorgaengerin nicht an eine friedliche World', () => {
    const { world } = createSinks();
    const lifecycle = new WorldLifecycle(world);
    lifecycle.beginCreate(descriptor(), mission());
    lifecycle.attachRuntime(runtime(descriptor()));

    // Neue World-Instanz ohne Activity.
    lifecycle.beginCreate(descriptor({ worldRevision: 13 }), null);
    expect(lifecycle.activity.phase).toBe('none');
    expect(lifecycle.activity.descriptor).toBeNull();

    lifecycle.attachRuntime(runtime(descriptor({ worldRevision: 13 })));
    expect(lifecycle.isActive()).toBe(true);
    expect(lifecycle.activity.phase).toBe('none');
  });

  it('eroeffnet die beobachtete Activity beim Client ohne eigene Erzeugung', () => {
    const { calls, world } = createSinks();
    const lifecycle = new WorldLifecycle(world);
    // Ein Client erzeugt nichts; er bindet World und beobachtete Activity gemeinsam.
    lifecycle.attachRuntime(runtime(descriptor()), mission());
    expect(lifecycle.activity.isActive()).toBe(true);
    expect(lifecycle.activity.kind).toBe('coop-mission');
    expect(calls).toEqual(['world:attach:12', 'activity:attach:31']);
  });

  it('ersetzt Activity A durch B auf Host und Client ohne World-Rebuild', () => {
    const nextMission = { ...mission(), activityRevision: 32 };

    const hostSinks = createSinks();
    const host = new WorldLifecycle(hostSinks.world);
    host.beginCreate(descriptor(), mission());
    host.attachRuntime(runtime(descriptor()));
    host.beginCreate(descriptor(), nextMission);
    expect(host.context).not.toBeNull();
    expect(host.activity.descriptor).toBe(nextMission);
    expect(hostSinks.calls).toEqual([
      'world:publish:12',
      'world:attach:12',
      'activity:attach:31',
      'world:activity:32',
      'activity:detach',
      'activity:attach:32',
    ]);

    const clientSinks = createSinks();
    const client = new WorldLifecycle(clientSinks.world);
    client.attachRuntime(runtime(descriptor()), mission());
    client.syncObservedActivity(nextMission);
    expect(client.context).not.toBeNull();
    expect(client.activity.descriptor).toBe(nextMission);
    expect(clientSinks.calls).toEqual([
      'world:attach:12',
      'activity:attach:31',
      'activity:detach',
      'activity:attach:32',
    ]);
  });
});

describe('Activity-Systeme entstehen aus der Activity, nicht aus einem Modus-Flag', () => {
  it('gattert den Arena-Aufbau ueber genau eine Activity-Entscheidung', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const start = source.indexOf('  buildWorld(');
    const end = source.indexOf('  tearDownArena(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    // Eine Entscheidung, viele Verbraucher. Die Activity kommt als Parameter herein: der Aufbau
    // gehoert der World, die Activity ist ausdruecklich optional.
    expect(body).toContain("const isCoopMission = activityDescriptor?.kind === 'coop-mission';");
    expect([...body.matchAll(/const isCoopMission =/g)]).toHaveLength(1);
    expect([...body.matchAll(/\bisCoopMission\b/g)].length).toBeGreaterThan(10);

    // Und keine verstreute Modus-Abfrage mehr im Aufbau der Runtime.
    expect(
      body.includes('isCoopDefenseMode(descriptor.gameMode)'),
      'buildWorld still gates activity systems on the game mode',
    ).toBe(false);
  });
});
