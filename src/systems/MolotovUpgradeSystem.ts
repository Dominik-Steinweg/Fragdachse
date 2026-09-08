import { GROUND_FIRE_CELL_SIZE, type FireSystem } from '../effects/FireSystem';
import type { ActiveBurnSource } from '../combat/rules/BurnStateMachine';
import type { MolotovFirewalkerEffect, MolotovWildfireDeath } from '../types';
import type { FireChunkBurstPort } from './FlamethrowerUpgradeSystem';

export interface MolotovPlayerRead {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly positionRevision: number;
  getCollisionRadius(): number;
}

interface FirewalkerState {
  expiresAt: number;
  effect: MolotovFirewalkerEffect;
}

interface PlayerPosition { x: number; y: number; revision: number }

/** World-owned, host-only Molotov reactions. Rendering never creates fire or extends status. */
export class MolotovUpgradeSystem {
  private readonly walkers = new Map<string, FirewalkerState>();
  private readonly positions = new Map<string, PlayerPosition>();

  constructor(
    private readonly getPlayers: () => readonly MolotovPlayerRead[],
    private readonly isAlive: (playerId: string) => boolean,
    private readonly isBurrowed: (playerId: string) => boolean,
    private readonly fire: Pick<FireSystem, 'collectContacts' | 'hostRefreshGroundCellsAlongSegment'>,
    private readonly chunks: FireChunkBurstPort,
  ) {}

  handleEnemyDeath(
    enemyId: string, x: number, y: number, burns: readonly ActiveBurnSource[],
    now: number, wildfire?: MolotovWildfireDeath,
  ): void {
    // The source zone may already have expired. The captured panic state and live burn
    // sources are sufficient; querying current Molotov zones would lose valid deaths.
    if (!wildfire || !burns.some(source => source.sourceKey === wildfire.sourceKey
      && source.attackerId === wildfire.ownerId && source.stackCount > 0)) return;
    this.chunks.hostCreateFireChunkBurst(wildfire.ownerId, x, y, wildfire.burst,
      `molotov-death:${wildfire.ownerId}:${enemyId}`, now);
  }

  hostUpdate(now: number): void {
    const players = this.getPlayers();
    const present = new Set(players.map(player => player.id));
    for (const id of new Set([...this.positions.keys(), ...this.walkers.keys()]))
      if (!present.has(id)) this.removePlayer(id);
    for (const player of players) {
      const id = player.id;
      if (!this.isAlive(id)) { this.removePlayer(id); continue; }
      if ((this.walkers.get(id)?.expiresAt ?? 0) <= now) this.walkers.delete(id);
      if (this.isBurrowed(id)) { this.positions.delete(id); continue; }

      const previous = this.positions.get(id);
      const continuous = previous?.revision === player.positionRevision;
      const fromX = continuous ? previous.x : player.x;
      const fromY = continuous ? previous.y : player.y;
      const steps = Math.max(1, Math.ceil(Math.hypot(player.x - fromX, player.y - fromY)
        / (GROUND_FIRE_CELL_SIZE * 0.5)));
      let lastX = fromX, lastY = fromY;
      // Sample the swept footprint so fast movement cannot skip a narrow wildfire trail.
      for (let step = 0; step <= steps; step += 1) {
        const x = fromX + (player.x - fromX) * step / steps;
        const y = fromY + (player.y - fromY) * step / steps;
        const wasActive = this.walkers.has(id);
        const contact = this.fire.collectContacts(x, y, player.getCollisionRadius(), now)
          .find(source => source.ownerId === id && (source.firewalker?.durationMs ?? 0) > 0);
        if (contact?.firewalker) {
          this.walkers.set(id, {
            expiresAt: now + contact.firewalker.durationMs,
            effect: structuredClone(contact.firewalker),
          });
        }
        const state = this.walkers.get(id);
        if (state) {
          this.fire.hostRefreshGroundCellsAlongSegment(wasActive ? lastX : x, wasActive ? lastY : y, x, y, {
            sourceKey: `molotov-firewalker:${id}`, ownerId: id,
            durationMs: state.effect.trailDurationMs,
            damagePerTick: state.effect.trailDamagePerTick, burn: state.effect.burn,
            sourceId: 'ground_fire.molotov_firewalker',
          }, now);
        }
        lastX = x; lastY = y;
      }
      this.positions.set(id, { x: player.x, y: player.y, revision: player.positionRevision });
    }
  }

  isActive(playerId: string, now: number): boolean {
    return this.isAlive(playerId) && !this.isBurrowed(playerId)
      && (this.walkers.get(playerId)?.expiresAt ?? 0) > now;
  }

  removePlayer(playerId: string): void {
    this.walkers.delete(playerId);
    this.positions.delete(playerId);
  }

  clear(): void {
    this.walkers.clear();
    this.positions.clear();
  }
}
