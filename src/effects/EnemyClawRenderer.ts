import type * as Phaser from 'phaser';
import { ALLIED_COLOR, DEPTH, DEPTH_LIGHTING, DEPTH_TRACE } from '../config';
import { emissiveAlpha } from './EmissiveScale';
import type { SyncedMeleeSwing } from '../types';
import type { EnemyClawState, EnemyAreaClawAttack, EnemyAreaClawEvent, EnemyAreaClawImpact } from '../systems/EnemyClawAttack';
import { EnemyClawVfxStore, type ClawVfxAttackSpec } from './enemyClaw/EnemyClawVfxStore';
import { ClawVfxPass, createEnemyClawGpuLayer, type EnemyClawGpuLayer } from './enemyClaw/EnemyClawGpuLayer';

/** One danger family for every hostile claw: the sector must read as "leave" regardless of species. */
export const ENEMY_CLAW_HOSTILE_COLOR = 0xff4a36;

/** Bounded warmup: a pass that never renders must not hold the world-load barrier. */
const MAX_PREPARE_CALLS = 30;
const IDENTITY_TTL_MS = 4000;
const MAX_IDENTITIES = 4096;

interface ActiveClaw {
  readonly attackId: string;
  /** Hit time on the local presentation clock. */
  readonly hitClock: number;
}

/** Includes the lifetime of a part, not just its reusable boss/entity ID. */
export function areaClawSlotKey(event: Omit<EnemyAreaClawEvent, 'state'>): string {
  const s = event.slot;
  return JSON.stringify([event.worldRevision, event.activityRevision, event.enemyId, event.entityGeneration,
    ...(s.kind === 'body' ? ['body'] : ['part', s.partId, s.partGeneration, s.cycleId])]);
}

function areaSpec(attack: EnemyAreaClawAttack, offset: number, color: number): ClawVfxAttackSpec {
  const { pose: p } = attack;
  const timing = { x: p.originX, y: p.originY, angle: p.angle, startedAt: attack.startedAt + offset,
    strikeAt: attack.strikeAt + offset, hitAt: attack.hitAt + offset, color };
  return p.geometry.kind === 'lane' ? { ...timing, shape: 'lane', length: p.geometry.length, width: p.geometry.width }
    : { ...timing, range: p.geometry.range, halfArc: p.geometry.arcDegrees * Math.PI / 360,
      telegraphOnly: attack.presentation !== 'claw' };
}

/**
 * Presentation of announced enemy claw attacks, entirely GPU-animated.
 *
 * `sync` mirrors the replicated windup: the ground telegraph charges toward the hit time and
 * the rake plays from the same timeline. `confirm` is the host's melee result; it adds the
 * contact mark and covers strikes whose windup this client never saw. Blood stays with the
 * combat hit effects of the damage pipeline.
 */
