import type {
  EnergyInjectorConstructionEffect,
  ProjectileEnergyInjectorPayload,
  SyncedEnergyInjectorEffect,
  SyncedEnergyInjectorFocus,
} from '../types';
import type { TargetStatusTarget, TargetStatusTargetType } from './TargetStatusSystem';

const CONSTRUCTION_MATCH_RADIUS = 24;

export interface EnergyInjectorTargetEffect extends SyncedEnergyInjectorEffect {
  readonly effect: EnergyInjectorConstructionEffect;
}

/**
 * Hostautoritativer Einzelzielzustand des Energieinjektors.
 * Konstrukte haben genau einen Effekt-Eintrag; Folgekontakte erneuern nur dessen Ablaufzeit.
 * Der Fokus ist pro Inspector ebenfalls ein einzelner Eintrag.
 */
export class EnergyInjectorSystem {
  private effects = new Map<string, EnergyInjectorTargetEffect>();
  private focusTargets = new Map<string, SyncedEnergyInjectorFocus>();

  applyConstructionEffect(
    targetId: string,
    ownerId: string,
    x: number,
    y: number,
    effect: EnergyInjectorConstructionEffect,
    payload: ProjectileEnergyInjectorPayload,
    now: number,
  ): EnergyInjectorTargetEffect {
    const next: EnergyInjectorTargetEffect = {
      targetId,
      targetType: 'construction',
      ownerId,
      x,
      y,
      color: payload.color,
      effect: { ...effect },
      startedAt: now,
      expiresAt: now + Math.max(0, payload.durationMs),
    };
    // Kein Stack: der Eintrag wird ersetzt, die Dauer wird vom neuen Treffer aus erneuert.
    this.effects.set(targetId, next);
    return { ...next, effect: { ...next.effect } };
  }

  setFocusTarget(
    ownerId: string,
    target: TargetStatusTarget,
    durationMs: number,
    now: number,
  ): SyncedEnergyInjectorFocus | null {
    if (durationMs <= 0 || (target.targetType !== 'enemy' && target.targetType !== 'base')) return null;
    const next: SyncedEnergyInjectorFocus = {
      ownerId,
      targetType: target.targetType,
      targetId: target.targetId,
      startedAt: now,
      expiresAt: now + durationMs,
    };
    this.focusTargets.set(ownerId, next);
    return { ...next };
  }

  getFocusTarget(ownerId: string, now = Date.now()): TargetStatusTarget | null {
    const focus = this.focusTargets.get(ownerId);
    if (!focus) return null;
    if (now >= focus.expiresAt) {
      this.focusTargets.delete(ownerId);
      return null;
    }
    return { targetType: focus.targetType, targetId: focus.targetId };
  }

  getEffect(targetId: string, now = Date.now()): EnergyInjectorTargetEffect | null {
    const effect = this.effects.get(targetId);
    if (!effect) return null;
    if (now >= effect.expiresAt) {
      this.effects.delete(targetId);
      return null;
    }
    return { ...effect, effect: { ...effect.effect } };
  }

  getEffectAt(x: number, y: number, now = Date.now()): EnergyInjectorTargetEffect | null {
    let best: EnergyInjectorTargetEffect | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const effect of this.effects.values()) {
      if (now >= effect.expiresAt) continue;
      const dx = effect.x - x;
      const dy = effect.y - y;
      const distance = dx * dx + dy * dy;
      if (distance > CONSTRUCTION_MATCH_RADIUS * CONSTRUCTION_MATCH_RADIUS || distance >= bestDistance) continue;
      best = effect;
      bestDistance = distance;
    }
    return best ? { ...best, effect: { ...best.effect } } : null;
  }

  getTurretDamageMultiplierAt(x: number, y: number, now = Date.now()): number {
    const effect = this.getEffectAt(x, y, now);
    return effect?.effect.type === 'damage_turret'
      ? Math.max(1, effect.effect.damageMultiplier)
      : 1;
  }

  getGravityPullMultiplierAt(x: number, y: number, now = Date.now()): number {
    const effect = this.getEffectAt(x, y, now);
    return effect?.effect.type === 'gravity_pull'
      ? Math.max(1, effect.effect.pullStrengthMultiplier)
      : 1;
  }

  getSlowStrengthMultiplierAt(x: number, y: number, now = Date.now()): number {
    const effect = this.getEffectAt(x, y, now);
    return effect?.effect.type === 'slow_bubble'
      ? Math.max(1, effect.effect.slowStrengthMultiplier)
      : 1;
  }

  getPowerUpRespawnMultiplierAt(x: number, y: number, now = Date.now()): number {
    const effect = this.getEffectAt(x, y, now);
    return effect?.effect.type === 'powerup_cooldown'
      ? Math.max(0.05, effect.effect.respawnTimeMultiplier)
      : 1;
  }

  update(now: number): void {
    for (const [targetId, effect] of this.effects) {
      if (now >= effect.expiresAt) this.effects.delete(targetId);
    }
    for (const [ownerId, focus] of this.focusTargets) {
      if (now >= focus.expiresAt) this.focusTargets.delete(ownerId);
    }
  }

  getNetEffectSnapshot(now = Date.now()): SyncedEnergyInjectorEffect[] {
    this.update(now);
    return [...this.effects.values()].map((effect) => ({ ...effect, effect: { ...effect.effect } }));
  }

  getNetFocusSnapshot(now = Date.now()): SyncedEnergyInjectorFocus[] {
    this.update(now);
    return [...this.focusTargets.values()].map((focus) => ({ ...focus }));
  }

  syncEffectsFromSnapshot(snapshot: readonly SyncedEnergyInjectorEffect[]): void {
    this.effects = new Map(snapshot.map((effect) => [effect.targetId, { ...effect, effect: { ...effect.effect } }]));
  }

  syncFocusFromSnapshot(snapshot: readonly SyncedEnergyInjectorFocus[]): void {
    this.focusTargets = new Map(snapshot.map((focus) => [focus.ownerId, { ...focus }]));
  }

  getActiveEffects(): readonly SyncedEnergyInjectorEffect[] {
    return [...this.effects.values()];
  }

  removeTarget(target: TargetStatusTarget | { readonly targetId: string }): void {
    this.effects.delete(target.targetId);
    for (const [ownerId, focus] of this.focusTargets) {
      if (focus.targetId === target.targetId) this.focusTargets.delete(ownerId);
    }
  }

  removeOwner(ownerId: string): void {
    this.focusTargets.delete(ownerId);
    for (const [targetId, effect] of this.effects) {
      if (effect.ownerId === ownerId) this.effects.delete(targetId);
    }
  }

  clear(): void {
    this.effects.clear();
    this.focusTargets.clear();
  }
}

export function getEnergyInjectorFocusTargetType(value: string): TargetStatusTargetType | null {
  return value === 'enemy' || value === 'base' ? value : null;
}
