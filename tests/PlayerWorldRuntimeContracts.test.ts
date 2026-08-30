import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../src/types';
import {
  PlayerWorldRuntime,
  resolvePlayerRuntimeFeatures,
  type PlayerAttachStep,
  type PlayerDetachStep,
  type PlayerRuntimeFeature,
  type PlayerRuntimeFeatures,
} from '../src/world/PlayerWorldRuntime';

/**
 * Gemeinsamer, kontextgesteuerter Player-Lifecycle.
 *
 * Es gibt genau einen Weg hinein und einen hinaus. Welche Module laufen, entscheidet ein
 * expliziter Kontext aus Rolle und Activity – nicht mehr "welches System ist gerade nicht null".
 * Und ein Spieler bleibt nie halb initialisiert zurueck.
 */

const PROFILE = { id: 'p1', name: 'Dachs', colorHex: '#fff' } as unknown as PlayerProfile;

function features(overrides: Partial<PlayerRuntimeFeatures> = {}): PlayerRuntimeFeatures {
  return {
    entity: true,
    worldTargeting: true,
    navigation: true,
    combat: true,
    combatResources: true,
    loadoutTools: true,
    playerBuild: true,
    ...overrides,
  };
}

function step(
  id: string,
  feature: PlayerRuntimeFeature,
  calls: string[],
  behaviour: { readonly refuse?: boolean; readonly throws?: boolean } = {},
): PlayerAttachStep {
  return {
    id,
    feature,
    run: () => {
      calls.push(`attach:${id}`);
      if (behaviour.throws) throw new Error(`boom:${id}`);
      return behaviour.refuse ? false : true;
    },
    rollback: () => { calls.push(`rollback:${id}`); },
  };
}

function detachStep(id: string, feature: PlayerRuntimeFeature, calls: string[]): PlayerDetachStep {
  return { id, feature, run: () => { calls.push(`detach:${id}`); } };
}

describe('Player-Lifecycle – kontextgesteuerte Module', () => {
  it('leitet ausschliesslich world-scoped Module aus Rolle und Teilnahme ab', () => {
    const host = resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' });
    expect(host).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: true,
      combat: true,
      combatResources: true,
      loadoutTools: true,
      playerBuild: true,
    });

    // Missionsgebundener Spielerzustand ist hier kein Feature mehr: Er wuerde einen
    // Activity-Wechsel in derselben World nicht ueberleben und gehoert deshalb der Activity.
    expect(Object.keys(host)).not.toContain('missionStatus');

    // Ein Beobachter steht in der World, simuliert darin aber nicht.
    const observer = resolvePlayerRuntimeFeatures({ isHost: true, participation: 'observer' });
    expect(observer.entity).toBe(true);
    expect(observer.worldTargeting).toBe(true);
    expect(observer.combat).toBe(false);

    // Ein Client fuehrt keine autoritative Simulation, aber seine Spielfigur.
    expect(resolvePlayerRuntimeFeatures({ isHost: false, participation: 'interactive' })).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: false,
      combat: false,
      combatResources: false,
      loadoutTools: false,
      playerBuild: false,
    });
  });

  it('baut beim Detach genau die Module ab, die der Attach materialisiert hat', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [step('entity', 'entity', calls), step('combat', 'combat', calls)],
      detach: [
        detachStep('combat', 'combat', calls),
        detachStep('targeting', 'worldTargeting', calls),
        detachStep('entity', 'entity', calls),
      ],
    });

    // Ein Beobachter bekommt keinen Kampfzustand ...
    const observer = resolvePlayerRuntimeFeatures({ isHost: true, participation: 'observer' });
    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: false }, observer)).toBe(true);
    expect(calls).toEqual(['attach:entity']);

    // ... und baut auch dann keinen ab, wenn die Policy ihn inzwischen als Teilnehmer sehen
    // wuerde. Der Detach liest das Ledger, nicht die Policy von jetzt.
    calls.length = 0;
    runtime.detach('p1');
    expect(calls).toEqual(['detach:targeting', 'detach:entity']);
    expect(runtime.isAttached('p1')).toBe(false);
  });

  it('loest ueber detachAll jeden getragenen Spieler genau einmal', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [step('entity', 'entity', calls)],
      detach: [detachStep('entity', 'entity', calls)],
    });
    const features = resolvePlayerRuntimeFeatures({ isHost: true, participation: 'interactive' });
    runtime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features);
    runtime.attach({ profile: { ...PROFILE, id: 'p2' }, reconnectAfterDeath: false }, features);
    expect(runtime.attachedPlayerIds()).toEqual(['p1', 'p2']);

    calls.length = 0;
    runtime.detachAll();
    runtime.detachAll();
    expect(calls).toEqual(['detach:entity', 'detach:entity']);
    expect(runtime.attachedPlayerIds()).toEqual([]);
  });

  it('laesst nur die Module laufen, deren Feature aktiv ist', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [
        step('entity', 'entity', calls),
        step('combat', 'combat', calls),
        step('loadout', 'loadoutTools', calls),
      ],
      detach: [
        detachStep('loadout', 'loadoutTools', calls),
        detachStep('combat', 'combat', calls),
        detachStep('entity', 'entity', calls),
      ],
    });

    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features({ loadoutTools: false })))
      .toBe(true);
    expect(calls).toEqual(['attach:entity', 'attach:combat']);

    calls.length = 0;
    runtime.detach('p1');
    expect(calls).toEqual(['detach:combat', 'detach:entity']);
  });

  it('macht ein wiederholtes oder nie begonnenes Leave zum No-op', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [],
      detach: [detachStep('entity', 'entity', calls), detachStep('combat', 'combat', calls)],
    });
    runtime.detach('p1');
    expect(calls).toEqual([]);
  });
});