export class EnemyClawRenderer {
  private readonly store = new EnemyClawVfxStore();
  private readonly layers: EnemyClawGpuLayer[] = [];
  private readonly active = new Map<string, ActiveClaw>();
  /** Strike identities whose rake already played or was deliberately skipped. */
  private readonly struck = new Map<string, number>();
  private readonly confirmed = new Map<string, number>();
  private readonly areaSlots = new Map<string, { revision: number; attackId: string | null }>();
  private lastRetire = Number.NaN;
  private prepareCalls = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly presentationClock?: () => number) {
    const time = (): number => this.store.time(this.clock());
    const ground = createEnemyClawGpuLayer(scene, this.store, ClawVfxPass.Ground, DEPTH.PLAYERS - 0.1, time);
    const top = createEnemyClawGpuLayer(scene, this.store, ClawVfxPass.Top, DEPTH_TRACE, time);
    // Emissive trace above the night lightmap, below the enemy eye auras.
    const night = createEnemyClawGpuLayer(scene, this.store, ClawVfxPass.Night, DEPTH_LIGHTING + 0.08, time,
      () => emissiveAlpha(0.85));
    for (const layer of [ground, top, night]) if (layer) this.layers.push(layer);
  }

  /** Links all shader passes before combat; polled by the world's presentation preparation. */
  prepare(): boolean {
    this.prepareCalls++;
    return this.prepareCalls >= MAX_PREPARE_CALLS || this.layers.every(layer => layer.isReady());
  }

  /** Pure presentation entry point, also usable by dev fixtures; never registers a hit. */
  showAttack(key: string, spec: ClawVfxAttackSpec): void {
    this.retire(this.clock());
    this.store.addAttack(key, spec, this.clock());
  }

  /**
   * `now` is the synchronized clock of the attack timeline. It is converted once per spawn to
   * the local presentation clock, so a late or missing sync never freezes a running rake.
   */
  sync(id: string, state: EnemyClawState, x: number, y: number, now: number, visible: boolean,
    color = ENEMY_CLAW_HOSTILE_COLOR): void {
    const clock = this.clock();
    this.retire(clock);
    const attack = state.attack;
    if (!attack || now >= attack.endsAt || !visible) { this.release(id); return; }
    const current = this.active.get(id);
    if (current?.attackId === attack.attackId) {
      if (now < attack.hitAt) this.store.move(attack.attackId, x, y);
      return;
    }
    this.release(id);
    // A windup first seen after its hit establishes a baseline; past strikes never replay.
    if (now >= attack.hitAt) { this.remember(this.struck, attack.attackId, clock); return; }
    const offset = clock - now;
    const added = this.store.addAttack(attack.attackId, {
      x, y, angle: attack.angle, range: attack.range, halfArc: attack.arcDegrees * Math.PI / 360,
      startedAt: attack.startedAt + offset, strikeAt: attack.strikeAt + offset, hitAt: attack.hitAt + offset, color,
    }, clock);
    if (added) this.active.set(id, { attackId: attack.attackId, hitClock: attack.hitAt + offset });
  }

  confirm(swing: SyncedMeleeSwing): void {
    if (swing.areaClaw) { this.confirmArea(swing.areaClaw, swing); return; }
    const id = swing.clawAttackId ?? `${swing.shooterId}:${swing.swingId}`;
    const clock = this.clock();
    this.retire(clock);
    if (this.confirmed.has(id)) return;
    this.remember(this.confirmed, id, clock);
    // Verbündete Gegner (Nekromantie) schlagen in ihrer Palette zu, alle anderen in der Gefahrenfarbe.
    const color = swing.color === ALLIED_COLOR ? ALLIED_COLOR : ENEMY_CLAW_HOSTILE_COLOR;
    if (!this.store.has(id) && !this.struck.has(id)) {
      // The windup never reached this client: play the rake from the authoritative result.
      this.remember(this.struck, id, clock);
      this.store.addAttack(id, {
        x: swing.x, y: swing.y, angle: swing.angle, range: swing.range, halfArc: swing.arcDegrees * Math.PI / 360,
        startedAt: clock - 2, strikeAt: clock - 1, hitAt: clock, color,
      }, clock);
    }
    if (!swing.hitPlayer || swing.impactX === undefined || swing.impactY === undefined) return;
    const size = Math.max(15, Math.min(34, swing.range * 0.36));
    this.store.addContact(`${id}:contact`, swing.impactX, swing.impactY, swing.angle, size,
      this.store.colorOf(id) ?? color, clock);
  }

  /** Canonical frozen geometry. Reliable events and full baselines use this same entry point.
   * The caller admits only the current World/Activity scope and clears on detach. */
  syncArea(event: EnemyAreaClawEvent, now: number, visible = true, color = ENEMY_CLAW_HOSTILE_COLOR): void {
    const key = areaClawSlotKey(event), previous = this.areaSlots.get(key), { state } = event;
    if (previous && state.revision < previous.revision) return;
    if (previous && state.revision === previous.revision && previous.attackId !== (state.attack?.attackId ?? null)) return;
    this.rememberArea(key, state.revision, state.attack?.attackId ?? null);
    const clock = this.clock();
    this.retire(clock);
    const attack = state.attack;
    if (!attack || !visible || now >= attack.endsAt) { this.release(key); return; }
    const identity = `${key}:${attack.attackId}`;
    if (this.active.get(key)?.attackId === identity) return;
    this.release(key);
    // A late baseline describes the present; it does not replay a strike.
    if (now >= attack.hitAt) { this.remember(this.struck, identity, clock); return; }
    if (this.struck.has(identity) || this.confirmed.has(identity)) return;
    const offset = clock - now;
    if (this.store.addAttack(identity, areaSpec(attack, offset, color), clock)) {
      this.active.set(key, { attackId: identity, hitClock: attack.hitAt + offset });
    }
  }

  /** Invalidation on full-array removal; old feedback must not resurrect a removed part. */
  releaseArea(event: Omit<EnemyAreaClawEvent, 'state'>): void {
    const key = areaClawSlotKey(event);
    this.release(key);
    this.rememberArea(key, Number.POSITIVE_INFINITY, null);
  }

  private confirmArea(impact: EnemyAreaClawImpact, swing: SyncedMeleeSwing): void {
    const key = areaClawSlotKey(impact), previous = this.areaSlots.get(key), attack = impact.attack;
    if (previous && (impact.revision < previous.revision
      || (impact.revision === previous.revision && previous.attackId !== attack.attackId))) return;
    const identity = `${key}:${attack.attackId}`, clock = this.clock();
    this.retire(clock);
    if (this.confirmed.has(identity)) return;
    if (previous?.attackId !== attack.attackId) this.release(key);
    this.rememberArea(key, impact.revision, attack.attackId);
    this.remember(this.confirmed, identity, clock);
    // Kraken ink/impact aftermath is sampled by KrakenRenderer, never replaced by claw scratches.
    if (attack.presentation !== 'claw') return;
    const color = swing.color === ALLIED_COLOR ? ALLIED_COLOR : ENEMY_CLAW_HOSTILE_COLOR;
    if (!this.store.has(identity) && !this.struck.has(identity)) {
      this.remember(this.struck, identity, clock);
      this.store.addAttack(identity, areaSpec(attack, clock - attack.hitAt, color), clock);
    }
    if (swing.hitPlayer && swing.impactX !== undefined && swing.impactY !== undefined) {
      const range = attack.pose.geometry.kind === 'sector' ? attack.pose.geometry.range : attack.pose.geometry.length;
      this.store.addContact(`${identity}:contact`, swing.impactX, swing.impactY, attack.pose.angle,
        Math.max(15, Math.min(34, range * .36)), color, clock);
    }
  }

  /** Before the hit a cancelled windup vanishes; after it the running rake finishes on its own. */
  release(id: string): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    const clock = this.clock();
    if (clock >= entry.hitClock) this.remember(this.struck, entry.attackId, clock);
    else this.store.remove(entry.attackId);
  }

  clear(): void {
    this.active.clear();
    this.struck.clear();
    this.confirmed.clear();
    this.areaSlots.clear();
    this.store.clear();
  }

  destroy(): void {
    this.clear();
    for (const layer of this.layers) layer.image.destroy();
    this.layers.length = 0;
  }

  private clock(): number { return this.presentationClock?.() ?? this.scene.time.now; }

  private rememberArea(key: string, revision: number, attackId: string | null): void {
    // Old-cycle tombstones are bounded; C still owns admission of stale scopes/generations.
    if (!this.areaSlots.has(key) && this.areaSlots.size >= MAX_IDENTITIES) {
      for (const old of this.areaSlots.keys()) if (!this.active.has(old)) { this.areaSlots.delete(old); break; }
    }
    this.areaSlots.set(key, { revision, attackId });
  }

  private retire(clock: number): void {
    if (clock === this.lastRetire) return;
    this.lastRetire = clock;
    this.store.retire(clock);
  }

  /** Keeps recent identities across long packet delays, with a fixed memory bound. */
  private remember(entries: Map<string, number>, id: string, clock: number): void {
    // Insertion order equals expiry order, so the sweep stops at the first live identity.
    for (const [key, expiresAt] of entries) {
      if (expiresAt > clock && entries.size < MAX_IDENTITIES) break;
      entries.delete(key);
    }
    entries.set(id, clock + IDENTITY_TTL_MS);
  }
}
