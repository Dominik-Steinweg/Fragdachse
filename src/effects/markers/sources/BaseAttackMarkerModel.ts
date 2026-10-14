import type { MarkerDescriptor } from '../MarkerTypes';
import type { MarkerTargetBounds } from './CoopMissionMarkerSource';

export const BASE_ATTACK_TIMING = { holdMs: 3500, fadeMs: 650, hitPulseMs: 300, criticalPeriodMs: 450 } as const;
export interface BaseAttackTarget extends MarkerTargetBounds {
  readonly id: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly baselineRevision?: number;
}
interface Observation { hp: number; maxHp: number; baselineRevision?: number; lastHitAtMs: number; pulseAtMs: number }

/** Round-local HP history. Hydration, repairs and new HP capacities never manufacture a hit.
 * No damage timestamp exists on SyncedBaseState, so late readers start with a silent baseline. */
export class BaseAttackMarkerModel {
  private readonly history = new Map<string, Observation>();

  project(targets: readonly BaseAttackTarget[], nowMs: number): MarkerDescriptor[] {
    const live = new Set(targets.map(t => t.id));
    for (const id of this.history.keys()) if (!live.has(id)) this.history.delete(id);
    const out: MarkerDescriptor[] = [];
    for (const t of targets) {
      if (t.destroyed || t.dormant || t.hp <= 0 || t.maxHp <= 0 || !Number.isFinite(t.hp + t.maxHp)) {
        this.history.delete(t.id); continue;
      }
      let h = this.history.get(t.id);
      if (!h || h.maxHp !== t.maxHp || h.baselineRevision !== t.baselineRevision || nowMs < h.lastHitAtMs) {
        h = { hp: t.hp, maxHp: t.maxHp, baselineRevision: t.baselineRevision, lastHitAtMs: -Infinity, pulseAtMs: -Infinity };
        this.history.set(t.id, h);
      } else if (t.hp < h.hp) {
        h.lastHitAtMs = nowMs;
        // Finish the current strike before another can start; sustained fire stays legible.
        if (nowMs - h.pulseAtMs >= BASE_ATTACK_TIMING.hitPulseMs) h.pulseAtMs = nowMs;
      }
      h.hp = t.hp;
      if (nowMs - h.lastHitAtMs >= BASE_ATTACK_TIMING.holdMs + BASE_ATTACK_TIMING.fadeMs) continue;
      out.push({ key: `base-attack:${t.id}`, kind: 'main-objective', state: 'active', glyph: 'base',
        x: t.x + t.width / 2, y: t.y + t.height / 2, targetHalfHeight: t.height / 2,
        visibility: 'world-and-edge', progress: Math.max(0, Math.min(1, t.hp / t.maxHp)),
        baseAttack: { lastHitAtMs: h.lastHitAtMs, pulseAtMs: h.pulseAtMs } });
    }
    return out;
  }
  clear(): void { this.history.clear(); }
}
