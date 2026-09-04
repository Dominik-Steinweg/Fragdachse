import { describe, expect, it } from 'vitest';
import type { ActivityKind } from '../src/config/authoring/ActivityDefinition';
import {
  resolvePlayerCapabilities,
  type PlayerCapabilities,
} from '../src/world/PlayerCapabilities';
import type { WorldParticipation } from '../src/world/WorldParticipation';

/**
 * Capability Policy.
 *
 * `canPlayerAct()` beantwortet nur "darf er ueberhaupt". Diese Tests halten die spezifische
 * Aufloesung fest: eine Editor-World erlaubt Bauen ohne Kampf, ein Beobachter fuehrt die Kamera
 * ohne alles andere – und dieselbe reine Regel gilt auf Host und Client.
 */

const ALL_PARTICIPATIONS: readonly WorldParticipation[] =
  ['none', 'joining', 'interactive', 'observer', 'leaving'];

function capabilities(participation: WorldParticipation, activityKind: ActivityKind | null): PlayerCapabilities {
  return resolvePlayerCapabilities({
    participation,
    activityKind,
    worldCombatAllowed: activityKind !== null,
  });
}

function granted(value: PlayerCapabilities): string[] {
  return Object.entries(value).filter(([, allowed]) => allowed).map(([name]) => name).sort();
}

describe('Capability Policy – aus dem Runtime-State aufgeloest', () => {
  it('gibt einem Missionsteilnehmer die vollen Handlungsrechte', () => {
    expect(granted(capabilities('interactive', 'coop-mission'))).toEqual([
      'canControlCamera', 'canDismantle', 'canInteract', 'canMove', 'canPlace',
      'canUseCombat', 'canUseMissionActions',
    ]);
  });

  it('erlaubt in einer World ohne Activity Bauen, aber keinen Kampf', () => {
    const editor = capabilities('interactive', null);
    expect(granted(editor)).toEqual([
      'canControlCamera', 'canDismantle', 'canInteract', 'canMove', 'canPlace',
    ]);
    expect(editor.canUseCombat).toBe(false);
    expect(editor.canUseMissionActions).toBe(false);
  });

  it('kann Kampf in einer World ohne Activity explizit erlauben', () => {
    expect(resolvePlayerCapabilities({
      participation: 'interactive',
      activityKind: null,
      worldCombatAllowed: true,
    }).canUseCombat).toBe(true);
  });

  it('kennt in PvP Kampf, aber keine Missionsaktionen', () => {
    for (const kind of ['deathmatch', 'team-deathmatch', 'capture-the-beer'] as const) {
      const pvp = capabilities('interactive', kind);
      expect(pvp.canUseCombat, kind).toBe(true);
      expect(pvp.canUseMissionActions, kind).toBe(false);
      expect(pvp.canMove, kind).toBe(true);
    }
  });

  it('laesst einen Beobachter nur die Kamera fuehren', () => {
    const observer = capabilities('observer', 'coop-mission');
    expect(granted(observer)).toEqual(['canControlCamera']);
    // Wer die World gerade verlaesst oder noch laedt, handelt ebenso wenig.
    expect(granted(capabilities('leaving', 'coop-mission'))).toEqual(['canControlCamera']);
    expect(granted(capabilities('joining', 'coop-mission'))).toEqual(['canControlCamera']);
  });

  it('gibt ohne Teilnahme gar nichts frei', () => {
    expect(granted(capabilities('none', 'coop-mission'))).toEqual([]);
    expect(granted(capabilities('none', null))).toEqual([]);
  });

  it('leitet jede Freigabe allein aus Teilnahme und Activity ab', () => {
    // Reine Regel: gleiche Eingabe, gleiches Ergebnis – Voraussetzung dafuer, dass Host und
    // Client sie unabhaengig voneinander auswerten koennen.
    for (const participation of ALL_PARTICIPATIONS) {
      for (const kind of ['coop-mission', 'deathmatch', null] as const) {
        expect(capabilities(participation, kind)).toEqual(capabilities(participation, kind));
      }
    }
    // Handeln setzt eine vollwertige Teilnahme voraus.
    for (const participation of ALL_PARTICIPATIONS) {
      if (participation === 'interactive') continue;
      expect(capabilities(participation, 'coop-mission').canMove, participation).toBe(false);
    }
  });
});
