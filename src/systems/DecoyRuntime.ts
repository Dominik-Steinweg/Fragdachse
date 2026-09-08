import type { DecoyUtilityConfig } from '../loadout/LoadoutTypes';

/** Position is supplied by the physical body, never by a rendered sprite. */
export interface DecoyPosition {
  readonly x: number;
  readonly y: number;
}

export interface DecoyState {
  readonly id: number;
  readonly ownerId: string;
  readonly position: DecoyPosition;
  readonly config: DecoyUtilityConfig;
  readonly expiresAt: number;
  readonly maxHp: number;
  readonly maxArmor: number;
  readonly color: number;
  readonly rotation: number;
  readonly speed: number;
  readonly entityGeneration: number;
  hp: number;
  armor: number;
}

export type DecoyEndReason = 'killed' | 'expired' | 'cleanup';
export interface DecoyEnd {
  readonly decoy: Readonly<DecoyState>;
  readonly reason: DecoyEndReason;
  readonly x: number;
  readonly y: number;
}

export interface DecoyStealthState {
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly speedMultiplier: number;
  readonly adrenalineMultiplier: number;
  readonly hpPerSecond: number;
}

/** World-owned authority for decoy lifetime, copied vitals and independent owner stealth. */
export class DecoyRuntime {
  private readonly decoys = new Map<number, DecoyState>();
  private readonly activeByOwner = new Map<string, number>();
  private readonly stealth = new Map<string, DecoyStealthState>();
  private nextId = 1;

  get(id: number): Readonly<DecoyState> | undefined { return this.decoys.get(id); }
  values(): IterableIterator<Readonly<DecoyState>> { return this.decoys.values(); }
  hasActive(ownerId: string): boolean { return this.activeByOwner.has(ownerId); }
  getStealth(ownerId: string): DecoyStealthState | undefined { return this.stealth.get(ownerId); }

  activate(input: {
    ownerId: string; position: DecoyPosition; config: DecoyUtilityConfig;
    hp: number; maxHp: number; armor: number; maxArmor: number;
    color: number; rotation: number; speed: number; now: number;
  }): Readonly<DecoyState> | null {
    if (this.hasActive(input.ownerId) || input.hp <= 0) return null;
    // Resolved loadout objects can be replaced while an activation is still alive.
    const config = Object.freeze({ ...input.config,
      fireChunkBurst: Object.freeze({ ...input.config.fireChunkBurst }),
    });
    const id = this.nextId++;
    const state: DecoyState = {
      id, ownerId: input.ownerId, position: input.position, config,
      hp: input.hp, maxHp: input.maxHp, armor: input.armor, maxArmor: input.maxArmor,
      color: input.color, rotation: input.rotation, speed: input.speed,
      expiresAt: input.now + config.decoyLifetimeMs, entityGeneration: id,
    };
    this.decoys.set(id, state);
    this.activeByOwner.set(input.ownerId, id);
    this.stealth.set(input.ownerId, {
      startedAt: input.now, expiresAt: input.now + config.stealthDurationMs,
      speedMultiplier: 1 + config.stealthMoveSpeedBonus,
      adrenalineMultiplier: 1 + config.stealthAdrenalineRegenBonus,
      hpPerSecond: config.stealthHpRegenPerSecond,
    });
    return state;
  }

  damage(id: number, amount: number): { hpLost: number; armorLost: number } | null {
    const state = this.decoys.get(id);
    if (!state || !Number.isFinite(amount) || amount < 0) return null;
    const armorLost = Math.min(state.armor, amount);
    const hpLost = Math.min(state.hp, amount - armorLost);
    state.armor -= armorLost;
    state.hp -= hpLost;
    return { hpLost, armorLost };
  }

  /** Removes the target before any external callbacks can cause reentrant damage. */
  end(id: number, reason: DecoyEndReason): DecoyEnd | null {
    const decoy = this.decoys.get(id);
    if (!decoy) return null;
    this.decoys.delete(id);
    this.activeByOwner.delete(decoy.ownerId);
    return { decoy, reason, x: decoy.position.x, y: decoy.position.y };
  }

  expired(now: number): number[] {
    return [...this.decoys.values()].filter(decoy => now >= decoy.expiresAt).map(decoy => decoy.id);
  }

  expireStealth(now: number): void {
    for (const [ownerId, state] of this.stealth) {
      if (now >= state.expiresAt) this.stealth.delete(ownerId);
    }
  }

  breakStealth(ownerId: string): boolean { return this.stealth.delete(ownerId); }
  clearStealth(): void { this.stealth.clear(); }
}
