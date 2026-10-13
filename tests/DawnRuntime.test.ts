import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Distance: {
  Between: (x: number, y: number, x2: number, y2: number) => Math.hypot(x - x2, y - y2),
} } }));
import { DawnScrapLedger } from '../src/dawn/runtime/DawnScrapLedger';
import { DawnSalvageDirector } from '../src/dawn/runtime/DawnSalvageDirector';
import { DawnActivityRuntime } from '../src/dawn/runtime/DawnActivityRuntime';
import { composeDawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import { resolveDawnScenario, resolveDawnSites } from '../src/dawn/resolution/DawnScenarioResolution';
import { getDawnSchedule, getDawnThreatCurve } from '../src/config/dawn/dawnContent';
import { resolveCoopDefenseMapSecondaryObjectives } from '../src/config/coopDefenseMaps';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import { DAWN_SCRAP_DEFS, DROP_TABLES, POWERUP_DEFS } from '../src/powerups/PowerUpConfig';

const plans = composeDawnRoundPlans({ seed: 7, threat: 4, dayNumber: 1 });
const sites = resolveDawnSites(plans.world);
const curve = getDawnThreatCurve(plans.activity.threat);
const schedule = getDawnSchedule(plans.activity.scheduleId);

function pickups() {
  return new PowerUpSystem(null as never, {
    isAlive: () => true, isBurrowed: () => false,
    healToFull: vi.fn(), addArmor: vi.fn(), applyDamage: vi.fn(), applyExplosionDamage: vi.fn(),
  }, { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] });
}

describe('Dawn scrap ledger', () => {
  it('publishes a shared integral total, resets both diagnostic sources and refuses invalid grants', () => {
    const publish = vi.fn();
    const ledger = new DawnScrapLedger(publish);
    expect(ledger.credit(8.9, 'site')).toBe(8);
    expect(ledger.credit(3, 'drop')).toBe(3);
    for (const amount of [-4, 0, NaN, Infinity, -Infinity]) expect(ledger.credit(amount, 'drop')).toBe(0);
    expect(ledger.total).toBe(11);
    expect(ledger.getDiagnostics()).toEqual({ site: 8, drop: 3 });
    expect(publish.mock.calls).toEqual([[8], [11]]);
    ledger.reset();
    expect(ledger.total).toBe(0);
    expect(ledger.getDiagnostics()).toEqual({ site: 0, drop: 0 });
    expect(publish).toHaveBeenLastCalledWith(0);
    ledger.credit(Number.MAX_VALUE, 'site');
    expect(Number.isSafeInteger(ledger.total)).toBe(true);
    expect(ledger.credit(1, 'drop')).toBe(0);
  });
});

describe('Dawn salvage rewards', () => {
  it('rewards each resolved site exactly once using its tier and the threat multiplier', () => {
    const ledger = new DawnScrapLedger(vi.fn());
    const feedback = vi.fn();
    const director = new DawnSalvageDirector(sites, curve, ledger, feedback);
    director.onObjectiveCompleted('salvage-unknown');
    director.onObjectiveCompleted('campaign-objective');
    for (const site of sites) {
      director.onObjectiveCompleted(site.objectiveId);
      director.onObjectiveCompleted(site.objectiveId);
    }
    expect(ledger.total).toBe(sites.reduce((sum, site) => sum + Math.floor(site.tier.scrapReward * curve.scrapMultiplier), 0));
    expect(feedback).toHaveBeenCalledTimes(sites.length);
  });

  it('grants nothing for destroyed hold targets or objectives that expire at dusk', () => {
    const { mapConfig } = resolveDawnScenario(plans.world, plans.activity);
    const objectives = resolveCoopDefenseMapSecondaryObjectives(mapConfig, 1);
    const ledger = new DawnScrapLedger(vi.fn());
    const director = new DawnSalvageDirector(sites, curve, ledger, vi.fn());
    const system = new CoopDefenseSecondaryObjectiveSystem(objectives, {
      isExternalTriggerSatisfied: () => true,
      onObjectiveCompleted: id => director.onObjectiveCompleted(id),
    });
    system.hostUpdate(0, false);
    for (const objective of objectives.filter(objective => objective.type === 'hold')) {
      for (const target of objective.targets) system.reportTargetDestroyed(objective.id, target);
    }
    const dusk = schedule.phases.find(phase => phase.id === 'dusk')!.startMs;
    system.hostUpdate(dusk, false);
    expect(ledger.total).toBe(0);
    expect(objectives.every(objective => system.getObjectiveState(objective.id) === 'failed')).toBe(true);
  });
});

