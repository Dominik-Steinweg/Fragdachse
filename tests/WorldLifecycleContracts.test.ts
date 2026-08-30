import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';

/**
 * Zentralisierter World-Lifecycle.
 *
 * Vorher war "es gibt eine World" aus drei Quellen zu rekonstruieren – dem replizierten Kanal,
 * dem lokalen `ArenaContext.world` und dem Aufbaustand der Arena – und wurde an sechs Stellen
 * gewechselt. Diese Tests halten fest, dass es genau einen Besitzer mit explizitem Zustand gibt.
 */

interface RecordedSink extends WorldLifecycleSink {
  readonly calls: string[];
  attached: WorldRuntimeContext | null;
}

function createSink(): RecordedSink {
  const calls: string[] = [];
  const sink: RecordedSink = {
    calls,
    attached: null,
    publish: (world) => { calls.push(`publish:${world.worldRevision}`); },
    clear: () => { calls.push('clear'); },
    attach: (context) => { calls.push(`attach:${context.descriptor.worldRevision}`); sink.attached = context; },
    detach: () => { calls.push('detach'); sink.attached = null; },
  };
  return sink;
}

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

function activity(worldRevision = 12): ActivityDescriptor {
  return {
    activityRevision: 31,
    worldRevision,
    kind: 'coop-mission',
    definitionId: 'activity:coop-mission:7',
  };
}

/** Nur die Identitaet zaehlt fuer den Lifecycle; der Rest der Runtime ist hier irrelevant. */
function runtime(world: WorldDescriptor): WorldRuntimeContext {
  return { descriptor: world } as WorldRuntimeContext;
}

describe('WorldLifecycle – expliziter Zustand', () => {
  it('durchlaeuft Erzeugung, Runtime und Ende in einer Folge', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    expect(lifecycle.phase).toBe('none');
    expect(lifecycle.context).toBeNull();
    expect(lifecycle.descriptor).toBeNull();
    expect(lifecycle.isActive()).toBe(false);

    lifecycle.beginCreate(descriptor(), activity());
    expect(lifecycle.phase).toBe('creating');
    // Die Instanz existiert bereits, ihre lokale Runtime noch nicht.
    expect(lifecycle.descriptor?.worldRevision).toBe(12);
    expect(lifecycle.context).toBeNull();
    expect(lifecycle.isActive()).toBe(false);

    lifecycle.attachRuntime(runtime(descriptor()));
    expect(lifecycle.phase).toBe('active');
    expect(lifecycle.isActive()).toBe(true);
    expect(sink.attached?.descriptor.worldRevision).toBe(12);

    lifecycle.endInstance();
    expect(lifecycle.phase).toBe('none');
    expect(lifecycle.context).toBeNull();
    expect(lifecycle.descriptor).toBeNull();
    expect(sink.calls).toEqual(['publish:12', 'attach:12', 'detach', 'clear']);
  });

  it('laesst einen Client ohne eigene Erzeugung an die beobachtete Instanz andocken', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.attachRuntime(runtime(descriptor({ worldRevision: 13 })));
    expect(lifecycle.phase).toBe('active');
    expect(sink.calls).toEqual(['attach:13']);
  });

  it('weist eine Runtime ab, die nicht zur eroeffneten Instanz gehoert', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.beginCreate(descriptor(), activity());

    expect(() => lifecycle.attachRuntime(runtime(descriptor({ worldRevision: 13 }))))
      .toThrow(/does not match the created instance/);
    expect(() => lifecycle.attachRuntime(runtime(descriptor({ layoutFingerprint: 'other' }))))
      .toThrow(/does not match the created instance/);
    // Die eroeffnete Instanz bleibt unangetastet.
    expect(lifecycle.phase).toBe('creating');
    expect(sink.attached).toBeNull();
  });
});

