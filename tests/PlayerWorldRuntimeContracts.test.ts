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
    missionStatus: true,
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
  it('leitet die Module aus Rolle und Activity ab', () => {
    const hostMission = resolvePlayerRuntimeFeatures({
      activityKind: 'coop-mission',
      isHost: true,
      participation: 'interactive',
    });
    expect(hostMission).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: true,
      combat: true,
      combatResources: true,
      loadoutTools: true,
      missionStatus: true,
    });

    // Eine World ohne Activity fuehrt keinen missionsgebundenen Spielerzustand – der gemeinsame
    // Lifecycle initialisiert eben nicht automatisch den vollen Mission-Stack.
    const hostPeacefulWorld = resolvePlayerRuntimeFeatures({
      activityKind: null,
      isHost: true,
      participation: 'interactive',
    });
    expect(hostPeacefulWorld.missionStatus).toBe(false);
    expect(hostPeacefulWorld.entity).toBe(true);
    expect(hostPeacefulWorld.combat).toBe(true);

    // PvP hat eine Activity, aber keine Mission.
    expect(resolvePlayerRuntimeFeatures({
      activityKind: 'deathmatch',
      isHost: true,
      participation: 'interactive',
    }).missionStatus).toBe(false);

    // Ein Beobachter steht in der World, simuliert darin aber nicht.
    const observer = resolvePlayerRuntimeFeatures({
      activityKind: 'coop-mission',
      isHost: true,
      participation: 'observer',
    });
    expect(observer.entity).toBe(true);
    expect(observer.worldTargeting).toBe(true);
    expect(observer.combat).toBe(false);
    expect(observer.missionStatus).toBe(false);

    // Ein Client fuehrt keine autoritative Simulation, aber seine Spielfigur.
    const client = resolvePlayerRuntimeFeatures({
      activityKind: 'coop-mission',
      isHost: false,
      participation: 'interactive',
    });
    expect(client).toEqual({
      entity: true,
      worldTargeting: true,
      navigation: false,
      combat: false,
      combatResources: false,
      loadoutTools: false,
      missionStatus: false,
    });
  });

  it('laesst nur die Module laufen, deren Feature aktiv ist', () => {
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [
        step('entity', 'entity', calls),
        step('combat', 'combat', calls),
        step('mission', 'missionStatus', calls),
      ],
      detach: [
        detachStep('mission', 'missionStatus', calls),
        detachStep('combat', 'combat', calls),
        detachStep('entity', 'entity', calls),
      ],
    });

    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: false }, features({ missionStatus: false })))
      .toBe(true);
    expect(calls).toEqual(['attach:entity', 'attach:combat']);

    calls.length = 0;
    runtime.detach('p1', features({ missionStatus: false }));
    expect(calls).toEqual(['detach:combat', 'detach:entity']);
  });

  it('entfernt auch einen Spieler, den diese Runtime nie angehaengt hat', () => {
    // Der Client haengt Spieler nicht selbst an, muss seinen Anteil aber loesen koennen.
    const calls: string[] = [];
    const runtime = new PlayerWorldRuntime({
      attach: [],
      detach: [detachStep('entity', 'entity', calls), detachStep('combat', 'combat', calls)],
    });
    runtime.detach('p1', features({ combat: false }));
    expect(calls).toEqual(['detach:entity']);
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

    runtime.detach('p1', features());
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
    expect(spawnBody).toContain('this.playerRuntime.attach(');
    expect(spawnBody).toContain('this.resolvePlayerFeatures(this.getWorldParticipation(profile.id))');

    const removeStart = source.indexOf('  removePlayerFromActiveRound(playerId: string): void {');
    const removeBody = source.slice(removeStart, source.indexOf('\n  }', removeStart));
    expect(removeBody).toContain('this.playerRuntime.detach(');

    // Der Abbau steht nur noch an einer Stelle; Spawn und Respawn teilen sich dieselbe Liste.
    for (const call of [
      'this.ctx.combatSystem.removePlayer(',
      'this.ctx.loadoutManager?.removePlayer(',
      'this.ctx.burrowSystem?.removePlayer(',
    ]) {
      expect([...source.matchAll(new RegExp(call.replace(/[.?()]/g, '\\$&'), 'g'))], call)
        .toHaveLength(1);
    }

    // Der Kontext kommt aus der Activity, nicht aus einer Modusabfrage.
    expect(source).toContain('activityKind: this.worldLifecycle.activity.kind');
  });

  it('haelt den verbliebenen zweiten Attach-Pfad sichtbar', () => {
    // `onTransitionToArena()` legt die Spielfiguren der Startbesetzung noch selbst an. Auf Clients
    // ist das der einzige Weg; auf dem Host weicht er in zwei Punkten vom gemeinsamen Lifecycle
    // ab: kein Ally-Flowfield und kein Ultimate-Reset. Beides anzugleichen aendert Gegner-
    // Navigation und Ultimate-Zustand und gehoert deshalb nicht in diesen Schritt.
    const source = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const start = source.indexOf('  private onTransitionToArena(): void {');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n  private ', start + 10));
    expect(body).toContain('this.ctx.playerManager.addPlayer(profile);');
    expect(body.includes('this.ensureAllyFlowField('), 'second path gained navigation').toBe(false);
    expect(body.includes('resetUltimateState('), 'second path gained the ultimate reset').toBe(false);
  });
});
