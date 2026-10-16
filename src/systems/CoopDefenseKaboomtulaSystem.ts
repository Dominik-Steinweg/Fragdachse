import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyKaboomtulaConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyMovementOverride, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnemyAiTargetRef } from './EnemyAiTargetCatalog';
import { closestOnSegment, lockLeapLane, skitterAmplitude, skitterSegment, type Point, type SkitterSegment } from './kaboomtulaMotion';
import type { KaboomtulaLeap, KaboomtulaPhase, KaboomtulaTargetRef } from './KaboomtulaState';
import type { AutomatedTurretId } from './TurretFireSource';

/** A hunted target: identity for the replicated telegraph plus its live contact point. */
export interface KaboomtulaHuntTarget {
  readonly ref: KaboomtulaTargetRef;
  /** Body centre (players, decoys) or the surface point nearest to the spider (structures, bases). */
  readonly x: number;
  readonly y: number;
  /** Body radius; 0 for surface points. */
  readonly radius: number;
  /** Players and decoys are pounced on; structures and bases are rammed. */
  readonly pounceable: boolean;
  /** Line-of-sight exemptions for the target's own rock or base. */
  readonly skipRockIndex?: number;
  readonly baseId?: string;
}

/** Something the spider explodes on when it touches it. */
export interface KaboomtulaContact {
  readonly ref: KaboomtulaTargetRef;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface KaboomtulaWebCandidate {
  readonly turretId: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  /** Host time the current web on this turret ends; 0 when it is not webbed. */
  readonly webbedUntil: number;
  /** Another spider already aims at this turret (reserved or a web in flight). */
  readonly reserved: boolean;
}

export interface KaboomtulaWebShot {
  readonly turretId: AutomatedTurretId;
  readonly enemyId: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly launchAt: number;
  readonly impactAt: number;
  readonly durationMs: number;
}

export interface KaboomtulaWebPort {
  /** Friendly turrets in range whose line of fire reaches the spider, i.e. turrets that could see it. */
  candidates(enemy: EnemyEntity, rangePx: number, now: number): readonly KaboomtulaWebCandidate[];
  reserve(turretId: AutomatedTurretId, enemyId: string): void;
  release(turretId: AutomatedTurretId, enemyId: string): void;
  launch(shot: KaboomtulaWebShot): void;
}

export type KaboomtulaSoundEvent = 'alert' | 'leap' | 'spit' | 'detonate' | 'killed-pop';

export interface KaboomtulaPorts {
  readonly enemies: { getHostileEnemies(): readonly EnemyEntity[] };
  readonly isStunned: (enemyId: string, now: number) => boolean;
  /** The body's bound target right now: a decoy lure first, then its navigation intent (player, structure, base). */
  readonly readTarget: (enemy: EnemyEntity) => KaboomtulaHuntTarget | null;
  /** Live re-resolve of a committed target; null once it is gone. */
  readonly resolveTarget: (enemy: EnemyEntity, ref: KaboomtulaTargetRef) => KaboomtulaHuntTarget | null;
  /** Line of sight from the spider within `range`, smoke included. */
  readonly canSee: (enemy: EnemyEntity, target: KaboomtulaHuntTarget, range: number) => boolean;
  /** Bodies and surfaces the spider explodes on; a base counts only while it is the hunted target. */
  readonly contactTargets: (enemy: EnemyEntity, hunted: KaboomtulaTargetRef | null) => readonly KaboomtulaContact[];
  /** Free travel along a lane for a body of `radius` (world geometry, water, arena edge). */
  readonly laneClearance: (x: number, y: number, angle: number, length: number, radius: number) => number;
  /** Next steering point of the ground route towards `point`, or null while no route is known. */
  readonly route: (enemy: EnemyEntity, key: string, point: Point, range: number) => Point | null;
  /** Crowd- and geometry-aware locomotion towards a steering point, facing `aimAngle`. */
  readonly moveNormally: (enemy: EnemyEntity, point: Point, speed: number, aimAngle: number) => { vx: number; vy: number; blocked: boolean };
  /** The committed target, e.g. so a decoy knows it lured this body. */
  readonly onCommit?: (enemy: EnemyEntity, ref: KaboomtulaTargetRef) => void;
  /** Big blast at the body: damage, effects and the reward-free removal. */
  readonly detonate: (enemy: EnemyEntity, contact: KaboomtulaContact, now: number) => void;
  /** Small pop of a killed spider. */
  readonly killedPop: (death: EnemyDeathInfo, now: number) => void;
  readonly web?: KaboomtulaWebPort | null;
  readonly sound?: (event: KaboomtulaSoundEvent, enemyId: string, x: number, y: number) => void;
}

interface LockedLeap extends KaboomtulaLeap { readonly angle: number; readonly length: number }

interface SpiderState {
  readonly enemy: EnemyEntity;
  phase: KaboomtulaPhase;
  revision: number;
  startedAt: number;
  endsAt: number;
  target: KaboomtulaTargetRef | null;
  leap: LockedLeap | null;
  /** Last resolved position of the hunted target (or turret) for movement between decisions. */
  aimX: number;
  aimY: number;
  lastSeenAt: number;
  segmentIndex: number;
  segment: SkitterSegment | null;
  segmentEndsAt: number;
  pounceLockoutUntil: number;
  trackX: number;
  trackY: number;
  trackAt: number;
  velocityX: number;
  velocityY: number;
  orbitSide: 1 | -1;
  /** Body position at the previous host step: the contact test sweeps from here. */
  lastX: number;
  lastY: number;
  movedPx: number;
  webTurret: AutomatedTurretId | null;
  webFired: boolean;
  webCooldownUntil: number;
  nextWebScanAt: number;
}

/** Below this residual distance a leap counts as having reached its planned end point. */
const ARRIVAL_EPSILON_PX = 3;
/** Pull back onto the lane centre line (1/s); no invisible lateral steering beyond drift repair. */
const LANE_CORRECTION_PER_S = 10;
/** Host frames are ~16.7 ms; the last step is shortened so the body stops at the end point. */
const NOMINAL_FRAME_S = 1 / 60;
/** Position jumps beyond this between two samples are teleports, not velocity. */
const TRACK_TELEPORT_PX = 64;
/** Web candidate scans are throttled per body. */
const WEB_SCAN_INTERVAL_MS = 300;
/** Share of the rush speed used while stalking inside the telegraph band. */
const STALK_SPEED_FACTOR = 0.85;
/** Sight is kept during the rush up to this multiple of the activation radius. */
const RUSH_SIGHT_FACTOR = 1.6;

/**
 * Host decisions of the Kabummtula: alert pose on sight, a skittering rush faster than any player,
 * a telegraphed leap out of the run with a host-locked lane, a recovery after a miss, opportunistic
 * web spits at turrets, and an immediate blast on any contact. Each transition is published as a
 * replicated {@link KaboomtulaState}; clients only draw it.
 */
export class CoopDefenseKaboomtulaSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, SpiderState>();