describe('WorldLifecycle – Teardown und Instanzende sind verschieden', () => {
  it('behaelt die replizierte Instanz, wenn nur die lokale Runtime faellt', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.beginCreate(descriptor(), activity());
    // Der Aufbau raeumt defensiv zuerst auf; das darf die gerade eroeffnete Instanz nicht beenden.
    lifecycle.detachRuntime();
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.descriptor?.worldRevision).toBe(12);
    expect(sink.calls).toEqual(['publish:12']);

    lifecycle.attachRuntime(runtime(descriptor()));
    lifecycle.detachRuntime();
    // Auch nach einem vollstaendigen lokalen Teardown existiert die Instanz weiter: es gibt eine
    // World, nur keine Runtime dafuer. Der Kanal bleibt unberuehrt.
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.descriptor?.worldRevision).toBe(12);
    expect(lifecycle.context).toBeNull();
    expect(sink.calls).toEqual(['publish:12', 'attach:12', 'detach']);

    // Und die Activity dieser Instanz bleibt ihr zugeordnet, statt verwaist stehenzubleiben.
    lifecycle.endInstance();
    expect(lifecycle.phase).toBe('none');
    expect(lifecycle.descriptor).toBeNull();
  });

  it('behandelt lokales Runtime-Detach idempotent und erlaubt Reattach derselben World', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    const worldDescriptor = descriptor();
    const activityDescriptor = activity();
    lifecycle.beginCreate(worldDescriptor, activityDescriptor);
    lifecycle.attachRuntime(runtime(worldDescriptor));

    lifecycle.detachRuntime();
    lifecycle.detachRuntime();
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.context).toBeNull();
    expect(lifecycle.descriptor).toBe(worldDescriptor);
    expect(lifecycle.activity.descriptor).toBe(activityDescriptor);

    lifecycle.attachRuntime(runtime(worldDescriptor));
    expect(lifecycle.phase).toBe('active');
    expect(lifecycle.descriptor).toBe(worldDescriptor);
    expect(lifecycle.activity.descriptor).toBe(activityDescriptor);

    lifecycle.detachRuntime();
    expect(sink.calls).toEqual(['publish:12', 'attach:12', 'detach', 'attach:12', 'detach']);
  });

  it('beendet die Instanz idempotent und ohne beobachtbaren Reststand', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.beginCreate(descriptor(), activity());
    lifecycle.attachRuntime(runtime(descriptor()));

    lifecycle.endInstance();
    lifecycle.endInstance();
    expect(lifecycle.phase).toBe('none');
    expect(lifecycle.context).toBeNull();
    // Zweimaliges Beenden ist vollstaendig idempotent: weder Runtime noch Kanal werden doppelt
    // abgebaut.
    expect(sink.calls).toEqual(['publish:12', 'attach:12', 'detach', 'clear']);
  });

  it('ersetzt eine laufende Instanz, statt zwei gleichzeitig zu fuehren', () => {
    const sink = createSink();
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.beginCreate(descriptor(), activity());
    lifecycle.attachRuntime(runtime(descriptor()));

    lifecycle.beginCreate(descriptor({ worldRevision: 13 }), activity(13));
    expect(lifecycle.phase).toBe('creating');
    expect(lifecycle.context).toBeNull();
    expect(lifecycle.descriptor?.worldRevision).toBe(13);
    expect(sink.calls).toEqual(['publish:12', 'attach:12', 'detach', 'publish:13']);
  });
});

describe('WorldLifecycle – genau ein Besitzer im Koordinator', () => {
  it('wechselt den World-Zustand nirgends am Lifecycle vorbei', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    // Erzeugung, Ende und die lokale Bindung laufen ausschliesslich ueber den Besitzer.
    expect(source).toContain('this.worldLifecycle.beginCreate(');
    expect(source).toContain('this.worldLifecycle.attachRuntime(');
    expect(source).toContain('this.worldLifecycle.detachRuntime()');
    expect(source).toContain('this.worldLifecycle.endInstance()');

    // Der Kanal wird ausschliesslich aus dem Sink des Lifecycles bedient – genau einmal je Richtung.
    expect([...source.matchAll(/bridge\.publishWorldAndActivity\(/g)], 'publish past the lifecycle')
      .toHaveLength(1);
    expect([...source.matchAll(/bridge\.clearWorldAndActivity\(/g)], 'clear past the lifecycle')
      .toHaveLength(1);
    expect(source).toContain('publish: (world, activity) => bridge.publishWorldAndActivity(world, activity)');
    expect(source).toContain('clear: () => bridge.clearWorldAndActivity()');

    // `ctx.world` wird nur vom Sink des Lifecycles geschrieben – genau die beiden Zuweisungen dort.
    expect([...source.matchAll(/this\.ctx\.world\s*=/g)], 'ctx.world assigned past the lifecycle')
      .toHaveLength(2);
    // Der Sink besitzt die lokale Runtime; `ctx.world` ist daneben nur noch der
    // Compatibility-Pfad fuer die noch nicht migrierten Consumer.
    expect(source).toContain('this.worldRuntime = new WorldRuntime(context);');
    expect(source).toContain('      this.ctx.world = context;');
    expect(source).toContain('      this.ctx.world = null;');
  });
});
