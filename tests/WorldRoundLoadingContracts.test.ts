import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getActiveRoundParticipantIds,
  getRoundResultEligibleIds,
} from '../src/scenes/arena/RoundParticipationPolicy';
import type { RoundParticipationState } from '../src/types';
import { resolveWorldLoadProgress } from '../src/world/WorldLoadReady';

/**
 * World Loading und Round Loading sind getrennte Bedingungen.
 *
 * Die replizierte Ladebarriere beantwortet ausschliesslich, ob die lokale World steht. Ob eine
 * Runde starten darf, ist eine zusaetzliche, host-lokale Frage. Steckten beide in einem Flag,
 * koennte eine World ohne Activity nie "fertig geladen" melden – und ein Client koennte nicht
 * unterscheiden, ob der Host noch laedt oder auf die Runde wartet.
 */

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function participation(overrides: Partial<RoundParticipationState> = {}): RoundParticipationState {
  return {
    roundStartTime: 0,
    roundRevision: 42,
    participantIds: ['p0', 'p1', 'p2'],
    spectatorIds: [],
    ...overrides,
  };
}

describe('World Loading – nur der Zustand der lokalen World', () => {
  it('meldet fertig, sobald die World steht, ohne auf eine Runde zu warten', () => {
    expect(resolveWorldLoadProgress(0, 10, true)).toEqual({ progress: 100, stage: 'ready', ready: true });
    // Auch mit ausstehender Chunk-Arbeit zaehlt allein der lokale World-Zustand.
    expect(resolveWorldLoadProgress(500, 0, true)).toEqual({ progress: 100, stage: 'ready', ready: true });
  });

  it('bildet den Aufbaufortschritt monoton auf die Renderstufe ab', () => {
    expect(resolveWorldLoadProgress(100, 0, false)).toMatchObject({ stage: 'rendering', ready: false });
    const early = resolveWorldLoadProgress(90, 10, false).progress;
    const late = resolveWorldLoadProgress(10, 90, false).progress;
    expect(late).toBeGreaterThan(early);
    expect(resolveWorldLoadProgress(0, 0, false).progress).toBeLessThanOrEqual(100);
    // Negative Eingaben duerfen den Fortschritt nicht aus dem Rahmen tragen.
    expect(resolveWorldLoadProgress(-5, -5, false)).toMatchObject({ stage: 'rendering', ready: false });
  });

  it('kennt keine Rundenbedingung mehr', () => {
    // Die Signatur ist der Vertrag: Round-Zustand hat hier keinen Platz.
    expect(resolveWorldLoadProgress.length).toBe(3);
    const source = read('src/world/WorldLoadReady.ts');
    for (const roundTerm of ['participation', 'roundRevision', 'spawn', 'startupCaches']) {
      expect(source.includes(roundTerm), `WorldLoadReady leaks round state: ${roundTerm}`).toBe(false);
    }
  });
});

describe('Round Loading – eigene Startbedingung hinter der World-Barriere', () => {
  it('gattert den Rundenstart getrennt von der World-Ladebarriere', () => {
    const source = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const start = source.indexOf('private tryScheduleArenaStart(): void {');
    expect(start, 'tryScheduleArenaStart must exist').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n  }', start));
    // Erst die World bei allen Teilnehmern, dann der host-lokale Rundenaufbau.
    expect(body).toContain('bridge.areRoundParticipantsWorldLoadReady()');
    expect(body).toContain('this.prepareRoundStart(');
    expect(body.indexOf('areRoundParticipantsWorldLoadReady'))
      .toBeLessThan(body.indexOf('prepareRoundStart'));

    // Die publizierte World-Barriere darf den Rundenaufbau nicht mehr enthalten.
    const syncStart = source.indexOf('syncArenaLoadReady(view: WorldViewRect | null): void {');
    expect(syncStart).toBeGreaterThan(0);
    const syncBody = source.slice(syncStart, source.indexOf('\n  }', syncStart));
    expect(syncBody).toContain('resolveWorldLoadProgress(');
    expect(syncBody.includes('prepareRoundStart'), 'world barrier still waits for the round').toBe(false);
  });

  it('leitet aktive Rundenteilnehmer aus genau einer Regel ab', () => {
    const state = participation({ spectatorIds: ['p1'] });
    const connected = ['p0', 'p1'];
    expect(getActiveRoundParticipantIds(state, connected)).toEqual(['p0']);
    // Ergebnisberechtigung und Rundenstart teilen sich dieselbe Regel.
    expect(getRoundResultEligibleIds(state, connected)).toEqual(getActiveRoundParticipantIds(state, connected));
    expect(getActiveRoundParticipantIds(null, connected)).toEqual([]);
    expect(getActiveRoundParticipantIds(state, [])).toEqual([]);

    const source = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const gateStart = source.indexOf('private prepareRoundStart(now: number): boolean {');
    expect(gateStart).toBeGreaterThan(0);
    const gate = source.slice(gateStart, source.indexOf('\n  }', gateStart));
    expect(gate).toContain('getActiveRoundParticipantIds(');
    expect(gate.includes('spectatorIds.includes'), 'round gate re-implements the participation rule').toBe(false);
  });
});
