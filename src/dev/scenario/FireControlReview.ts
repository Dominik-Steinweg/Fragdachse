import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { DevScenarioController } from './controller';
import { bridge } from '../../network/bridge';
import { CELL_SIZE } from '../../config';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../../utils/coopDefenseUpgrades';
import { UTILITY_CONFIGS } from '../../loadout/LoadoutConfig';
import { defaultScenario, type DevScenario } from './config';

const steps = ['basic', 'three', 'parallel', 'destroyOriginal', 'manned', 'rejected',
  'portal', 'portalLocal', 'portalCombined', 'portalRejected'] as const;
type ReviewStep = typeof steps[number];
const projector = { gridX: 44, gridY: 29 };
/** Portal steps: full-charge throw east from the player; the exit target sits beyond the turret's own range. */
const PORTAL_STEPS: readonly ReviewStep[] = ['portal', 'portalLocal', 'portalCombined', 'portalRejected'];
const portalAim = { gridX: 62, gridY: 31 };
const portalTool = { kind: 'utility', id: 'FIRE_CONTROL_PORTAL' } as const;
const fixtures = new WeakMap<DevScenarioController, FireControlReview>();

/** Real host actions only. Rendering is owned by the normal World presentation binding. */
class FireControlReview {
  worldRevision: number | undefined;
  phase = 'preparing';
  result: unknown = null;
  beforeUse: ReturnType<FireControlReview['resources']> | null = null;
  constructor(readonly runtime: ArenaRuntime, readonly step: ReviewStep, readonly parallel: boolean) {}
  resources() {
    const id = bridge.getLocalPlayerId();
    return { cooldownUntil: bridge.getPlayerUtilityCooldownUntil(id, 'FIRE_CONTROL_RELAY'),
      charges: bridge.getPlayerUtilityChargeState(id, 'FIRE_CONTROL_RELAY'),
      portalCooldownUntil: bridge.getPlayerUtilityCooldownUntil(id, 'FIRE_CONTROL_PORTAL'),
      adrenaline: this.runtime.rpcPorts.playerLoadout.getAdrenaline(id) };
  }
  /** Real held throw at full charge through the tool path (same host gates as the input). */
  throwPortal(controller: DevScenarioController): unknown {
    const metrics = this.runtime.getWorldMetrics()!, player = this.runtime.navigationLabPort.getPlayerPosition()!;
    const target = { x: metrics.offsetX + (portalAim.gridX + .5) * CELL_SIZE, y: metrics.offsetY + (portalAim.gridY + .5) * CELL_SIZE };
    const id = bridge.getLocalPlayerId(), now = bridge.getSynchronizedNow(), heldActionId = `fc-portal:${now}`;
    const activation = UTILITY_CONFIGS.FIRE_CONTROL_PORTAL.activation;
    const full = activation.type === 'charged_throw' ? activation.fullChargeDuration : 0;
    this.runtime.rpcPorts.playerLoadout.startUtilityHeldAction(id, heldActionId, 'charged_throw', now - full, portalTool);
    controller.lastAction = this.runtime.rpcPorts.construction.useInspectorUtility(id, portalTool,
      Math.atan2(target.y - player.y, target.x - player.x), target.x, target.y, now, { heldActionId });
    return structuredClone(controller.lastAction);
  }
  status() {
    if (this.worldRevision !== this.runtime.getWorldDescriptor()?.worldRevision) return null;
    return { step: this.step, parallel: this.parallel, phase: this.phase, result: this.result, beforeUse: this.beforeUse,
      resources: this.resources(), ...this.runtime.devScenarioPort.readFireControl(),
      occupancy: this.runtime.getTurretControlState(bridge.getLocalPlayerId()) ?? null };
  }
  activate(controller: DevScenarioController): void {
    if (this.phase !== 'prepared') throw Error('Prepare this review step before activation');
    this.beforeUse = structuredClone(this.resources());
    if (PORTAL_STEPS.includes(this.step)) { this.activatePortal(controller); return; }
    const metrics = this.runtime.getWorldMetrics()!, player = this.runtime.navigationLabPort.getPlayerPosition()!;
    const target = { x: metrics.offsetX + (projector.gridX + .5) * CELL_SIZE,
      y: metrics.offsetY + (projector.gridY + .5) * CELL_SIZE };
    controller.lastAction = this.runtime.rpcPorts.construction.useInspectorUtility(bridge.getLocalPlayerId(),
      { kind: 'utility', id: 'FIRE_CONTROL_RELAY' }, Math.atan2(target.y - player.y, target.x - player.x),
      target.x, target.y, bridge.getSynchronizedNow());
    this.result = structuredClone(controller.lastAction);
    this.phase = 'activated';
    // Targets appear only after activation so no pre-existing original salvo obscures the pause.
    if (this.step !== 'rejected') controller.spawn('rabid-badger', true, 1000000, { gridX: 47, gridY: 28 }, false);
  }
  private activatePortal(controller: DevScenarioController): void {
    if (this.step === 'portalCombined') {
      const metrics = this.runtime.getWorldMetrics()!, player = this.runtime.navigationLabPort.getPlayerPosition()!;
      const point = { x: metrics.offsetX + (projector.gridX + .5) * CELL_SIZE, y: metrics.offsetY + (projector.gridY + .5) * CELL_SIZE };
      const copies = this.runtime.rpcPorts.construction.useInspectorUtility(bridge.getLocalPlayerId(),
        { kind: 'utility', id: 'FIRE_CONTROL_RELAY' }, Math.atan2(point.y - player.y, point.x - player.x),
        point.x, point.y, bridge.getSynchronizedNow());
      if (!copies.ok) throw Error('Copies rejected: ' + JSON.stringify(copies));
    }
    this.result = this.throwPortal(controller);
    this.phase = 'activated';
    // portalLocal: only a target next to the turret (local fire); resolve adds one at the exit.
    if (this.step === 'portalLocal') controller.spawn('rabid-badger', true, 1000000, { gridX: 38, gridY: 29 }, false);
    else if (this.step !== 'portalRejected') controller.spawn('rabid-badger', true, 1000000, { gridX: portalAim.gridX + 2, gridY: portalAim.gridY }, false);
  }
  resolve(controller: DevScenarioController): void {
    if (this.phase !== 'activated') throw Error('Activate this review step first');
    if (this.step === 'portalLocal') {
      controller.spawn('rabid-badger', true, 1000000, { gridX: portalAim.gridX + 2, gridY: portalAim.gridY }, false);
      this.phase = 'resolved';
      return;
    }
    const deployment = this.runtime.devScenarioPort.readFireControl().snapshot.deployments[0];
    if (deployment?.kind !== 'copies') throw Error('Active copies required');
    const id = deployment.copies[0].originalId;
    if (this.step === 'destroyOriginal') {
      const rock = this.runtime.getScenarioObservation().constructions.find(r => r.id === id);
      if (!rock) throw Error('Original missing');
      // Existing isolated port applies resolved construction damage through WorldObjectMutationRuntime.
      // Despite its historical name it accepts any construction, including these real built turrets.
      this.result = this.runtime.devScenarioPort.damageWatchtower(id, rock.hp);
    } else if (this.step === 'manned') {
      const turret = this.runtime.getTurretDefinitions().find(t => t.id === id);
      if (!turret) throw Error('Original missing');
      controller.teleport(controller.grid({ x: turret.x, y: turret.y + 64 }), false);
      bridge.sendTurretControlRequest({ action: 'enter', turretId: id });
      if (!this.runtime.getTurretControlState(bridge.getLocalPlayerId())) throw Error('Manning rejected');
    } else throw Error('resolve is only valid for destroyOriginal, manned or portalLocal');
    this.phase = 'resolved';
  }
}

