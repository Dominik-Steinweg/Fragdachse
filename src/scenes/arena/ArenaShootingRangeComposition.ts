import { bridge } from '../../network/bridge';
import { CELL_SIZE, COOP_DEFENSE_NAV_TICK_INTERVAL_MS } from '../../config';
import { isLobbyWorldDefinitionId } from '../../config/authoring/lobbyWorld';
import { EnemyManager } from '../../entities/EnemyManager';
import { WaterGeometry } from '../../arena/WaterGeometry';
import { ShootingRangeWorldBinding } from '../../shootingRange/ShootingRangeWorldBinding';
import { SHOOTING_RANGE, shootingRangeControlPosition, isShootingRangeBuildReserved } from '../../shootingRange/ShootingRangeLayout';
import { interactionCandidateScore, WORLD_INTERACTION_RULES } from '../../systems/WorldInteractionSelection';
import { NecromancySystem } from '../../systems/NecromancySystem';
import { FlowFieldCoordinator } from '../../systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldRunner } from '../../systems/flowfield/FlowFieldRunnerFactory';
import { createFlowFieldTuning } from '../../systems/flowfield/FlowFieldSources';
import { EnemyIntentSystem } from '../../systems/navigation/EnemyIntentSystem';
import { EnemyAiTargetCatalog } from '../../systems/EnemyAiTargetCatalog';
import { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import { ShootingRangeRenderer } from '../../effects/ShootingRangeRenderer';
import type { ArenaWorldGameplay, ArenaWorldGameplayCompositionInput } from './ArenaWorldGameplayComposition';

export function composeShootingRangeEnemies(input: ArenaWorldGameplayCompositionInput, gameplay: ArenaWorldGameplay): void {
  if (!isLobbyWorldDefinitionId(input.world.descriptor.definitionId)) return;
  const enemies = new EnemyManager(input.scene);
  enemies.setWorldMetrics(input.world.metrics);
  enemies.setWaterGeometry(new WaterGeometry(input.layout.water ?? [], input.world.metrics));
  enemies.setLightingSystem(input.renderers.lighting);
  enemies.setHealthBarRenderer(input.renderers.healthBars);
  enemies.setEntityBurnGpuController(input.renderers.entityBurnGpu);
  const range = new ShootingRangeWorldBinding(enemies, input.world.metrics, gameplay.combatSystem!, bridge.isHost(),
    () => bridge.getConnectedPlayers().map(player => player.id));
  gameplay.shootingRange = range;
  const renderer = new ShootingRangeRenderer(input.scene, input.world.metrics);
  input.worldRuntime.bind({ update: () => renderer.sync(range.snapshot(), bridge.getSynchronizedNow()), destroy: () => renderer.destroy() });
  input.placementSystem.setBuildReservation(isShootingRangeBuildReserved);
  input.worldRuntime.bind({ destroy: () => {
    input.placementSystem.setBuildReservation(null);
    range.destroy();
    if (gameplay.shootingRange === range) gameplay.shootingRange = null;
  } });
}

export function bindShootingRangeGameplay(input: ArenaWorldGameplayCompositionInput, gameplay: ArenaWorldGameplay): void {
  const range = gameplay.shootingRange;
  const player = gameplay.player;
  if (!range || !bridge.isHost() || !player) return;
  const { ctx, worldRuntime, flow } = input;
  const combat = gameplay.combatSystem!;
  const metrics = input.world.metrics;
  const navMetrics = { cols: metrics.gridCols * 2 + 1, rows: metrics.gridRows * 2 + 1,
    cellSize: CELL_SIZE / 2, pointOffset: 0, arenaOffsetX: metrics.offsetX, arenaOffsetY: metrics.offsetY };
  range.navigation = new FlowFieldCoordinator({ metrics: navMetrics, tuning: createFlowFieldTuning(),
    staticKind: new Uint8Array(navMetrics.cols * navMetrics.rows), bases: [], activeBaseIds: new Set(),
    obstacleCellProvider: () => [], geometryProvider: () => gameplay.geometry!.snapshotMovementGeometry(),
    runner: createFlowFieldRunner(), navTickIntervalMs: COOP_DEFENSE_NAV_TICK_INTERVAL_MS,
    generationId: gameplay.combatRuntime!.scope.runtimeGeneration });
  range.ground = EnemyFlowFieldService.fromView(range.navigation.registerField('shooting-range-ground', { goalMode: 'dynamic' }));
  range.intents = new EnemyIntentSystem(range.navigation, new EnemyAiTargetCatalog());
  range.enemies.setNavigationIntents(range.intents);
  range.necromancy = new NecromancySystem(ctx.playerManager, range.enemies, combat,
    gameplay.automatedWeaponExecution!, range.allyFlowFields,
    (id, stat, base) => player.getPlayerCombatIntegrationPort().modifier.getResolvedStat(id, stat, base));
  range.necromancy.setCorpseSink({
    onCorpseAdded: (id, x, y, size, lifetime) => bridge.broadcastCorpseMarker(id, x, y, size, lifetime),
    onCorpseRemoved: id => bridge.broadcastCorpseMarkerRemoval(id),
  });
  range.enemies.setLethalDamageGuard(enemy => range.necromancy!.handleLethalDamage(enemy));
  const supply = player.bindArtificialAdrenalineSupply(id => {
    const entity = ctx.playerManager.getPlayer(id);
    return !!entity?.active && combat.isAlive(id) && bridge.getWorldParticipation(id) === 'interactive'
      && range.suppliesPosition(entity.x, entity.y);
  });
  bridge.registerShootingRangeHandler((id, request) => {
    const entity = ctx.playerManager.getPlayer(id);
    if (!entity?.active || !combat.isAlive(id) || bridge.getWorldParticipation(id) !== 'interactive'
      || !flow.getPlayerCapabilities(id).canInteract || bridge.isArenaCountdownActive()
      || player.isControllingTurret(id) || player.getBurrowPhase(id) !== 'idle'
      || combat.isStunned(id, bridge.getSynchronizedNow()) || ctx.hostPhysics.getDashPhase(id) !== 0 || ctx.hostPhysics.hasForcedMovement(id)) return false;
    const position = shootingRangeControlPosition(metrics, request.control);
    if (interactionCandidateScore({ x: entity.x, y: entity.y, angle: entity.getAimAngle() },
      { ...position, radius: SHOOTING_RANGE.interactionRadius }) < WORLD_INTERACTION_RULES.minimumScore) return false;
    const accepted = range.runtime.request(request, bridge.getSynchronizedNow());
    player.refreshArtificialAdrenalineSupply();
    return accepted;
  });
  worldRuntime.bind({ destroy: () => { bridge.registerShootingRangeHandler(null); supply.destroy(); } });
  range.runtime.request({ control: 'power', action: 'enable', session: 0 }, bridge.getSynchronizedNow());
}
