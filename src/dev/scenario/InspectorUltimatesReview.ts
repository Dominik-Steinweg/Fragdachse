import type { DevScenarioController } from './controller';
import { defaultScenario, type DevScenario } from './config';
import { registerDiagnosticMap } from '../../config/coopDefenseMaps';
import { COOP_DEFENSE_CONSTRUCTIONS, resolveConstructionCapacity } from '../../config/coopDefenseConstructions';
import { getCoopDefenseItemAffixDefinition } from '../../config/coopDefenseItems';
import { sanitizeCoopDefenseItem } from '../../utils/coopDefenseItems';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS as upgrades } from '../../utils/coopDefenseUpgrades';
import { bridge } from '../../network/bridge';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { bomberDronePose, bomberDrops } from '../../systems/bomberSquadron/BomberSquadronPlan';
import type { ConstructionId, LoadoutUseResult } from '../../types';

const MAP = 'inspector-ultimates-review';
const templates: readonly ConstructionId[] = ['machine_gun_turret', 'rocket_turret', 'spore_turret',
  'flame_turret', 'gravity_turret', 'slow_bubble_turret'];
const upgradeIds = {
  holo: ['holo_offensive_duration', 'holo_offensive_interval', 'holo_offensive_rage_required', 'holo_offensive_injector'],
  bomber: ['bomber_squadron_size', 'bomber_squadron_bomb_count', 'bomber_squadron_fire_chunks', 'bomber_squadron_second_pass'],
};

interface Options {
  ultimate: 'holo' | 'bomber';
  arsenal: 'single' | 'mixed';
  motion: 'stand' | 'run' | 'edge';
  upgrades: 'base' | 'full';
}
interface Fixture {
  unregister: () => void;
  config: DevScenario;
  options: Options;
  worldRevision?: number;
  phase: 'preparing' | 'prepared' | 'activated' | 'rejected';
  result: LoadoutUseResult | null;
  activatedAt: number | null;
}
const fixtures = new WeakMap<DevScenarioController, Fixture>();

function choice<T extends string>(value: unknown, fallback: T, values: readonly T[], name: string): T {
  const result = value ?? fallback;
  if (!values.includes(result as T)) throw Error(`Invalid inspectorUltimates ${name}: ${String(result)}`);
  return result as T;
}

/** Profiles go through the regular scenario sanitizer, dependency resolver and loadout commit. */
export function inspectorUltimatesScenario(command: Record<string, unknown>, timeOfDay = 720) {
  const options: Options = {
    ultimate: choice(command.ultimate, 'holo', ['holo', 'bomber'], 'ultimate'),
    arsenal: choice(command.arsenal, 'single', ['single', 'mixed'], 'arsenal'),
    motion: choice(command.motion, 'stand', ['stand', 'run', 'edge'], 'motion'),
    upgrades: choice(command.upgrades, 'base', ['base', 'full'], 'upgrades'),
  };
  if (options.ultimate === 'holo' && options.motion === 'edge') throw Error('edge is a bomber variant');
  if (options.ultimate === 'bomber' && options.arsenal !== 'single') throw Error('arsenal is a holo parameter');
  const originals = options.ultimate === 'holo' ? options.arsenal === 'mixed' ? templates : templates.slice(0, 1) : [];
  const scenario: DevScenario = {
    ...defaultScenario('inspector_gadachs'), mapId: MAP, timeOfDay, hideAim: true,
    ultimate: options.ultimate === 'holo' ? 'HOLO_OFFENSIVE' : 'BOMBER_SQUADRON',
    player: options.motion === 'edge' ? { gridX: 82, gridY: 4 } : { gridX: 30, gridY: 30 },
    tools: originals.map(id => ({ kind: 'construction', id })),
    upgrades: {
      inspector_construction_slots: upgrades.inspector_construction_slots.maxLevel,
      ...(options.upgrades === 'full'
        ? Object.fromEntries(upgradeIds[options.ultimate].map(id => [id, upgrades[id].maxLevel])) : {}),
    },
    constructions: originals.map((id, index) => ({ id, gridX: 20 + index * 3, gridY: 18 })),
  };
  const capacityNeeded = originals.reduce((sum, id) => sum + COOP_DEFENSE_CONSTRUCTIONS[id].capacityCost, 0)
    - resolveConstructionCapacity({ gameMode: 'coop_defense', classId: scenario.classId });
  if (capacityNeeded > 0) {
    // The mixed arsenal exceeds base capacity. A regular scenario item funds it without combat bonuses.
    const affix = getCoopDefenseItemAffixDefinition('construction_capacity')!;
    const item = sanitizeCoopDefenseItem({ uid: 'inspector-review-capacity', slot: 'gloves', rarity: 'blue',
      itemLevel: Math.max(1, 1 + Math.ceil((capacityNeeded - affix.maxAtLevel1) / affix.perLevel)),
      baseValue: 0, affixes: [{ affixId: affix.id, value: capacityNeeded }] });
    if (!item) throw Error('Unable to fund review construction capacity');
    scenario.items = [item];
  }
  return { options, scenario };
}

export function releaseInspectorUltimatesReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.unregister();
  fixtures.delete(controller);
}

