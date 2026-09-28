import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { WeaponSlot } from '../../types';
import { bridge } from '../../network/bridge';
import { addLocalScenarioBotPeer } from '../../network/peer/LocalScenarioSession';
import { quantizeAngle } from '../../utils/angle';
import { UTILITY_CONFIGS } from '../../loadout/LoadoutConfig';
import { scenarioLoadout, type DevScenario } from './config';

interface BotState {
  id: string;
  movement: { dx: number; dy: number; until: number };
  target: { x: number; y: number } | null;
  trigger: WeaponSlot | null;
  inputStarted: boolean;
  held: { instanceId: string; heldId?: string; releaseAt: number } | null;
}

/**
 * Scripted bot badgers of the isolated dev host. They join through the normal room handshake and
 * then act exclusively through the same host ports as the local scenario player.
 */
export class ScenarioBots {
  private readonly bots: BotState[] = [];
  private sequence = 0;

  constructor(private readonly runtime: ArenaRuntime, private readonly now: () => number) {}

  get count(): number { return this.bots.length; }
  ids(): string[] { return this.bots.map(bot => bot.id); }

  /** Lobby step: bot peers persist for the page; every (re)start commits their loadouts again. */
  prepare(config: DevScenario): void {
    while (this.bots.length < config.bots.length) {
      this.bots.push({ id: addLocalScenarioBotPeer(), movement: { dx: 0, dy: 0, until: 0 }, target: null, trigger: null, inputStarted: false, held: null });
    }
    config.bots.forEach((spec, index) => {
      const bot = this.bots[index];
      bot.movement = { dx: 0, dy: 0, until: 0 }; bot.target = null; bot.trigger = null; bot.held = null;
      bridge.setDevScenarioBotState(bot.id, { name: spec.name, commit: scenarioLoadout({ ...config, weapon1: spec.weapon1, weapon2: spec.weapon2 }) });
    });
  }

  bot(index: number): BotState {
    const bot = this.bots[index];
    if (!bot) throw new Error(`Bot ${index} existiert nicht.`);
    return bot;
  }

  position(index: number) { return this.runtime.devScenarioPort.getPlayer(this.bot(index).id); }
  place(index: number, x: number, y: number): void {
    const bot = this.bot(index);
    bot.movement = { dx: 0, dy: 0, until: 0 };
    this.runtime.devScenarioPort.placePlayer(bot.id, x, y);
    this.runtime.devScenarioPort.healPlayer(bot.id);
  }
  move(index: number, dx: number, dy: number, durationMs: number): void {
    const length = Math.max(1, Math.hypot(dx, dy));
    this.bot(index).movement = { dx: dx / length, dy: dy / length, until: this.now() + durationMs };
  }
  aim(index: number, target: { x: number; y: number } | null): void { this.bot(index).target = target; }
  hold(index: number, slot: WeaponSlot | null): void {
    const bot = this.bot(index);
    bot.trigger = slot; bot.inputStarted = slot !== null;
  }
  burrow(index: number, enter: boolean): void {
    this.runtime.rpcPorts.playerLoadout.handleBurrowRequest(this.bot(index).id, enter);
  }
  /** Grants a pickup-only utility and uses it; charged utilities release after their full charge. */
  temporaryUtility(index: number, utilityId: string, chargeMs?: number): void {
    this.useTemporaryUtility(this.bot(index), utilityId, chargeMs);
  }

  /** `chargeMs` shortens the charge of charged utilities (e.g. a shorter throw); default is a full charge. */
  useTemporaryUtility(bot: Pick<BotState, 'id' | 'held'>, utilityId: string, chargeMs?: number): void {
    const config = UTILITY_CONFIGS[utilityId];
    if (!config) throw new Error(`Unbekanntes Utility: ${utilityId}`);
    const instanceId = this.runtime.devScenarioPort.addTemporaryUtility(bot.id, config);
    if (!instanceId) throw new Error('Temporäres Utility wurde abgelehnt.');
    const activation = this.runtime.rpcPorts.playerLoadout.getTemporaryUtilityConfig(bot.id, instanceId)?.activation;
    if (activation && (activation.type === 'charged_throw' || activation.type === 'charged_gate' || activation.type === 'charged_alternate')) {
      const heldId = `dev-temp:${++this.sequence}`;
      if (!this.runtime.rpcPorts.playerLoadout.startUtilityHeldAction(bot.id, heldId, activation.type, bridge.getSynchronizedNow(), undefined, instanceId)) {
        throw new Error('Utility-Aufladung abgelehnt.');
      }
      bot.held = { instanceId, heldId, releaseAt: this.now() + Math.min(activation.fullChargeDuration, chargeMs ?? activation.fullChargeDuration) };
    } else {
      bot.held = { instanceId, releaseAt: this.now() };
    }
  }

  /** Releases a pending temporary utility of any player towards `target` once it is fully charged. */
  releaseDue(bot: Pick<BotState, 'id' | 'held'>, target: { x: number; y: number } | null): void {
    if (!bot.held || this.now() < bot.held.releaseAt) return;
    const player = this.runtime.devScenarioPort.getPlayer(bot.id);
    if (!player) return;
    const aim = target ?? { x: player.x + 1, y: player.y };
    this.runtime.rpcPorts.playerLoadout.usePlayerAction({ category: 'utility', playerId: bot.id,
      angle: Math.atan2(aim.y - player.y, aim.x - player.x), targetX: aim.x, targetY: aim.y,
      hostNowMs: bridge.getSynchronizedNow(), source: { kind: 'temporary', instanceId: bot.held.instanceId },
      params: { heldActionId: bot.held.heldId, temporaryUtilityInstanceId: bot.held.instanceId } });
    bot.held = null;
  }

  /** Bots load instantly; they acknowledge every world so the normal ready barrier completes. */
  acknowledgeWorld(): void {
    for (const bot of this.bots) bridge.setDevScenarioBotState(bot.id, { worldLoaded: true });
  }

  /** Host frame: publish bot inputs and fire held weapons through the regular action port. */
  update(): void {
    const now = this.now();
    this.acknowledgeWorld();
    for (const bot of this.bots) {
      const player = this.runtime.devScenarioPort.getPlayer(bot.id);
      if (!player) continue;
      const target = bot.target ?? { x: player.x + 1, y: player.y };
      const angle = Math.atan2(target.y - player.y, target.x - player.x);
      const moving = now < bot.movement.until;
      bridge.setDevScenarioBotState(bot.id, { input: { dx: moving ? bot.movement.dx : 0, dy: moving ? bot.movement.dy : 0, aim: quantizeAngle(angle), dashHeld: false } });
      if (bot.trigger && player.alive) {
        this.runtime.weaponBalanceLabPort.useWeaponAction(bot.trigger, bot.id, angle, target.x, target.y,
          bridge.getSynchronizedNow(), ++this.sequence, bot.inputStarted);
        bot.inputStarted = false;
      }
      this.releaseDue(bot, bot.target);
    }
  }

  stop(): void {
    for (const bot of this.bots) { bot.trigger = null; bot.movement = { dx: 0, dy: 0, until: 0 }; bot.held = null; }
  }
}
