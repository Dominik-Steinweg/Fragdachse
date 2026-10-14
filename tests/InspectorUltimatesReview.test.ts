import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectorUltimatesScenario, inspectorUltimatesStatus, releaseInspectorUltimatesReview,
  runInspectorUltimatesReview } from '../src/dev/scenario/InspectorUltimatesReview';
import type { DevScenarioController } from '../src/dev/scenario/controller';
import { defaultScenario, parseScenario, buildScenarioProfile } from '../src/dev/scenario/config';
import { isDiagnosticMapId } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_CONSTRUCTIONS, resolveConstructionCapacity } from '../src/config/coopDefenseConstructions';
import { getCoopDefenseItemEffectTotals } from '../src/utils/coopDefenseItemEffects';
import { FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS } from '../src/systems/fireControl/FireControlEligibility';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS as upgrades } from '../src/utils/coopDefenseUpgrades';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { FireControlSnapshot } from '../src/systems/fireControl/FireControlSnapshot';
import type { BomberSquadronSnapshot } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';
import { bomberPlanParamsFromConfig, bomberSquadronEndsAt } from '../src/systems/bomberSquadron/BomberSquadronPlan';

const host = vi.hoisted(() => ({ isolated: true, authority: true, now: 10000, revision: 1,
  fireControl: { deployments: [] } as FireControlSnapshot,
  bomber: { squadrons: [] } as BomberSquadronSnapshot, rage: 123 }));
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => host.isolated }));
vi.mock('../src/network/bridge', () => ({ bridge: {
  isHost: () => host.authority, getLocalPlayerId: () => 'owner', getSynchronizedNow: () => host.now,
  getWorldDescriptor: () => ({ worldRevision: host.revision }),
  getFireControlSnapshot: () => host.fireControl, getBomberSquadronSnapshot: () => host.bomber,
  getLatestGameState: () => ({ players: { owner: { rage: host.rage } } }),
} }));

let controller: DevScenarioController;
beforeEach(() => {
  Object.assign(host, { isolated: true, authority: true, now: 10000, revision: 1,
    fireControl: { deployments: [] }, bomber: { squadrons: [] } });
  controller = {
    config: defaultScenario(), aim: { gridX: 0, gridY: 0 }, lastAction: null,
    start: vi.fn(value => { controller.config = parseScenario(value); }),
    isCurrentScenario: config => config === controller.config,
    requireReadyForBots: vi.fn(), setPanelCollapsed: vi.fn(),
    ultimate: vi.fn(() => { controller.lastAction = { ok: true }; }), move: vi.fn(), spawn: vi.fn(),
    grid: ({ x, y }) => ({ gridX: x / 32, gridY: y / 32 }),
  } as unknown as DevScenarioController;
  vi.stubGlobal('window', { devScenario: { whenReady: vi.fn(async () => ({ ok: true })) } });
});
afterEach(() => { releaseInspectorUltimatesReview(controller); vi.unstubAllGlobals(); });