/** Only confirmed read models: no local simulation of copy spawning, flight or damage. */
export function inspectorUltimatesStatus(controller: DevScenarioController) {
  const fixture = fixtures.get(controller);
  if (!fixture || !controller.isCurrentScenario(fixture.config)) return null;
  if (fixture.phase === 'preparing') return { ...fixture.options, phase: fixture.phase };
  if (fixture.worldRevision !== bridge.getWorldDescriptor()?.worldRevision) return null;
  const now = bridge.getSynchronizedNow(), ownerId = bridge.getLocalPlayerId();
  const holo = bridge.getFireControlSnapshot().deployments
    .filter(d => d.kind === 'holo').filter(d => d.ownerId === ownerId)
    .map(d => ({ ...d, remainingMs: Math.max(0, d.expiresAt - now),
      spawnRemainingMs: Math.max(0, d.spawnUntil - now),
      copies: d.copies.map(c => ({ ...c, grid: controller.grid(c),
        remainingMs: Math.max(0, c.spawnedAt + d.copyLifetimeMs - now),
        materialized: now >= c.spawnedAt + d.materializeMs })) }));
  const squadrons = bridge.getBomberSquadronSnapshot().squadrons.filter(s => s.ownerId === ownerId)
    .map(s => ({ ...s, remainingMs: Math.max(0, s.endsAt - now),
      drones: s.anchors.map((anchor, index) => anchor ? {
        index, pose: bomberDronePose(s, index, anchor, now), drops: bomberDrops(s, index, anchor),
      } : null) }));
  return { ...fixture.options, phase: fixture.phase, result: fixture.result, activatedAt: fixture.activatedAt, now,
    // PlayerNetState is published by the host; immediately after pressing Q it may be one tick old.
    rage: bridge.getLatestGameState()?.players[ownerId]?.rage ?? null,
    holoDeployments: holo.length, copyCount: holo.reduce((n, d) => n + d.copies.length, 0),
    bomberSquadrons: squadrons.length, holo, squadrons };
}

function activate(controller: DevScenarioController, fixture: Fixture): void {
  controller.requireReadyForBots();
  if (fixture.phase !== 'prepared' || !inspectorUltimatesStatus(controller)) throw Error('Prepare this review in the current World first');
  const player = fixture.config.player!;
  // East is fixed at activation, independently of the capture camera/aim point.
  controller.aim = { gridX: player.gridX + 1, gridY: player.gridY };
  controller.ultimate('press');
  fixture.result = structuredClone(controller.lastAction) as LoadoutUseResult;
  if (!fixture.result.ok) {
    fixture.phase = 'rejected';
    throw Error(`Inspector ultimate rejected (host binding required): ${JSON.stringify(fixture.result)}`);
  }
  fixture.activatedAt = bridge.getSynchronizedNow();
  fixture.phase = 'activated';
  // Spawn only after Q, keeping activation free of earlier original-turret salvos.
  const edge = fixture.options.motion === 'edge';
  const xs = fixture.options.ultimate === 'holo' ? [25, 35] : edge ? [85, 88] : [35, 41, 47];
  const ys = edge ? [2, 6, 10] : fixture.options.motion === 'run' ? [28, 34, 40, 46, 52] : [26, 30, 34];
  for (const gridX of xs) for (const gridY of ys) {
    controller.spawn('zombie-badger', true, 10000000, { gridX, gridY }, false);
  }
  if (fixture.options.motion === 'run') controller.move(0, 1, 2400);
  controller.aim = edge ? { gridX: 84, gridY: 7 }
    : { gridX: fixture.options.ultimate === 'holo' ? 30 : 39, gridY: fixture.options.motion === 'run' ? 41 : 30 };
  controller.lastAction = { inspectorUltimates: fixture.result };
}

/** action=inspectorUltimates, phase=prepare|activate (omitted: both), ultimate=holo|bomber,
 * arsenal=single|mixed, motion=stand|run|edge, upgrades=base|full. Capture via fixed scenario steps. */
export async function runInspectorUltimatesReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  if (!isDevScenarioMode() || !bridge.isHost()) throw Error('Isolated dev host required');
  const phase = choice(command.phase, 'start', ['start', 'prepare', 'activate'], 'phase');
  if (phase === 'activate') {
    const fixture = fixtures.get(controller);
    if (!fixture) throw Error('Prepare inspectorUltimates first');
    for (const key of ['ultimate', 'arsenal', 'motion', 'upgrades'] as const) {
      if (command[key] !== undefined && command[key] !== fixture.options[key]) throw Error(`Prepared ${key} differs; prepare a new review`);
    }
    activate(controller, fixture);
    return;
  }
  const { scenario, options } = inspectorUltimatesScenario(command, controller.config.timeOfDay);
  releaseInspectorUltimatesReview(controller);
  const unregister = registerDiagnosticMap({
    mapId: MAP, arenaWidthCells: 90, arenaHeightCells: 70, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', tutorialDurationMs: 0,
    balanceReferenceDurationSec: 3600, objective: 'survive', surviveDurationSec: 3600, respawnsPerPlayer: 3,
    bases: [], persistentBase: { baseId: 'review-base', anchor: { gridX: 70, gridY: 54 } },
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  });
  let fixture: Fixture | undefined;
  try {
    controller.start(scenario);
    fixture = { unregister, config: controller.config, options, phase: 'preparing', result: null, activatedAt: null };
    fixtures.set(controller, fixture);
    const ready = await window.devScenario!.whenReady(180000);
    if (!controller.isCurrentScenario(fixture.config)) return;
    if (!ready.ok) throw Error(ready.error);
    fixture.worldRevision = bridge.getWorldDescriptor()?.worldRevision;
    fixture.phase = 'prepared';
    controller.cameraAtTarget = true;
    controller.zoom = options.motion === 'run' ? 0.65 : options.ultimate === 'holo' ? 1.2 : 0.85;
    controller.aim = { ...scenario.player! };
    controller.setPanelCollapsed(true);
    if (phase !== 'prepare') activate(controller, fixture);
  } catch (error) {
    if (!fixture) unregister();
    else if (fixtures.get(controller) === fixture && fixture.phase !== 'rejected') releaseInspectorUltimatesReview(controller);
    throw error;
  }
}
