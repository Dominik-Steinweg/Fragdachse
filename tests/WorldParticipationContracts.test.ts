import { describe, expect, it } from 'vitest';
import {
  canRoundPlayerReceiveRewards,
  getRoundPlayerRole,
} from '../src/scenes/arena/RoundParticipationPolicy';
import type { RoundParticipationState } from '../src/types';
import {
  hasWorldRuntimeEntry,
  maySendWorldInput,
  requiresLocalWorldPresentation,
  encodeWorldParticipationState,
  listWorldParticipants,
  parseWorldParticipationState,
  readWorldParticipation,
  resolveWorldParticipation,
  type WorldParticipation,
  type WorldParticipationInput,
} from '../src/world/WorldParticipation';
import { resolveWorldPresentation } from '../src/world/WorldPresentation';
import { consumesWorldReplication } from '../src/world/WorldReplication';

/**
 * World Participation als eigener Lebenszyklus.
 *
 * Sie beantwortet teilnahmebezogene Fragen – Runtime-Eintrag, Input und Presentation – und
 * ersetzt die Rundenrolle nicht. Beides zusammenzulegen wuerde eine World ohne Runde unmoeglich
 * machen.
 */

const ALL: readonly WorldParticipation[] = ['none', 'joining', 'interactive', 'observer', 'leaving'];

function input(overrides: Partial<WorldParticipationInput> = {}): WorldParticipationInput {
  return {
    worldActive: true,
    admitted: true,
    hasRuntimeEntry: true,
    mayAct: true,
    ...overrides,
  };
}

function participation(overrides: Partial<RoundParticipationState> = {}): RoundParticipationState {
  return {
    roundStartTime: 0,
    roundRevision: 42,
    participantIds: ['p0', 'p1'],
    spectatorIds: [],
    ...overrides,
  };
}

describe('WorldParticipation – Ableitung', () => {
  it('kennt ohne laufende World keine Teilnahme', () => {
    expect(resolveWorldParticipation(input({ worldActive: false }))).toBe('none');
    // Die Lobby ist kein Participation-State; wer in ihr steht, nimmt an keiner World teil.
    expect(resolveWorldParticipation(input({ worldActive: false, hasRuntimeEntry: false }))).toBe('none');
  });

  it('trennt zugelassen, ladend, handelnd und zusehend', () => {
    expect(resolveWorldParticipation(input({ admitted: false }))).toBe('none');
    expect(resolveWorldParticipation(input({ hasRuntimeEntry: false }))).toBe('joining');
    expect(resolveWorldParticipation(input())).toBe('interactive');
    expect(resolveWorldParticipation(input({ mayAct: false }))).toBe('observer');
    expect(resolveWorldParticipation(input({ leaving: true }))).toBe('leaving');
  });

  it('stellt das Verlassen ueber den Handlungszustand', () => {
    // Wer die World verlaesst, ist weder interaktiv noch blosser Beobachter.
    expect(resolveWorldParticipation(input({ leaving: true, mayAct: false }))).toBe('leaving');
    expect(resolveWorldParticipation(input({ leaving: true, hasRuntimeEntry: false }))).toBe('leaving');
    // Ohne World bleibt es aber `none` – es gibt nichts zu verlassen.
    expect(resolveWorldParticipation(input({ leaving: true, worldActive: false }))).toBe('none');
  });
});

describe('WorldParticipation – beantwortet die teilnahmebezogenen Fragen', () => {
  it('unterscheidet Runtime-Eintrag, Input und Presentation', () => {
    const runtimeEntry = ALL.filter(hasWorldRuntimeEntry);
    expect(runtimeEntry).toEqual(['interactive', 'observer', 'leaving']);

    // Nur eine vollwertige Teilnahme handelt.
    expect(ALL.filter(maySendWorldInput)).toEqual(['interactive']);

    expect(ALL.filter(requiresLocalWorldPresentation)).toEqual(['joining', 'interactive', 'observer', 'leaving']);
  });

  it('laesst einen Beobachter in der World stehen, ohne ihn handeln zu lassen', () => {
    const observer = resolveWorldParticipation(input({ mayAct: false }));
    expect(hasWorldRuntimeEntry(observer)).toBe(true);
    expect(maySendWorldInput(observer)).toBe(false);
    expect(requiresLocalWorldPresentation(observer)).toBe(true);
  });
});

describe('WorldReplication – Participation und Presentation bleiben getrennt', () => {
  const replicationFor = (participation: WorldParticipation, previewWithoutParticipation = false) => (
    consumesWorldReplication({
      worldActive: true,
      participation,
      presentation: resolveWorldPresentation({
        participation,
        worldActive: true,
        previewWithoutParticipation,
      }),
    })
  );

  it('konsumiert fuer Teilnehmer und fuer eine sichtbare Preview', () => {
    expect(ALL.filter((value) => replicationFor(value))).toEqual([
      'joining', 'interactive', 'observer', 'leaving',
    ]);
    expect(replicationFor('none', true)).toBe(true);
    expect(replicationFor('none', false)).toBe(false);
  });

  it('konsumiert ohne laufende World auch bei Preview-Erlaubnis nichts', () => {
    expect(consumesWorldReplication({
      worldActive: false,
      participation: 'interactive',
      presentation: resolveWorldPresentation({
        participation: 'interactive',
        worldActive: false,
        previewWithoutParticipation: true,
      }),
    })).toBe(false);
  });
});

describe('WorldParticipation – Rundenrolle bleibt getrennt', () => {
  it('beschreibt einen Missions-Spectator in beiden Achsen unabhaengig', () => {
    const state = participation({ spectatorIds: ['p1'] });
    // Rundenachse: der Spieler ist Spectator und bekommt keine Belohnungen.
    expect(getRoundPlayerRole(state, 'p1')).toBe('spectator');
    expect(canRoundPlayerReceiveRewards(state, 'p1')).toBe(false);
    // Weltachse: er steht weiterhin in der World und sieht zu.
    expect(resolveWorldParticipation(input({ mayAct: false }))).toBe('observer');

    // Und ein regulaerer Teilnehmer ist in beiden Achsen vollwertig.
    expect(getRoundPlayerRole(state, 'p0')).toBe('participant');
    expect(resolveWorldParticipation(input())).toBe('interactive');
  });

});

describe('WorldParticipation – kanonisch repliziert', () => {
  it('bindet den Stand an die World-Instanz, aus der er stammt', () => {
    const state = { r: 7, p: { a: 'interactive', b: 'observer' } };
    expect(parseWorldParticipationState(state, 7)?.participants).toEqual({
      a: 'interactive',
      b: 'observer',
    });
    // Ein verspaetetes Paket der Vorinstanz beschreibt diese World nicht.
    expect(parseWorldParticipationState(state, 8)).toBeNull();
    expect(parseWorldParticipationState(null, 7)).toBeNull();

    const parsed = parseWorldParticipationState(state, 7);
    expect(readWorldParticipation(parsed, 'a')).toBe('interactive');
    // Wer nicht eingetragen ist, nimmt nicht teil.
    expect(readWorldParticipation(parsed, 'ghost')).toBe('none');
    expect(readWorldParticipation(null, 'a')).toBe('none');
    expect(listWorldParticipants(parsed)).toEqual(['a', 'b']);

    // Der Round-Trip ueber den Draht ist verlustfrei.
    expect(parseWorldParticipationState(
      encodeWorldParticipationState({ worldRevision: 7, participants: { a: 'interactive' } }),
      7,
    )?.participants).toEqual({ a: 'interactive' });
  });
});
