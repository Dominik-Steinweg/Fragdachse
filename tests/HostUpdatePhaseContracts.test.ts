import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * World Update und Activity Update im Host-Tick.
 *
 * Verbindlich ist nicht ein grober `world.update(); activity.update();`-Block, sondern:
 * Activity-Systeme werden durch die Activity aktiviert und gruppiert, nicht durch verstreute
 * Nullable-Abfragen. Die bestehende Simulationsreihenfolge bleibt dabei unangetastet.
 */

const SOURCE_PATH = 'src/scenes/arena/HostUpdateCoordinator.ts';

function read(): string {
  return readFileSync(resolve(process.cwd(), SOURCE_PATH), 'utf8');
}

function hostTickBody(source: string): string {
  const start = source.indexOf('  runHostUpdate(delta: number): void {');
  expect(start, 'runHostUpdate must exist').toBeGreaterThan(0);
  // Der Tick endet an der ersten Methode danach; die Phasen selbst sind nicht Teil davon.
  const end = source.indexOf('\n  private ', start);
  expect(end, 'host tick must end before the next method').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Host-Tick – eine Activity-Entscheidung', () => {
  it('aktiviert die Activity-Phasen ueber genau eine Abfrage', () => {
    const body = hostTickBody(read());
    expect(body).toContain("const coopMission = bridge.getActivityDescriptor()?.kind === 'coop-mission';");
    expect([...body.matchAll(/const coopMission =/g)]).toHaveLength(1);

    // Beide Gruppen haengen an derselben Entscheidung.
    expect(body).toContain('if (coopMission) this.runCoopMissionProgressPhase(');
    expect(body).toContain('if (coopMission) this.runCoopMissionCombatPhase(');
  });

  it('gruppiert die Missions- und Gegnersysteme in benannten Phasen', () => {
    const source = read();
    const body = hostTickBody(source);
    // Die Systeme stehen in ihren Phasen, nicht mehr einzeln im Tick.
    for (const activitySystem of [
      'coopDefenseBossSystem',
      'coopDefenseMissionProgressSystem',
      'coopDefenseMapDirector',
      'coopDefenseSecondaryObjectiveSystem',
      'coopDefensePersistentPressureSystem',
      'coopDefenseTimebombSystem',
      'coopDefenseEnemyBurrowSystem',
      'coopDefenseEnemyCombatPositioningSystem',
      'coopDefenseVoidHunterSystem',
      'coopDefenseEnemyAttackSystem',
    ]) {
      expect(body.includes(activitySystem), `${activitySystem} still ticks outside its activity phase`)
        .toBe(false);
      expect(source.includes(activitySystem), `${activitySystem} lost its phase`).toBe(true);
    }

    expect(source).toContain('private runCoopMissionProgressPhase(');
    expect(source).toContain('private runCoopMissionCombatPhase(');
  });
});

describe('Host-Tick – Reihenfolge und Weltanteil unveraendert', () => {
  it('laesst die Weltsysteme zwischen den Activity-Phasen stehen', () => {
    const body = hostTickBody(read());
    const progress = body.indexOf('this.runCoopMissionProgressPhase(');
    const decoy = body.indexOf('this.ctx.decoySystem.hostUpdateLifecycle(now)');
    const flowFields = body.indexOf('this.updateEnemyFlowFields(now, delta)');
    const combat = body.indexOf('this.runCoopMissionCombatPhase(');

    // Genau die bestehende Reihenfolge: Activity, dann Weltanteil, dann Activity.
    expect(progress).toBeGreaterThan(0);
    expect(decoy).toBeGreaterThan(progress);
    expect(flowFields).toBeGreaterThan(decoy);
    expect(combat).toBeGreaterThan(flowFields);

    // `decoySystem` gehoert zu jeder World, nicht zur Coop-Mission – es darf nicht mitgegattert
    // werden. Dasselbe gilt fuer die Messpunkte des Ticks.
    expect(body).toContain('if (!countdownActive) this.ctx.decoySystem.hostUpdateLifecycle(now);');
    expect(body).toContain('if (metrics) metrics.enemyAiMs = performance.now() - phaseStartedAt;');
  });

  it('haelt die Phasen selbst frei von eigener Aktivierungslogik', () => {
    const source = read();
    for (const phase of ['runCoopMissionProgressPhase', 'runCoopMissionCombatPhase']) {
      const start = source.indexOf(`  private ${phase}(`);
      expect(start, `${phase} must exist`).toBeGreaterThan(0);
      const phaseBody = source.slice(start, source.indexOf('\n  }', start));
      // Die Aktivierung steht im Tick; die Phase entscheidet nicht erneut ueber sich selbst.
      expect(phaseBody.includes('getActivityDescriptor'), `${phase} re-decides its activation`).toBe(false);
      expect(phaseBody.includes('isCoopDefenseMode'), `${phase} falls back to the game mode`).toBe(false);
    }
  });
});