describe('Dawn activity drops', () => {
  it('keeps normal modes free of scrap and collects each Dawn pickup only once for the team', () => {
    const system = pickups();
    for (const table of Object.values(DROP_TABLES)) {
      expect(Object.keys(table.items).some(id => id in DAWN_SCRAP_DEFS)).toBe(false);
    }
    system.onCoopDefenseEnemyKilled('player-a', 10, 100, 200);
    expect(system.getWorldItemSnapshot()).toHaveLength(0);
    expect(system.spawnPickup(curve.scrapDrops.pickupDefId, 100, 200)).toBeNull();
    const publish = vi.fn();
    const runtime = new DawnActivityRuntime(sites, curve, schedule, {
      publishScrap: publish, sitePosition: () => ({ x: 1, y: 2 }), feedback: vi.fn(),
      elapsedMs: () => schedule.phases.find(phase => phase.id === 'night')!.startMs,
      isActive: () => true, random: () => 0, pickups: system,
    });
    for (const player of ['player-a', 'player-b']) {
      system.onCoopDefenseEnemyKilled('player-a', 10, 100, 200);
      const [pickup] = system.getWorldItemSnapshot();
      expect(system.tryPickup(player, pickup.uid, 1000, 2000)).toBe(false);
      expect(system.tryPickup(player, pickup.uid, 100, 200)).toBe(true);
      expect(system.tryPickup(player, pickup.uid, 100, 200)).toBe(false);
    }
    expect(runtime.total).toBe(2 * POWERUP_DEFS[curve.scrapDrops.pickupDefId].amount!);
    system.onCoopDefenseEnemyKilled('player-a', 10, 100, 200);
    expect(system.getWorldItemSnapshot()).toHaveLength(1);
    const unclaimed = system.getWorldItemSnapshot()[0].uid;
    system.getNetSnapshot();
    const total = runtime.total;
    runtime.destroy(); runtime.destroy();
    expect(system.getWorldItemSnapshot()).toHaveLength(0);
    expect(system.getNetSnapshot()?.removals).toContain(unclaimed);
    expect(publish).toHaveBeenLastCalledWith(total);
    system.onCoopDefenseEnemyKilled('player-a', 10, 100, 200);
    runtime.onObjectiveCompleted(sites[0].objectiveId);
    expect(system.getWorldItemSnapshot()).toHaveLength(0);
    expect(publish).toHaveBeenLastCalledWith(total);
  });

  it('uses phase-specific curve chances, stops after round end and starts fresh on activity replacement', () => {
    const system = pickups();
    let elapsed = 0;
    let active = true;
    let roll = curve.scrapDrops.dayChance;
    const ports = {
      publishScrap: vi.fn(), sitePosition: () => ({ x: 1, y: 2 }), feedback: vi.fn(),
      elapsedMs: () => elapsed, isActive: () => active, random: () => roll, pickups: system,
    };
    const runtime = new DawnActivityRuntime(sites, curve, schedule, ports);
    system.onCoopDefenseEnemyKilled('p', 1, 1, 2);
    expect(system.getWorldItemSnapshot()).toHaveLength(0);
    elapsed = schedule.phases.find(phase => phase.id === 'night')!.startMs;
    roll = curve.scrapDrops.nightChance / 2;
    system.onCoopDefenseEnemyKilled('p', 1, 1, 2);
    expect(system.getWorldItemSnapshot()).toHaveLength(1);
    active = false;
    const [pickup] = system.getWorldItemSnapshot();
    expect(system.tryPickup('p', pickup.uid, 1, 2)).toBe(false);
    runtime.onObjectiveCompleted(sites[0].objectiveId);
    system.onCoopDefenseEnemyKilled('p', 1, 1, 2);
    expect(runtime.total).toBe(0);
    expect(system.getWorldItemSnapshot()).toHaveLength(1);
    runtime.destroy();
    active = true;
    const next = new DawnActivityRuntime(sites, curve, schedule, ports);
    expect(next.total).toBe(0);
    next.onObjectiveCompleted(sites[0].objectiveId);
    expect(next.total).toBe(Math.floor(sites[0].tier.scrapReward * curve.scrapMultiplier));
    elapsed = schedule.durationMs;
    system.onCoopDefenseEnemyKilled('p', 1, 1, 2);
    expect(system.getWorldItemSnapshot()).toHaveLength(0);
    next.destroy();
  });
});
