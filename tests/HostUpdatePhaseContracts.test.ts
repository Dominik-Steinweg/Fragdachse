import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * World Update und Activity Update im Frame der Rollen-Coordinatoren.
 *
 * Verbindlich ist, dass der Frame-Owner den Missionsanteil nur noch als benannten Schritt kennt.
 * Welche Systeme darin laufen und in welcher Reihenfolge, gehoert der `CoopMissionRuntime` – eine
 * neue Coop-Mechanik erzeugt deshalb keinen neuen globalen Update-Zweig. Die bestehende
 * Simulationsreihenfolge bleibt dabei unangetastet.
 */

const HOST_PATH = 'src/scenes/arena/HostUpdateCoordinator.ts';
const CLIENT_PATH = 'src/scenes/arena/ClientUpdateCoordinator.ts';
const ACTIVITY_UPDATE_PATH = 'src/activity/CoopMissionHostUpdate.ts';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function hostTickBody(source: string): string {
  const start = source.indexOf('  runHostUpdate(delta: number): void {');
  expect(start, 'runHostUpdate must exist').toBeGreaterThan(0);
  // Der Tick endet an der ersten Methode danach; die Phasen selbst sind nicht Teil davon.
  const end = source.indexOf('\n  private ', start);
  expect(end, 'host tick must end before the next method').toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Systeme, die ausschliesslich zur Coop-Mission gehoeren. */
const ACTIVITY_SYSTEMS = [
  'coopDefenseBossSystem',
  'coopDefenseMissionProgressSystem',
  'coopDefenseMapDirector',
  'coopDefenseMapEventDirector',
  'coopDefenseSecondaryObjectiveSystem',
  'coopDefensePersistentPressureSystem',
  'coopDefenseObjectiveRepairSystem',
  'coopDefenseTimebombSystem',
  'coopDefenseEnemyBurrowSystem',
  'coopDefenseEnemyCombatPositioningSystem',
  'coopDefenseEnemyDodgeSystem',
  'coopDefenseVoidHunterSystem',
  'coopDefenseEnemyAbilitySystem',
  'coopDefenseEnemyAttackSystem',
  'coopDefenseCarrySystem',
  'coopDefenseMissionBarrierManager',
] as const;

describe('Host-Tick – eine Activity-Entscheidung', () => {
  it('aktiviert den Activity-Schritt ueber genau eine Abfrage', () => {
    const body = hostTickBody(read(HOST_PATH));
    expect(body).toContain("const coopMission = bridge.getActivityDescriptor()?.kind === 'coop-mission';");
    expect([...body.matchAll(/const coopMission =/g)]).toHaveLength(1);

    // Genau ein Simulationsschritt haengt an dieser Entscheidung.
    expect(body).toContain('if (coopMission) {');
    expect(body).toContain('this.activityStep()?.hostSimulationStep(');
    expect([...body.matchAll(/hostSimulationStep\(/g)]).toHaveLength(1);
  });

  it('kennt im Frame kein einziges Missionssystem mehr', () => {
    const host = read(HOST_PATH);
    const client = read(CLIENT_PATH);
    const activity = read(ACTIVITY_UPDATE_PATH);
    for (const activitySystem of ACTIVITY_SYSTEMS) {
      expect(host.includes(activitySystem), `${activitySystem} still lives in the host frame`).toBe(false);
      expect(client.includes(activitySystem), `${activitySystem} still lives in the client frame`).toBe(false);
    }
    // Die Reihenfolge selbst existiert weiterhin – im Owner der Activity.
    for (const activitySystem of [
      'coopDefenseBossSystem',
      'coopDefenseMissionProgressSystem',
      'coopDefenseSecondaryObjectiveSystem',
      'coopDefenseObjectiveRepairSystem',
      'coopDefensePersistentPressureSystem',
      'coopDefenseTimebombSystem',
      'coopDefenseEnemyAttackSystem',
    ]) {
      expect(activity.includes(activitySystem), `${activitySystem} lost its activity phase`).toBe(true);
    }
  });

  it('haelt den Activity-Owner frei von Kontext- und Netzwerk-Infrastruktur', () => {
    expect(read(ACTIVITY_UPDATE_PATH)).not.toMatch(/ArenaContext|NetworkBridge|network\/bridge|\bbridge\b/);
  });
});

describe('Host-Tick – Reihenfolge und Weltanteil unveraendert', () => {
  it('laesst den Weltanteil vor dem Missionsschritt stehen', () => {
    const body = hostTickBody(read(HOST_PATH));
    const decoy = body.indexOf('this.ctx.decoySystem.hostUpdateLifecycle(now)');
    const simulation = body.indexOf('this.activityStep()?.hostSimulationStep(');

    // `decoySystem` gehoert zu jeder World, nicht zur Coop-Mission. Es steht vor dem
    // Missionsschritt, weil dessen Navigation Koeder und Tarnung als Ziele liest.
    expect(decoy).toBeGreaterThan(0);
    expect(simulation).toBeGreaterThan(decoy);
    expect(body).toContain('if (!countdownActive) this.ctx.decoySystem.hostUpdateLifecycle(now);');
    expect(body).toContain('if (metrics) metrics.enemyAiMs = performance.now() - phaseStartedAt;');
  });

  it('haelt die Activity-Reihenfolge frei von eigener Aktivierungslogik', () => {
    const source = read(ACTIVITY_UPDATE_PATH);
    for (const phase of ['runProgressPhase', 'runCombatPhase']) {
      const start = source.indexOf(`  private ${phase}(`);
      expect(start, `${phase} must exist`).toBeGreaterThan(0);
      const phaseBody = source.slice(start, source.indexOf('\n  }', start));
      // Die Aktivierung steht im Frame; die Phase entscheidet nicht erneut ueber sich selbst.
      expect(phaseBody.includes('getActivityDescriptor'), `${phase} re-decides its activation`).toBe(false);
      expect(phaseBody.includes('isCoopDefenseMode'), `${phase} falls back to the game mode`).toBe(false);
    }

    // Fortschritt vor Navigation vor Kampf: Erst steht der Missionsstand dieses Frames, dann
    // richtet sich die Navigation daran aus, danach bewegen und kaempfen die Gegner.
    const runStart = source.indexOf('  run(');
    expect(runStart, 'run() must exist').toBeGreaterThan(0);
    const runBody = source.slice(runStart, source.indexOf('\n  }', runStart));
    const progress = runBody.indexOf('this.runProgressPhase(');
    const navigation = runBody.indexOf('this.updateFlowFields(');
    const combat = runBody.indexOf('this.runCombatPhase(');
    expect(progress).toBeGreaterThan(0);
    expect(navigation).toBeGreaterThan(progress);
    expect(combat).toBeGreaterThan(navigation);
  });
});
