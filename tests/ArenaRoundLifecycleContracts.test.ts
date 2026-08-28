import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Struktureller Schutz des Round-Lifetime-Vertrags aus `AGENTS.md`:
 *
 * > Round-Ressourcen werden in `ArenaLifecycleCoordinator.buildArena()` erzeugt, in
 * > `tearDownArena()` vollstaendig entkoppelt und ausserhalb einer Runde als `null` behandelt.
 *
 * `ArenaLifecycleCoordinator` ist Phaser-gebunden und laesst sich nicht ohne kompletten
 * Scene-Stack instanziieren. Der Vertrag ist aber rein strukturell: jedes round-scoped Feld des
 * `ArenaContext` muss beim Teardown zurueckgesetzt und beim Aufbau der Scene leer initialisiert
 * werden. Genau das prueft dieser Test – damit ein spaeteres Runtime-Refactoring kein neues
 * Round-Feld einfuehren kann, das in die Lobby oder in die naechste Runde leakt.
 */

const CONTEXT_PATH = 'src/scenes/arena/ArenaContext.ts';
const COORDINATOR_PATH = 'src/scenes/arena/ArenaLifecycleCoordinator.ts';
const SCENE_PATH = 'src/scenes/ArenaScene.ts';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Feldnamen aus dem als round-scoped markierten Teil des ArenaContext. */
function collectRoundScopedFields(): string[] {
  const source = read(CONTEXT_PATH);
  const marker = source.indexOf('Round-scoped');
  expect(marker, `${CONTEXT_PATH} must keep the "Round-scoped" section marker`).toBeGreaterThan(0);
  const names = [...source.slice(marker).matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((match) => match[1]);
  return [...new Set(names)];
}

function readTearDownArenaBody(): string {
  const source = read(COORDINATOR_PATH);
  const start = source.indexOf('  tearDownArena(');
  expect(start, `${COORDINATOR_PATH} must declare tearDownArena()`).toBeGreaterThan(0);
  const end = source.indexOf('\n  private materializePersistentBaseComposite(', start);
  expect(end, `${COORDINATOR_PATH} must keep materializePersistentBaseComposite() after tearDownArena()`).toBeGreaterThan(start);
  // Ausrichtungs-Leerzeichen im Quelltext duerfen die Zuweisungssuche nicht stoeren.
  return source.slice(start, end).replace(/[ \t]+/g, ' ');
}

/**
 * Felder mit eigenem Besitzer. Sie werden nicht direkt zugewiesen, sondern ueber genau einen
 * Lifecycle zurueckgesetzt – der Aufruf steht stellvertretend fuer die Ruecksetzung.
 */
const OWNED_ROUND_FIELDS: Readonly<Record<string, string>> = {
  world: 'this.worldLifecycle.detachRuntime()',
};

/** Erlaubte Ruecksetzformen: Referenz loeschen, Liste leeren, Sammlung leeren oder Besitzeraufruf. */
function resetsField(body: string, field: string, receiver: string): boolean {
  const owner = OWNED_ROUND_FIELDS[field];
  if (owner) return body.includes(owner);
  return body.includes(`${receiver}.${field} = null`)
    || body.includes(`${receiver}.${field} = []`)
    || body.includes(`${receiver}.${field} = new Map()`)
    || body.includes(`${receiver}.${field}.clear()`);
}

describe('arena round lifecycle contract', () => {
  const roundScopedFields = collectRoundScopedFields();

  it('kennt die round-scoped Felder des ArenaContext', () => {
    // Reine Absicherung des Parsers: eine leere Liste wuerde die Pruefungen unten wertlos machen.
    expect(roundScopedFields.length).toBeGreaterThan(30);
    expect(roundScopedFields).toContain('arenaResult');
    expect(roundScopedFields).toContain('persistentBaseContributions');
    expect(roundScopedFields).toContain('coopDefenseRoundStateSystem');
    expect(roundScopedFields).not.toContain('playerManager');
    expect(roundScopedFields).not.toContain('combatSystem');
  });

  it('setzt jedes round-scoped Feld in tearDownArena() zurueck', () => {
    const body = readTearDownArenaBody();
    const leaking = roundScopedFields.filter((field) => !resetsField(body, field, 'this.ctx'));
    expect(leaking, 'round-scoped ArenaContext fields left behind by tearDownArena()').toEqual([]);
  });

  it('initialisiert jedes round-scoped Feld beim Scene-Aufbau leer', () => {
    const source = read(SCENE_PATH).replace(/[ \t]+/g, ' ');
    const missing = roundScopedFields.filter((field) => !(
      source.includes(`${field}: null`)
      || source.includes(`${field}: []`)
      || source.includes(`${field}: new Map()`)
    ));
    expect(missing, 'round-scoped ArenaContext fields not initialized empty in ArenaScene').toEqual([]);
  });

  it('entkoppelt die persistente Basis beim Teardown vollstaendig', () => {
    const body = readTearDownArenaBody();
    // Die Mission-Session darf ihre Runtime-IDs verlieren, aber nicht ihren Arbeitsstand: der
    // Round-Teardown ist auch der Map-Wechsel innerhalb einer laufenden Mission.
    expect(body).toContain('this.persistentBaseContributions.detachRuntimeObjects(');

    expect(body).toContain('this.ctx.persistentBaseContributions = null');
  });
});