export function releaseFireControlReview(controller: DevScenarioController): void {
  if (!fixtures.has(controller)) return;
  fixtures.delete(controller);
}

export function fireControlReviewStatus(controller: DevScenarioController) {
  return fixtures.get(controller)?.status() ?? null;
}

/** phase=prepare/activate/resolve permits before/materializing/firing capture barriers.
 * Omitting phase runs the complete step (including destruction/manning). Each setup starts a real Activity. */
export async function runFireControlReview(controller: DevScenarioController, runtime: ArenaRuntime,
  command: Record<string, unknown>): Promise<void> {
  if (!isDevScenarioMode() || !bridge.isHost()) throw Error('Isolated dev host required');
  const step = command.step ?? 'basic', phase = command.phase;
  if (command.parallel !== undefined && typeof command.parallel !== 'boolean') throw Error('parallel must be boolean');
  // manned defaults to D13; parallel=true demonstrates E17 in a separate real Activity.
  const parallel = step === 'parallel' || (step === 'manned' && command.parallel === true);
  if (!steps.includes(step as ReviewStep)) throw Error('Invalid fireControlReview step');
  if (phase !== undefined && !['prepare', 'activate', 'resolve'].includes(String(phase))) throw Error('Invalid fireControlReview phase');
  if (phase === 'activate' || phase === 'resolve') {
    controller.requireReadyForBots();
    const fixture = fixtures.get(controller);
    if (!fixture || fixture.step !== step || !fixture.status()) throw Error('Prepare this step in the current World first');
    if (phase === 'activate') fixture.activate(controller); else fixture.resolve(controller);
    return;
  }
  releaseFireControlReview(controller);
  let fixture: FireControlReview | undefined;
  try {
    const scenario: DevScenario = defaultScenario('inspector_gadachs');
    const portal = PORTAL_STEPS.includes(step as ReviewStep);
    Object.assign(scenario, { mapId: '4', timeOfDay: controller.config.timeOfDay,
      player: { gridX: 42, gridY: 31 }, hideAim: true,
      tools: [{ kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' },
        { kind: 'construction', id: 'flame_turret' }, { kind: 'utility', id: 'FIRE_CONTROL_RELAY' },
        ...(portal ? [portalTool] : [])],
      upgrades: { inspector_construction_slots: COOP_DEFENSE_UPGRADE_DEFINITIONS.inspector_construction_slots.maxLevel,
        ...(portal ? { unlock_fire_control_portal: 1 } : {}),
        ...(step === 'portalLocal' ? { fire_control_portal_duration: 1, fire_control_portal_local_fire: 1 } : {}),
        ...(step === 'three' ? { fire_control_relay_connections: COOP_DEFENSE_UPGRADE_DEFINITIONS.fire_control_relay_connections.maxLevel } : {}),
        ...(parallel ? { fire_control_relay_parallel: 1 } : {}) },
      constructions: step === 'rejected' || step === 'portalRejected' ? [] : portal
        ? [{ id: 'rocket_turret', gridX: 36, gridY: 29 }]
        : step === 'three'
        ? [{ id: 'rocket_turret', gridX: 40, gridY: 25 }, { id: 'machine_gun_turret', gridX: 44, gridY: 25 },
          { id: 'flame_turret', gridX: 48, gridY: 25 }]
        : [{ id: 'rocket_turret', gridX: 40, gridY: 25 }],
    });
    controller.start(scenario);
    fixture = new FireControlReview(runtime, step as ReviewStep, parallel);
    fixtures.set(controller, fixture);
    const config = controller.config;
    const ready = await window.devScenario!.whenReady(180000);
    if (!controller.isCurrentScenario(config)) return;
    if (!ready.ok) throw Error(ready.error);
    fixture.worldRevision = runtime.getWorldDescriptor()?.worldRevision;
    fixture.phase = 'prepared';
    controller.aim = portal ? portalAim : { gridX: 44, gridY: 27 };
    controller.cameraAtTarget = true; controller.zoom = 1.6;
    controller.setPanelCollapsed(true);
    if (phase !== 'prepare') {
      fixture.activate(controller);
      if (step === 'destroyOriginal' || step === 'manned' || step === 'portalLocal') fixture.resolve(controller);
    }
  } catch (error) {
    if (!fixture || fixtures.get(controller) === fixture) {
      fixtures.delete(controller);
    }
    throw error;
  }
}
