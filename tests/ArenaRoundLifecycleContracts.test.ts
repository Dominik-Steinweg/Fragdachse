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
const PERSISTENT_BASE_PATH = 'src/scenes/arena/ArenaPersistentBaseSession.ts';
const WORLD_GAMEPLAY_PATHS = [
  'src/scenes/arena/ArenaWorldGameplayComposition.ts',
  'src/scenes/arena/ArenaWorldEnvironmentComposition.ts',
  'src/scenes/arena/ArenaWorldPlayerComposition.ts',
  'src/scenes/arena/ArenaWorldCombatComposition.ts',
  'src/scenes/arena/ArenaWorldConstructionComposition.ts',
];
const SCENE_PATH = 'src/scenes/ArenaScene.ts';
const RUNTIME_PATH = 'src/scenes/arena/ArenaRuntime.ts';

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
  const end = source.indexOf('\n  private ', start + 1);
  expect(end, `${COORDINATOR_PATH} must keep a private method after tearDownArena()`).toBeGreaterThan(start);
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
  coopDefenseTeamBuffSystem: 'this.detachLocalActivityForTeardown();',
  // Phase-10C: Die World-Gameplay-Owner nullen ihre Compatibility-Projektionen selbst, sobald
  // die `WorldRuntime` sie zerstoert. Ein zusaetzlicher manueller Reset im Flow waere wieder
  // Doppelbesitz - genau das soll dieser Vertrag verhindern.
  reinforcementMatrixSystem: 'this.releaseWorldRuntime(',
  energyInjectorSystem: 'this.releaseWorldRuntime(',
  targetStatusSystem: 'this.releaseWorldRuntime(',
  resourceSystem: 'this.releaseWorldRuntime(',
  burrowSystem: 'this.releaseWorldRuntime(',
  loadoutManager: 'this.releaseWorldRuntime(',
  powerUpSystem: 'this.releaseWorldRuntime(',
  detonationSystem: 'this.releaseWorldRuntime(',
  armageddonSystem: 'this.releaseWorldRuntime(',
  airstrikeSystem: 'this.releaseWorldRuntime(',
  shieldBuffSystem: 'this.releaseWorldRuntime(',
  energyShieldSystem: 'this.releaseWorldRuntime(',
  timeBubbleSystem: 'this.releaseWorldRuntime(',
  teslaDomeSystem: 'this.releaseWorldRuntime(',
  turretSystem: 'this.releaseWorldRuntime(',
  coopDefensePlayerModifierSystem: 'this.releaseWorldRuntime(',
  coopDefenseItemRuntimeSystem: 'this.releaseWorldRuntime(',
  guardianSpiritSystem: 'this.releaseWorldRuntime(',
  repairDroneSystem: 'this.releaseWorldRuntime(',
  slimeTrailSystem: 'this.releaseWorldRuntime(',
  flamethrowerUpgradeSystem: 'this.releaseWorldRuntime(',
  weaponUpgradeSystem: 'this.releaseWorldRuntime(',
  ak47StrategicTargetSystem: 'this.releaseWorldRuntime(',
  translocatorSystem: 'this.releaseWorldRuntime(',
  tunnelSystem: 'this.releaseWorldRuntime(',
  // Die Capture-the-Beer-Runtime gehoert der Activity; ihr Detach nullt die Fassade.
  captureTheBeerSystem: 'this.detachLocalActivityForTeardown();',
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
  it('enthaelt keinen migrierten World-/Activity-Runtime-State mehr im ArenaContext', () => {
    const context = read(CONTEXT_PATH);
    for (const field of Object.keys(OWNED_ROUND_FIELDS)) {
      expect(context, field).not.toMatch(new RegExp(`^  ${field}\\??:`, 'm'));
    }
    expect(context).not.toContain('Round-scoped');
  });

  it('greift direkt auf World-/Activity-Owner zu und entfernt den Compatibility-Sync', () => {
    const coordinator = read(COORDINATOR_PATH);
    expect(coordinator).toContain('getWorldRuntime(): WorldRuntime | null');
    expect(coordinator).toContain('getCoopMissionRuntime(): CoopMissionRuntime | null');
    expect(coordinator).toContain('this.worldRuntime?.materialization?.arena');
    expect(coordinator).not.toContain('syncCoopMissionCompatibilityBindings');
    for (const field of Object.keys(OWNED_ROUND_FIELDS)) {
      expect(coordinator, field).not.toContain(`this.ctx.${field}`);
    }
  });

  it('verdrahtet Frame-Consumer mit den tatsaechlichen Ownern', () => {
    const runtime = read(RUNTIME_PATH);
    expect(runtime).toContain('setWorldFramePort({');
    expect(runtime).toContain('getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime()');
    expect(runtime).toContain('setActivityFramePort({');
    expect(runtime).toContain('getCoopMissionRuntime: () => this.flow.getCoopMissionRuntime()');
    expect(runtime).not.toContain('RuntimeContext');
    expect(runtime).not.toContain('ArenaServices');
  });

  it('entkoppelt die persistente Basis beim Teardown vollstaendig', () => {
    const body = readTearDownArenaBody();
    // Die Mission-Session darf ihre Runtime-IDs verlieren, aber nicht ihren Arbeitsstand: der
    // Round-Teardown ist auch der Map-Wechsel innerhalb einer laufenden Mission.
    // Der Abschluss laeuft im Abbau des gebauten World-Zustands – genau dort, wo die Bau-Runtime
    // noch beantworten kann, welche Objekte die Runde ueberlebt haben.
    expect(body).toContain('this.releaseWorldRuntime(preserveAuthoredPresentation);');
    expect(read(COORDINATOR_PATH)).toContain('this.persistentBaseWorldBinding?.finalizeWorldRuntimeObjects();');

    expect(body).not.toContain('this.ctx.persistentBaseContributions');
  });

  it('beendet den Working State am Activity-Identity-Ende statt am Runtime-Teardown', () => {
    const source = read(COORDINATOR_PATH);
    const teardownStart = source.indexOf('  tearDownArena(');
    const rollback = source.indexOf('this.rollbackPersistentBaseMissionIfActive();', teardownStart);
    const runtimeDetach = source.indexOf('this.detachAllWorldPlayers();', teardownStart);
    expect(rollback).toBe(-1);
    expect(runtimeDetach).toBeGreaterThan(teardownStart);
    expect(source).toContain('activityIdentity: {');
    expect(read(PERSISTENT_BASE_PATH))
      .toContain('endPersistentBaseTransaction(activity: ActivityDescriptor): void');
  });

  it('wendet Victory/Defeat vor dem Ende der World-Instanz an', () => {
    const source = read(COORDINATOR_PATH);
    const start = source.indexOf('  hostCompleteRound(');
    const end = source.indexOf('\n  /**', start + 1);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body.indexOf('createCoopMissionCompletion')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('this.resultApplication.apply')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('this.resultApplication.apply')).toBeLessThan(body.indexOf('this.worldLifecycle.endInstance();'));
    // Der Coordinator orchestriert den Abschluss nur noch. Persistent-Base-Outcome und
    // Victory-Rewards werden vom revisionsgebundenen ResultApplication-Owner entschieden.
    const coopBranchStart = body.indexOf("if (activity?.kind === 'coop-mission'");
    const legacyBranchStart = body.indexOf('} else {', coopBranchStart);
    expect(body.slice(coopBranchStart, legacyBranchStart)).not.toContain('applyPersistentBaseRoundOutcome');
    expect(body.slice(coopBranchStart, legacyBranchStart)).not.toContain('grantAuthoredPersistentBaseRewards');
  });

  it('bindet Map- und Objective-Rewards an den gemeinsamen host-autoritativen Grant-Pfad', () => {
    const source = read(COORDINATOR_PATH);
    const persistentBase = read(PERSISTENT_BASE_PATH);
    const objectiveComposition = read(
      resolve(process.cwd(), 'src/activity/CoopMissionObjectiveComposition.ts'),
    );
    expect(source).toContain('getActivityDefinition(definitionId)?.persistentBaseRewardsOnVictory ?? []');
    expect(source).toContain('grantPersistentBaseRewards: (rewardIds) => {');
    expect(source).toContain('this.persistentBase.grantAuthoredPersistentBaseRewards(rewardIds);');
    expect(objectiveComposition).toContain(
      'this.options.grantPersistentBaseRewards(config?.rewards?.persistentBaseRewardsOnComplete);',
    );

    const helperStart = persistentBase.indexOf('  grantAuthoredPersistentBaseRewards(');
    const helperEnd = persistentBase.indexOf('\n  /**', helperStart + 1);
    expect(helperStart).toBeGreaterThan(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = persistentBase.slice(helperStart, helperEnd);
    expect(helperBody).toContain('bridge.getRoundResultEligiblePlayerIds()');
    expect(helperBody).toContain('grantStoredPersistentBaseRewards');
    expect(helperBody).toContain('bridge.hostGrantPersistentBaseRewards');

    const syncStart = persistentBase.indexOf('  syncPersistentBaseRewards(): void');
    const syncEnd = persistentBase.indexOf('\n  /**', syncStart + 1);
    expect(syncStart).toBeGreaterThan(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncBody = persistentBase.slice(syncStart, syncEnd);
    expect(syncBody.indexOf('bridge.getConfirmedPersistentBaseRewardGrant()')).toBeGreaterThanOrEqual(0);
    expect(syncBody.indexOf('grantStoredPersistentBaseRewards(confirmed.rewardIds)'))
      .toBeLessThan(syncBody.indexOf('if (!bridge.isHost()) return;'));
  });
});
