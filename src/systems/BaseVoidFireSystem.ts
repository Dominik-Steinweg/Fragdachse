import { BURN_TICK_INTERVAL_MS, CELL_SIZE } from '../config';
import { BASE_VOID_FIRE } from '../config/baseVoidFire';
import type { CombatSource } from '../combat/CombatScope';
import { GROUND_FIRE_CELL_SIZE, type GroundFireContact, type FireSystem } from '../effects/FireSystem';
import type { WorldMetrics } from '../world/WorldMetrics';

/** Sample the real footprint, never its bounding rectangle (courtyards must stay empty). */
export function collectBaseFireContacts(fire: Pick<FireSystem, 'collectContacts'>,
  cells: readonly { gridX: number; gridY: number }[], metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
  now: number): GroundFireContact[] {
  const contacts = new Map<string, GroundFireContact>();
  for (const cell of cells) for (let y = 0; y < CELL_SIZE; y += GROUND_FIRE_CELL_SIZE) {
    for (let x = 0; x < CELL_SIZE; x += GROUND_FIRE_CELL_SIZE) {
      for (const contact of fire.collectContacts(metrics.offsetX + cell.gridX * CELL_SIZE + x + GROUND_FIRE_CELL_SIZE / 2,
        metrics.offsetY + cell.gridY * CELL_SIZE + y + GROUND_FIRE_CELL_SIZE / 2, 0, now)) {
        contacts.set(contact.sourceKey, contact);
      }
    }
  }
  return [...contacts.values()];
}

export interface VoidFireBase {
  readonly id: string;
  readonly faction: 'friendly' | 'hostile';
  isDamageable(): boolean;
  setVoidBurning(burning: boolean): void;
}

export interface BaseVoidFireDeps {
  readonly getBases: () => readonly VoidFireBase[];
  readonly getContacts: (baseId: string, now: number) => readonly GroundFireContact[];
  readonly captureSource: (contact: GroundFireContact) => CombatSource;
  readonly canDamage: (source: CombatSource, faction: VoidFireBase['faction']) => boolean;
  readonly damage: (baseId: string, amount: number, source: CombatSource, now: number) => void;
}

interface BaseBurn { source: CombatSource; expiresAt: number; nextTickAt: number }

/** One non-stacking burn per base, owned and discarded by the active mission. */
export class BaseVoidFireSystem {
  private readonly burns = new Map<string, BaseBurn>();
  private destroyed = false;

  constructor(private readonly deps: BaseVoidFireDeps,
    private readonly config: Readonly<{ damagePerSecond: number; afterburnMs: number }> = BASE_VOID_FIRE) {}

  hostUpdate(now: number): void {
    if (this.destroyed || !Number.isFinite(now)) return;
    for (const base of this.deps.getBases()) {
      if (!base.isDamageable()) {
        this.burns.delete(base.id);
        base.setVoidBurning(false);
        continue;
      }
      let burn = this.burns.get(base.id);
      if (burn) {
        // Integrate only the lifetime already earned by prior contacts. Late frames do not
        // invent damage in a gap between an expired burn and the next observed contact.
        while (burn.nextTickAt <= Math.min(now, burn.expiresAt) && base.isDamageable()) {
          this.deps.damage(base.id, this.config.damagePerSecond * BURN_TICK_INTERVAL_MS / 1000,
            burn.source, burn.nextTickAt);
          burn.nextTickAt += BURN_TICK_INTERVAL_MS;
          if (this.destroyed) return;
        }
        if (burn.expiresAt <= now || !base.isDamageable()) {
          this.burns.delete(base.id);
          burn = undefined;
        }
      }
      if (base.isDamageable()) {
        for (const contact of this.deps.getContacts(base.id, now)) {
          if (contact.visualStyle !== 'void') continue;
          const source = contact.combatSource ?? this.deps.captureSource(contact);
          if (!this.deps.canDamage(source, base.faction)) continue;
          if (burn) burn.expiresAt = now + this.config.afterburnMs;
          else {
            burn = { source: { ...source, origin: 'burn' }, expiresAt: now + this.config.afterburnMs,
              nextTickAt: now + BURN_TICK_INTERVAL_MS };
            this.burns.set(base.id, burn);
          }
          break;
        }
      }
      base.setVoidBurning(!!burn && base.isDamageable());
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.burns.clear();
    for (const base of this.deps.getBases()) base.setVoidBurning(false);
  }
}
