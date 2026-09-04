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
import { composePlayerWorldRuntime } from '../src/world/PlayerWorldRuntimeComposition';

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
    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: false, nowMs: 0 }, observer)).toBe(true);
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
    runtime.attach({ profile: PROFILE, reconnectAfterDeath: false, nowMs: 0 }, features);
    runtime.attach({ profile: { ...PROFILE, id: 'p2' }, reconnectAfterDeath: false, nowMs: 0 }, features);
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

    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: false, nowMs: 0 }, features({ loadoutTools: false })))
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

    expect(runtime.attach({ profile: PROFILE, reconnectAfterDeath: true, nowMs: 0 }, features())).toBe(false);
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

    expect(() => runtime.attach({ profile: PROFILE, reconnectAfterDeath: false, nowMs: 0 }, features()))
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
    const context = { profile: PROFILE, reconnectAfterDeath: false, nowMs: 0 };
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
describe('Player-Lifecycle – konkrete World-Komposition', () => {
  it('haelt die feste Attach- und Detach-Reihenfolge ausserhalb des Coordinators', () => {
    const calls: string[] = [];
    const buildAttachTimes: number[] = [];
    const runtime = composePlayerWorldRuntime({
      attachEntity: () => { calls.push('attach:entity'); },
      detachEntity: () => { calls.push('detach:entity'); },
      attachCombat: () => { calls.push('attach:combat'); return true; },
      detachCombat: () => { calls.push('detach:combat'); },
      attachCombatResources: () => { calls.push('attach:resources'); },
      detachCombatResources: () => { calls.push('detach:resources'); },
      attachPlayerBuild: (_playerId, nowMs) => { calls.push('attach:build'); buildAttachTimes.push(nowMs); },
      detachPlayerBuild: () => { calls.push('detach:build'); },
      attachBurrow: () => { calls.push('attach:burrow'); },
      detachBurrow: () => { calls.push('detach:burrow'); },
      attachLoadout: () => { calls.push('attach:loadout'); },
      detachLoadout: () => { calls.push('detach:loadout'); },
      detachWorldTargeting: () => { calls.push('detach:targeting'); },
    });

    expect(runtime.attach(
      { profile: PROFILE, reconnectAfterDeath: false, nowMs: 1_234 },
      features(),
    )).toBe(true);
    expect(buildAttachTimes).toEqual([1_234]);
    expect(calls).toEqual([
      'attach:entity',
      'attach:combat',
      'attach:resources',
      'attach:build',
      'attach:burrow',
      'attach:loadout',
    ]);

    calls.length = 0;
    runtime.detach(PROFILE.id);
    expect(calls).toEqual([
      'detach:targeting',
      'detach:combat',
      'detach:resources',
      'detach:build',
      'detach:burrow',
      'detach:loadout',
      'detach:entity',
    ]);
  });
});