describe('Player-Lifecycle – atomarer Attach', () => {
  it('nimmt bereits angehaengte Module zurueck, wenn eines ablehnt', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [
        step('entity', 'entity', calls),
        step('combat', 'combat', calls, { refuse: true }),
        step('loadout', 'loadoutTools', calls),
      ],
      detach: [],
    });

    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: true }, features())).toBe(false);
    // Rueckwaerts und ohne das ablehnende Modul selbst; der spaetere Schritt lief nie.
    expect(calls).toEqual(['attach:entity', 'attach:combat', 'rollback:entity']);
    expect(runtime.isAttached('p1')).toBe(false);
  });

  it('nimmt ebenso zurueck, wenn ein Modul wirft, und reicht den Fehler weiter', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [
        step('entity', 'entity', calls),
        step('resources', 'combatResources', calls),
        step('loadout', 'loadoutTools', calls, { throws: true }),
      ],
      detach: [],
    });

    expect(() => runtime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features()))
      .toThrow(/boom:loadout/);
    expect(calls).toEqual([
      'attach:entity', 'attach:resources', 'attach:loadout',
      'rollback:resources', 'rollback:entity',
    ]);
    expect(runtime.isAttached('p1')).toBe(false);
  });

  it('haengt einen bereits angehaengten Spieler nicht doppelt an', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [step('entity', 'entity', calls)],
      detach: [detachStep('entity', 'entity', calls)],
    });
    const context = { profile: PROFILE, reconnectAfterDeath: false };
    expect(runtime.attach(context, features())).toBe(true);
    expect(runtime.attach(context, features())).toBe(true);
    expect(calls).toEqual(['attach:entity']);

    runtime.detach('p1');
    runtime.detach('p1');
    expect(runtime.isAttached('p1')).toBe(false);
    expect(runtime.attach(context, features())).toBe(true);
    expect(calls).toEqual(['attach:entity', 'detach:entity', 'attach:entity']);
  });
});

describe('Player-Lifecycle – genau ein Weg hinein und hinaus', () => {
  it('fuehrt Spawn und Entfernen ausschliesslich ueber die gemeinsame Runtime', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const spawnStart = source.indexOf('  spawnReadyPlayers(): void {');
    const spawnBody = source.slice(spawnStart, source.indexOf('\n  }', spawnStart));
    expect(spawnBody).toContain('this.attachPlayerToWorld(profile, reconnectAfterDeath)');

    const removeStart = source.indexOf('  removePlayerFromActiveRound(playerId: string): void {');
    const removeBody = source.slice(removeStart, source.indexOf('\n  }', removeStart));
    expect(removeBody).toContain('this.detachPlayerFromWorld(playerId)');

    // Der Abbau steht nur noch an einer Stelle; Spawn und Respawn teilen sich dieselbe Liste.
    for (const call of [
      'this.ctx.combatSystem.removePlayer(',
      'this.ctx.loadoutManager?.removePlayer(',
      'this.ctx.burrowSystem?.removePlayer(',
    ]) {
      expect([...source.matchAll(new RegExp(call.replace(/[.?()]/g, '\\$&'), 'g'))], call)
        .toHaveLength(1);
    }

    // Der world-scoped Kontext kennt die Activity nicht mehr: Ihr Spieleranteil gehoert der
    // Activity-Runtime und faellt mit ihr.
    const featureStart = source.indexOf('  private resolvePlayerFeatures(');
    const featureBody = source.slice(featureStart, source.indexOf('\n  }', featureStart));
    expect(featureStart).toBeGreaterThan(0);
    expect(featureBody).not.toContain('activityKind');
    expect(source).toContain('this.playerActivityRuntime?.attach(profile.id, reconnectAfterDeath)');
  });

  it('fuehrt auch Startbesetzung und Client-Roster ueber denselben Lifecycle', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const start = source.indexOf('  private onTransitionToArena(): void {');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n  private ', start + 10));
    expect(body).toContain('this.attachPlayerToWorld(profile);');
    expect(body).not.toContain('this.ctx.playerManager.addPlayer(profile);');

    const client = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ClientUpdateCoordinator.ts'),
      'utf8',
    );
    expect(client).not.toContain('this.ctx.playerManager.addPlayer(');
    expect(client).not.toContain('this.ctx.playerManager.removePlayer(');
    // Der Client reicht die replizierte Position mit: er darf keinen eigenen Spawn wuerfeln.
    expect(client).toContain('this.attachPlayerToWorld?.(profile, { x: ps.x, y: ps.y })');
    expect(client).toContain('this.detachPlayerFromWorld?.(player.id)');
  });
});