  constructor(private readonly ports: KaboomtulaPorts) {}

  hostUpdate(now: number): void {
    const live = new Set<string>();
    for (const enemy of this.ports.enemies.getHostileEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).kaboomtula;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        state = this.createState(enemy);
        this.states.set(enemy.id, state);
      }
      if (this.checkContact(state, config, now)) continue;
      if (this.ports.isStunned(enemy.id, now)) {
        this.interrupt(state, config, now);
        continue;
      }
      this.step(state, config, now);
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.releaseWeb(state); this.states.delete(id); }
  }

  getMovementOverride(enemy: EnemyEntity, now: number): EnemyMovementOverride | null {
    const state = this.states.get(enemy.id);
    const config = getCoopDefenseEnemyConfig(enemy.kind).kaboomtula;
    if (!state || !config || state.phase === 'approach') return null;
    const aim = Math.atan2(state.aimY - enemy.sprite.y, state.aimX - enemy.sprite.x);
    switch (state.phase) {
      case 'alert':
      case 'spit':
        return { vx: 0, vy: 0, aimAngle: aim };
      case 'rush':
        return this.rushVelocity(state, config, now, aim);
      case 'pounce':
        return this.stalkVelocity(state, config, aim);
      case 'leap':
        return state.leap ? this.leapVelocity(state, state.leap) : { vx: 0, vy: 0 };
      default:
        return { vx: 0, vy: 0 };
    }
  }

  /** Regular attacks (rock bites) only while approaching; every hunting phase owns the body. */
  blocksRegularBehavior(enemyId: string): boolean {
    const phase = this.states.get(enemyId)?.phase;
    return phase !== undefined && phase !== 'approach';
  }

  /** Hit stagger and knockback must not stop a committed leap. */
  isAirborne(enemyId: string): boolean {
    return this.states.get(enemyId)?.phase === 'leap';
  }

  getCurrentTarget(enemyId: string): EnemyAiTargetRef | null {
    const target = this.states.get(enemyId)?.target;
    return target && (target.kind === 'player' || target.kind === 'decoy') ? { kind: target.kind, id: target.id } : null;
  }

  /** A killed spider only pops; the big blast is reserved for contact. Suppresses the generic death. */
  handleKilled(death: EnemyDeathInfo, now: number): boolean {
    if (!getCoopDefenseEnemyConfig(death.kind).kaboomtula || death.faction !== 'hostile') return false;
    const state = this.states.get(death.id);
    if (state) { this.releaseWeb(state); state.enemy.setKnockbackImmune(false); }
    this.states.delete(death.id);
    this.ports.killedPop(death, now);
    this.ports.sound?.('killed-pop', death.id, death.x, death.y);
    return true;
  }

  clear(): void {
    for (const state of this.states.values()) {
      this.releaseWeb(state);
      state.enemy.setKnockbackImmune(false);
    }
    this.states.clear();
  }

  private createState(enemy: EnemyEntity): SpiderState {
    let hash = 2166136261;
    for (let i = 0; i < enemy.id.length; i++) hash = Math.imul(hash ^ enemy.id.charCodeAt(i), 16777619);
    return {
      enemy, phase: 'approach', revision: enemy.getKaboomtulaState().revision, startedAt: 0, endsAt: 0, target: null,
      leap: null, aimX: enemy.sprite.x, aimY: enemy.sprite.y, lastSeenAt: 0, segmentIndex: 0, segment: null,
      segmentEndsAt: 0, pounceLockoutUntil: 0, trackX: 0, trackY: 0, trackAt: 0, velocityX: 0, velocityY: 0,
      orbitSide: (hash >>> 0) % 2 === 0 ? 1 : -1, lastX: enemy.sprite.x, lastY: enemy.sprite.y, movedPx: 0,
      webTurret: null, webFired: false, webCooldownUntil: 0, nextWebScanAt: 0,
    };
  }

  /** Swept body contact since the previous step; the first touched target detonates the spider. */
  private checkContact(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): boolean {
    const enemy = state.enemy, ax = state.lastX, ay = state.lastY, bx = enemy.sprite.x, by = enemy.sprite.y;
    state.movedPx = Math.hypot(bx - ax, by - ay);
    state.lastX = bx; state.lastY = by;
    const reach = enemy.getCollisionRadius() + config.contactMarginPx;
    let hit: KaboomtulaContact | null = null, best = Infinity;
    for (const contact of this.ports.contactTargets(enemy, state.target)) {
      const closest = closestOnSegment(ax, ay, bx, by, contact.x, contact.y);
      const distance = Math.hypot(contact.x - closest.x, contact.y - closest.y);
      if (distance > reach + contact.radius || distance >= best) continue;
      hit = contact; best = distance;
    }
    if (!hit) return false;
    this.states.delete(enemy.id);
    this.releaseWeb(state);
    enemy.setKnockbackImmune(false);
    this.ports.sound?.('detonate', enemy.id, bx, by);
    this.ports.detonate(enemy, hit, now);
    return true;
  }

  private step(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    switch (state.phase) {
      case 'approach': this.stepApproach(state, config, now); break;
      case 'alert': this.stepAlert(state, config, now); break;
      case 'rush': this.stepRush(state, config, now); break;
      case 'pounce': this.stepPounce(state, config, now); break;
      case 'leap': this.stepLeap(state, config, now); break;
      case 'recover': if (now >= state.endsAt) this.publish(state, 'approach', now, 0, null, null); break;
      case 'spit': this.stepSpit(state, config, now); break;
    }
  }

  /** A visible target close enough to hunt, or null. */
  private huntCandidate(enemy: EnemyEntity, config: CoopDefenseEnemyKaboomtulaConfig): KaboomtulaHuntTarget | null {
    const target = this.ports.readTarget(enemy);
    if (!target) return null;
    const distance = Math.hypot(target.x - enemy.sprite.x, target.y - enemy.sprite.y);
    return distance <= config.activationRadiusPx && this.ports.canSee(enemy, target, config.activationRadiusPx) ? target : null;
  }

  private stepApproach(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, target = this.huntCandidate(enemy, config);
    if (target) {
      this.setAim(state, target);
      enemy.stopMovement();
      this.publish(state, 'alert', now, now + config.alertMs, target.ref, null);
      this.ports.sound?.('alert', enemy.id, enemy.sprite.x, enemy.sprite.y);
      return;
    }
    this.tryStartSpit(state, config, now);
  }

  private stepAlert(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const target = state.target ? this.ports.resolveTarget(state.enemy, state.target) : null;
    if (!target || !this.ports.canSee(state.enemy, target, config.activationRadiusPx * RUSH_SIGHT_FACTOR)) {
      this.publish(state, 'approach', now, 0, null, null);
      return;
    }
    this.setAim(state, target);
    if (now < state.endsAt) return;
    state.lastSeenAt = now;
    state.segment = null;
    state.segmentEndsAt = 0;
    this.ports.onCommit?.(state.enemy, target.ref);
    this.publish(state, 'rush', now, 0, target.ref, null);
  }

  private stepRush(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, target = state.target ? this.ports.resolveTarget(enemy, state.target) : null;
    if (!target || now - state.startedAt > config.rushMaxMs) { this.recover(state, config, now); return; }
    this.setAim(state, target);
    const visible = this.ports.canSee(enemy, target, config.activationRadiusPx * RUSH_SIGHT_FACTOR);
    if (visible) state.lastSeenAt = now;
    else if (now - state.lastSeenAt > config.lostSightGraceMs) { this.recover(state, config, now); return; }
    if (!target.pounceable || !visible || now < state.pounceLockoutUntil) return;
    const x = enemy.sprite.x, y = enemy.sprite.y, distance = Math.hypot(target.x - x, target.y - y);
    if (distance > config.pounce.triggerPx) return;
    const radius = enemy.getCollisionRadius();
    const clear = this.ports.laneClearance(x, y, Math.atan2(target.y - y, target.x - x), distance, radius);
    if (clear < distance - radius - target.radius) return;
    state.trackX = target.x; state.trackY = target.y; state.trackAt = now;
    state.velocityX = 0; state.velocityY = 0;
    this.publish(state, 'pounce', now, now + config.pounce.telegraphMs, target.ref, null);
  }

  private stepPounce(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, target = state.target ? this.ports.resolveTarget(enemy, state.target) : null;
    if (!target) { this.recover(state, config, now); return; }
    this.setAim(state, target);
    this.trackVelocity(state, target, now);
    if (now < state.endsAt) return;
    const x = enemy.sprite.x, y = enemy.sprite.y, radius = enemy.getCollisionRadius();
    const lock = lockLeapLane({ x, y }, target, { x: state.velocityX, y: state.velocityY }, radius + target.radius,
      config.leap, (angle, length) => this.ports.laneClearance(x, y, angle, length, radius));
    if (!lock) {
      // A blocked lane is no leap: keep hunting, retry after the lockout.
      state.pounceLockoutUntil = now + config.pounce.cancelLockoutMs;
      this.publish(state, 'rush', now, 0, target.ref, null);
      return;
    }
    const takeoffAt = Math.round(now);
    const leap: LockedLeap = { originX: x, originY: y, endX: lock.endX, endY: lock.endY, takeoffAt,
      landAt: takeoffAt + config.leap.airMs, angle: lock.angle, length: lock.length };
    enemy.setKnockbackImmune(true);
    this.publish(state, 'leap', takeoffAt, leap.landAt, target.ref, leap);
    this.ports.sound?.('leap', enemy.id, x, y);
  }

  private stepLeap(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, leap = state.leap;
    if (!leap) { this.recover(state, config, now); return; }
    const along = (enemy.sprite.x - leap.originX) * Math.cos(leap.angle) + (enemy.sprite.y - leap.originY) * Math.sin(leap.angle);
    const arrived = along >= leap.length - ARRIVAL_EPSILON_PX;
    // A body stopped by geometry the lane did not know about ends the leap early, never later.
    const stalled = now > leap.takeoffAt + 80 && state.movedPx < 0.5;
    if (arrived || stalled || now >= leap.landAt + 150) this.recover(state, config, now);
  }

  private stepSpit(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, web = this.ports.web;
    if (!web || state.webTurret === null) { this.publish(state, 'approach', now, 0, null, null); return; }
    if (state.webFired) {
      if (now >= state.endsAt + config.web.tailMs) this.publish(state, 'approach', now, 0, null, null);
      return;
    }
    // Players stay the main target: a hunt candidate cancels the spit at once.
    if (this.huntCandidate(enemy, config)) { this.cancelSpit(state, config, now); this.stepApproach(state, config, now); return; }
    if (now < state.endsAt) return;
    const turret = web.candidates(enemy, config.web.rangePx, now).find(candidate => candidate.turretId === state.webTurret);
    if (!turret) { this.cancelSpit(state, config, now); return; }
    const facing = Math.atan2(turret.y - enemy.sprite.y, turret.x - enemy.sprite.x);
    const sourceX = enemy.sprite.x + Math.cos(facing) * config.web.mouthForwardPx;
    const sourceY = enemy.sprite.y + Math.sin(facing) * config.web.mouthForwardPx;
    const launchAt = Math.round(now);
    web.launch({ turretId: turret.turretId, enemyId: enemy.id, sourceX, sourceY, targetX: turret.x, targetY: turret.y,
      launchAt, impactAt: launchAt + config.web.flightMs, durationMs: config.web.durationMs });
    state.webFired = true;
    state.webTurret = null;
    state.webCooldownUntil = now + config.web.cooldownMs;
    this.ports.sound?.('spit', enemy.id, sourceX, sourceY);
  }

  private tryStartSpit(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    const enemy = state.enemy, web = this.ports.web;
    if (!web || now < state.webCooldownUntil || now < state.nextWebScanAt) return;
    state.nextWebScanAt = now + WEB_SCAN_INTERVAL_MS;
    let best: KaboomtulaWebCandidate | null = null, bestScore = Infinity;
    for (const candidate of web.candidates(enemy, config.web.rangePx, now)) {
      if (candidate.reserved || candidate.webbedUntil > now + config.web.refreshWindowMs) continue;
      // Unwebbed turrets first, then the nearest.
      const score = (candidate.webbedUntil > now ? 1e6 : 0)
        + Math.hypot(candidate.x - enemy.sprite.x, candidate.y - enemy.sprite.y);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) return;
    web.reserve(best.turretId, enemy.id);
    state.webTurret = best.turretId;
    state.webFired = false;
    state.aimX = best.x; state.aimY = best.y;
    enemy.stopMovement();
    this.publish(state, 'spit', now, now + config.web.windupMs, { kind: 'turret', id: String(best.turretId) }, null);
  }

  private cancelSpit(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    this.releaseWeb(state);
    state.webCooldownUntil = Math.max(state.webCooldownUntil, now + config.web.lockoutMs);
    this.publish(state, 'approach', now, 0, null, null);
  }

  private releaseWeb(state: SpiderState): void {
    if (state.webTurret !== null && !state.webFired) this.ports.web?.release(state.webTurret, state.enemy.id);
    state.webTurret = null;
  }

  /** Stun: a hunt falls back to approach, a leap aborts where the body is and recovers. */
  private interrupt(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    if (state.phase === 'approach' || state.phase === 'recover') return;
    state.enemy.stopMovement();
    if (state.phase === 'leap') { this.recover(state, config, now); return; }
    if (state.phase === 'spit') { this.cancelSpit(state, config, now); return; }
    state.pounceLockoutUntil = now + config.pounce.cancelLockoutMs;
    this.publish(state, 'approach', now, 0, null, null);
  }

  private recover(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number): void {
    state.enemy.setKnockbackImmune(false);
    state.enemy.stopMovement();
    this.publish(state, 'recover', now, now + config.recoverMs, null, null);
  }

  private setAim(state: SpiderState, target: KaboomtulaHuntTarget): void {
    state.aimX = target.x; state.aimY = target.y;
  }

  /** Smoothed target velocity from host samples; teleports (dash portals, respawns) reset it. */
  private trackVelocity(state: SpiderState, target: KaboomtulaHuntTarget, now: number): void {
    const dt = now - state.trackAt;
    if (dt <= 0) return;
    const dx = target.x - state.trackX, dy = target.y - state.trackY;
    if (Math.hypot(dx, dy) > TRACK_TELEPORT_PX) {
      state.velocityX = 0; state.velocityY = 0;
    } else {
      const blend = Math.min(1, dt / 120);
      state.velocityX += (dx / dt * 1000 - state.velocityX) * blend;
      state.velocityY += (dy / dt * 1000 - state.velocityY) * blend;
    }
    state.trackX = target.x; state.trackY = target.y; state.trackAt = now;
  }

  private rushVelocity(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, now: number, aim: number): EnemyMovementOverride {
    const enemy = state.enemy, x = enemy.sprite.x, y = enemy.sprite.y, target = state.target!;
    // Without a known route (e.g. a goal on a base edge) locomotion steers straight at the target.
    const waypoint = this.ports.route(enemy, `kaboomtula:${target.kind}:${target.id}`, { x: state.aimX, y: state.aimY },
      Math.max(16, enemy.getCollisionRadius())) ?? { x: state.aimX, y: state.aimY };
    if (!state.segment || now >= state.segmentEndsAt) {
      state.segment = skitterSegment(enemy.id, state.segmentIndex++, config.skitter);
      state.segmentEndsAt = now + state.segment.durationMs + state.segment.pauseMs;
    }
    const segment = state.segment;
    if (segment.pauseMs > 0 && now >= state.segmentEndsAt - segment.pauseMs) return { vx: 0, vy: 0, aimAngle: aim };
    const speed = config.rushSpeedPx * segment.speedFactor;
    const heading = Math.atan2(waypoint.y - y, waypoint.x - x);
    const offset = segment.angle * skitterAmplitude(Math.hypot(state.aimX - x, state.aimY - y), config.skitter);
    if (offset !== 0) {
      const angle = heading + offset;
      const steered = this.ports.moveNormally(enemy, { x: x + Math.cos(angle) * config.skitter.probePx,
        y: y + Math.sin(angle) * config.skitter.probePx }, speed, aim);
      if (!steered.blocked) return { vx: steered.vx, vy: steered.vy, aimAngle: aim };
    }
    const direct = this.ports.moveNormally(enemy, waypoint, speed, aim);
    return { vx: direct.vx, vy: direct.vy, aimAngle: aim };
  }

  /** Keeps running through the telegraph: circles the target inside the band, facing it. */
  private stalkVelocity(state: SpiderState, config: CoopDefenseEnemyKaboomtulaConfig, aim: number): EnemyMovementOverride {
    const enemy = state.enemy, x = enemy.sprite.x, y = enemy.sprite.y;
    const dx = state.aimX - x, dy = state.aimY - y, distance = Math.hypot(dx, dy);
    if (distance < 1e-3) return { vx: 0, vy: 0, aimAngle: aim };
    const ux = dx / distance, uy = dy / distance;
    const { bandMinPx, bandMaxPx } = config.pounce;
    const radial = Math.max(-1, Math.min(1, (distance - (bandMinPx + bandMaxPx) / 2) / Math.max(1, (bandMaxPx - bandMinPx) / 2)));
    const mx = ux * radial - uy * state.orbitSide * 0.75, my = uy * radial + ux * state.orbitSide * 0.75;
    const norm = Math.hypot(mx, my) || 1;
    const moved = this.ports.moveNormally(enemy, { x: x + mx / norm * config.skitter.probePx, y: y + my / norm * config.skitter.probePx },
      config.rushSpeedPx * STALK_SPEED_FACTOR, aim);
    return { vx: moved.vx, vy: moved.vy, aimAngle: aim };
  }

  private leapVelocity(state: SpiderState, leap: LockedLeap): EnemyMovementOverride {
    const enemy = state.enemy, cos = Math.cos(leap.angle), sin = Math.sin(leap.angle);
    const dx = enemy.sprite.x - leap.originX, dy = enemy.sprite.y - leap.originY;
    const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
    const speed = Math.min(leap.length / Math.max(1, leap.landAt - leap.takeoffAt) * 1000,
      Math.max(0, leap.length - along) / NOMINAL_FRAME_S);
    const correction = -across * LANE_CORRECTION_PER_S;
    return { vx: cos * speed - sin * correction, vy: sin * speed + cos * correction, aimAngle: leap.angle };
  }

  private publish(state: SpiderState, phase: KaboomtulaPhase, startedAt: number, endsAt: number,
    target: KaboomtulaTargetRef | null, leap: LockedLeap | null): void {
    state.phase = phase;
    state.startedAt = Math.round(startedAt);
    state.endsAt = Math.round(endsAt);
    state.target = target;
    state.leap = leap;
    state.revision = Math.max(state.revision, state.enemy.getKaboomtulaState().revision) + 1;
    state.enemy.applyKaboomtulaState({ revision: state.revision, phase, startedAt: state.startedAt, endsAt: state.endsAt,
      target, leap: leap ? { originX: leap.originX, originY: leap.originY, endX: leap.endX, endY: leap.endY,
        takeoffAt: leap.takeoffAt, landAt: leap.landAt } : null });
  }
}
