import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `ArenaLifecycleCoordinator` ist Phaser-gebunden und laesst sich nicht ohne kompletten
 * Scene-Stack instanziieren. Der Vertrag ist aber rein strukturell: jedes round-scoped Feld des
 * `ArenaContext` muss entweder direkt oder ueber seinen Runtime-Owner beim Teardown zurueckgesetzt
 * und beim Aufbau der Scene leer initialisiert werden. Genau das prueft dieser Test – damit ein
 * spaeteres Runtime-Refactoring kein neues Feld einfuehren kann, das in die Lobby oder in die
 * naechste Runde leakt.
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
  world: 'this.releaseWorldRuntime(',
  // Gameplay-State, Darstellung und die world-lokale Persistent-Base fallen gemeinsam mit der
  // World-Runtime; genau ein Aufruf setzt sie zurueck.
  worldMaterialization: 'this.releaseWorldRuntime(',
  worldPresentation: 'this.releaseWorldRuntime(',
  // Phase-5-Compatibility: Diese Felder sind nur Lesefassaden auf CoopMissionRuntime. Der eine
  // Activity-Detach zerstoert Enemy-, Encounter-, Boss- und Navigation-State und nullt sie ueber
  // den gerichteten Binding-Callback; ein manueller Einzel-Teardown waere wieder Doppelbesitz.
  enemyManager: 'this.detachLocalActivityForTeardown();',
  necromancySystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyAttackSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyAbilitySystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyTrainAwarenessSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyBurrowSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyDodgeSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseEnemyCombatPositioningSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseVoidHunterSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseTimebombSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseSpawnExecutor: 'this.detachLocalActivityForTeardown();',
  coopDefensePersistentPressureSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseBossSystem: 'this.detachLocalActivityForTeardown();',
  coopDefenseMapDirector: 'this.detachLocalActivityForTeardown();',
  coopDefenseMapEventDirector: 'this.detachLocalActivityForTeardown();',
  flowFieldCoordinator: 'this.detachLocalActivityForTeardown();',
  enemyFlowFieldService: 'this.detachLocalActivityForTeardown();',
  enemyPlayerFlowFieldService: 'this.detachLocalActivityForTeardown();',
  enemyStrategicFlowFieldService: 'this.detachLocalActivityForTeardown();',
  enemyAiTargetCatalog: 'this.detachLocalActivityForTeardown();',
  enemyStrategicTargetService: 'this.detachLocalActivityForTeardown();',
  enemyBossFlowFieldService: 'this.detachLocalActivityForTeardown();',
  allyFlowFieldServices: 'this.detachLocalActivityForTeardown();',
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
    // Der gebaute World-Zustand steht als genau ein Owner im Kontext; die frueheren Einzelfelder
    // (arenaResult, currentLayout, placementSystem, rockRegistry, baseManager, lightOccluderIndex)
    // sind reine Lesefassaden darauf und koennen deshalb nicht mehr einzeln leaken.
    expect(roundScopedFields).toContain('worldMaterialization');
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
    // Der Abschluss laeuft im Abbau des gebauten World-Zustands – genau dort, wo die Bau-Runtime
    // noch beantworten kann, welche Objekte die Runde ueberlebt haben.
    expect(body).toContain('this.releaseWorldRuntime(preserveAuthoredPresentation);');
    expect(read(COORDINATOR_PATH)).toContain('this.persistentBaseContributions.detachRuntimeObjects(');

    expect(body).toContain('this.ctx.persistentBaseContributions = null');
  });

  it('rollt einen offenen Working State vor technischem Teardown zurueck', () => {
    const source = read(COORDINATOR_PATH);
    const teardownStart = source.indexOf('  tearDownArena(');
    const rollback = source.indexOf('this.rollbackPersistentBaseMissionIfActive();', teardownStart);
    const runtimeDetach = source.indexOf('this.detachAllWorldPlayers();', teardownStart);
    expect(rollback).toBeGreaterThan(teardownStart);
    expect(runtimeDetach).toBeGreaterThan(teardownStart);
    expect(rollback).toBeLessThan(runtimeDetach);
    expect(source).toContain('private rollbackPersistentBaseMissionIfActive(): void');
  });

  it('wendet Victory/Defeat vor dem Ende der World-Instanz an', () => {
    const source = read(COORDINATOR_PATH);
    const start = source.indexOf('  hostCompleteRound(');
    const end = source.indexOf('\n  /**', start + 1);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body.indexOf('applyPersistentBaseRoundOutcome')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('applyPersistentBaseRoundOutcome')).toBeLessThan(body.indexOf('this.worldLifecycle.endInstance();'));
    expect(body).toContain('this.publishConfirmedPersistentBaseContributions(');
  });

  it('bindet Map- und Objective-Rewards an den gemeinsamen host-autoritativen Grant-Pfad', () => {
    const source = read(COORDINATOR_PATH);
    expect(source).toContain(
      'this.grantAuthoredPersistentBaseRewards(mapConfig.persistentBaseRewardsOnVictory);',
    );
    expect(source).toContain(
      'this.grantAuthoredPersistentBaseRewards(config?.rewards?.persistentBaseRewardsOnComplete);',
    );

    const helperStart = source.indexOf('  private grantAuthoredPersistentBaseRewards(');
    const helperEnd = source.indexOf('\n  /**', helperStart + 1);
    expect(helperStart).toBeGreaterThan(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = source.slice(helperStart, helperEnd);
    expect(helperBody).toContain('bridge.getRoundResultEligiblePlayerIds()');
    expect(helperBody).toContain('grantStoredPersistentBaseRewards');
    expect(helperBody).toContain('bridge.hostGrantPersistentBaseRewards');

    const syncStart = source.indexOf('  syncPersistentBaseRewards(): void');
    const syncEnd = source.indexOf('\n  /**', syncStart + 1);
    expect(syncStart).toBeGreaterThan(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncBody = source.slice(syncStart, syncEnd);
    expect(syncBody.indexOf('bridge.getConfirmedPersistentBaseRewardGrant()')).toBeGreaterThanOrEqual(0);
    expect(syncBody.indexOf('grantStoredPersistentBaseRewards(confirmed.rewardIds)'))
      .toBeLessThan(syncBody.indexOf('if (!bridge.isHost()) return;'));
  });
});