describe('Inspector ultimate review', () => {
  it.each(['single', 'mixed'])('prepares valid %s profiles at both upgrade strengths', async arsenal => {
    for (const level of ['base', 'full']) {
      await runInspectorUltimatesReview(controller, { phase: 'prepare', ultimate: 'holo', arsenal, upgrades: level });
      const config = controller.config;
      expect(config.classId).toBe('inspector_gadachs');
      expect(config.bots).toEqual([]);
      expect(config.ultimate).toBe('HOLO_OFFENSIVE');
      expect(config.constructions.map(c => c.id)).toEqual(config.tools.map(t => t.id));
      if (arsenal === 'mixed') expect(new Set(config.constructions.map(c => c.id)))
        .toEqual(new Set(FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS));
      const capacity = resolveConstructionCapacity({ gameMode: 'coop_defense', classId: config.classId,
        modifiers: getCoopDefenseItemEffectTotals(config.items).additive['construction.capacity'] });
      expect(config.constructions.reduce((sum, c) => sum + COOP_DEFENSE_CONSTRUCTIONS[c.id].capacityCost, 0))
        .toBeLessThanOrEqual(capacity);
      const profile = buildScenarioProfile(config.classId, config.upgrades, config.tools);
      for (const definition of Object.values(upgrades).filter(d => d.id.startsWith('holo_offensive_'))) {
        expect(profile.upgrades[definition.id]?.level ?? 0).toBe(level === 'full' ? definition.maxLevel : 0);
      }
      expect(controller.ultimate).not.toHaveBeenCalled();
    }
  });

  it.each(['stand', 'run', 'edge'])('prepares and activates bomber %s through the regular ultimate command', async motion => {
    await runInspectorUltimatesReview(controller, { phase: 'prepare', ultimate: 'bomber', motion, upgrades: 'full' });
    const config = controller.config;
    expect(config.ultimate).toBe('BOMBER_SQUADRON');
    expect(config.constructions).toEqual([]);
    const profile = buildScenarioProfile(config.classId, config.upgrades, config.tools);
    for (const d of Object.values(upgrades).filter(d => d.id.startsWith('bomber_squadron_'))) {
      expect(profile.upgrades[d.id]?.level).toBe(d.maxLevel);
    }
    vi.mocked(controller.ultimate).mockImplementation(() => {
      expect(controller.aim.gridY).toBe(config.player!.gridY);
      expect(controller.aim.gridX).toBeGreaterThan(config.player!.gridX);
      controller.lastAction = { ok: true };
    });
    await runInspectorUltimatesReview(controller, { phase: 'activate' });
    expect(controller.ultimate).toHaveBeenCalledExactlyOnceWith('press');
    if (motion === 'run') expect(controller.move).toHaveBeenCalledWith(0, 1, expect.any(Number));
    else expect(controller.move).not.toHaveBeenCalled();
    expect(controller.spawn).toHaveBeenCalled();
    expect(inspectorUltimatesStatus(controller)).toMatchObject({ phase: 'activated', rage: host.rage });
    await expect(runInspectorUltimatesReview(controller, { phase: 'activate' })).rejects.toThrow('Prepare');
  });

  it('reports confirmed deployments, individual copy lifetimes and bomber plans, excluding other owners', async () => {
    await runInspectorUltimatesReview(controller, { phase: 'prepare' });
    const holo = ULTIMATE_CONFIGS.HOLO_OFFENSIVE;
    const bomber = ULTIMATE_CONFIGS.BOMBER_SQUADRON;
    if (holo.type !== 'holo_offensive' || bomber.type !== 'bomber_squadron') throw Error('Config type');
    const deployment = { kind: 'holo' as const, id: 1, ownerId: 'owner', ownerColor: 0, x: 0, y: 0,
      startedAt: host.now, expiresAt: host.now + holo.copyLifetimeMs, spawnUntil: host.now + holo.spawnIntervalMs,
      copyLifetimeMs: holo.copyLifetimeMs, materializeMs: holo.materializeMs,
      copies: [{ seq: 0, sourceId: 'fc-holo:1:0', weaponId: 'TURRET_MG' as const, x: 32, y: 64, angle: 0, spawnedAt: host.now }] };
    host.fireControl = { deployments: [deployment, { ...deployment, id: 2, ownerId: 'other' }] };
    const squadron = { id: 1, ownerId: 'owner', ownerColor: 0, startedAt: host.now, angle: 0,
      params: bomberPlanParamsFromConfig(bomber), stoppedAt: null,
      anchors: Array.from({ length: bomber.droneCount }, () => ({ x: 0, y: 0 })), endsAt: 0 };
    squadron.endsAt = bomberSquadronEndsAt(squadron);
    host.bomber = { squadrons: [squadron] };
    host.now += holo.materializeMs;
    const status = inspectorUltimatesStatus(controller)!;
    expect(status).toMatchObject({ holoDeployments: 1, copyCount: deployment.copies.length, bomberSquadrons: 1,
      holo: [{ remainingMs: holo.copyLifetimeMs - holo.materializeMs,
        copies: [{ materialized: true, remainingMs: holo.copyLifetimeMs - holo.materializeMs }] }] });
    if (!('squadrons' in status)) throw Error('Review not prepared');
    expect(status.squadrons[0].drones).toHaveLength(bomber.droneCount);
    expect(status.squadrons[0].drones[0]!.drops).toHaveLength(bomber.bombsPerPass * squadron.params.passCount);
    expect(host.fireControl.deployments[0]).toEqual(deployment);
    host.revision++;
    expect(inspectorUltimatesStatus(controller)).toBeNull();
  });

  it('keeps rejected host actions visible without spawning enemies or starting movement', async () => {
    await runInspectorUltimatesReview(controller, { phase: 'prepare', motion: 'run' });
    vi.mocked(controller.ultimate).mockImplementation(() => { controller.lastAction = { ok: false, reason: 'blocked' }; });
    await expect(runInspectorUltimatesReview(controller, { phase: 'activate' })).rejects.toThrow('host binding required');
    expect(inspectorUltimatesStatus(controller)).toMatchObject({ phase: 'rejected', result: { ok: false, reason: 'blocked' } });
    expect(controller.spawn).not.toHaveBeenCalled();
    expect(controller.move).not.toHaveBeenCalled();
  });

  it('invalidates stale preparation and releases its diagnostic map', async () => {
    let ready!: (value: { ok: true }) => void;
    window.devScenario!.whenReady = () => new Promise(resolve => { ready = resolve as typeof ready; });
    const pending = runInspectorUltimatesReview(controller, {});
    controller.config = defaultScenario();
    ready({ ok: true });
    await pending;
    expect(controller.ultimate).not.toHaveBeenCalled();
    expect(inspectorUltimatesStatus(controller)).toBeNull();
    releaseInspectorUltimatesReview(controller);
    expect(isDiagnosticMapId(inspectorUltimatesScenario({}).scenario.mapId!)).toBe(false);
  });

  it('rejects invalid variants and non-isolated/non-host use before starting', async () => {
    for (const command of [{ ultimate: 'typo' }, { motion: 'edge' }, { arsenal: 'all' }, { upgrades: 3 }, { phase: 'typo' }]) {
      await expect(runInspectorUltimatesReview(controller, command)).rejects.toThrow();
    }
    host.isolated = false;
    await expect(runInspectorUltimatesReview(controller, {})).rejects.toThrow('Isolated');
    host.isolated = true; host.authority = false;
    await expect(runInspectorUltimatesReview(controller, {})).rejects.toThrow('Isolated');
    expect(controller.start).not.toHaveBeenCalled();
  });
});
