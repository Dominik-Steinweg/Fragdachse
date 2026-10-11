import type { CombatAreaAttackPort } from '../combat/CombatAreaAttack';
import type { BossTargetRef, CombatPartIdentity } from '../combat/CombatPartContact';
import type { KrakenBossConfig } from '../config/krakenBoss';
import { krakenExitDistance } from './CoopDefenseKrakenMotion';
import { KrakenTentacleTargets } from '../entities/KrakenTentacleTargets';
import type { EnemyAreaClawAttack, EnemyAreaClawEvent, EnemyAreaClawState, EnemyClawSlot } from './EnemyClawAttack';
import type { CoopDefenseKrakenBroodSystem } from './CoopDefenseKrakenBroodSystem';
import type { KrakenBodyAction, KrakenEggLandEffect, KrakenEntityPort, KrakenExitReservation,
  KrakenHabitatPort, KrakenHostActionProgress, KrakenIntentReadPort, KrakenLaneReservation,
  KrakenProjectileSpawnPort, KrakenState, KrakenStatePublishPort, KrakenTentacleState } from './KrakenState';

type Point = { readonly x: number; readonly y: number };
export interface KrakenHostDependencies {
  entity: KrakenEntityPort;
  intent: KrakenIntentReadPort;
  habitat: KrakenHabitatPort & { reserveExit(boss: BossTargetRef, habitatId: string, target?: Point): ReturnType<KrakenHabitatPort['reserveExit']> };
  combat: CombatAreaAttackPort;
  projectiles: KrakenProjectileSpawnPort;
  brood: CoopDefenseKrakenBroodSystem;
  publish: KrakenStatePublishPort;
  /** Bind body snapshots and reliable body/part starts/clears in AP2. */
  claw(event: EnemyAreaClawEvent): void;
  waterApproach(from: Point, target: Point): Point | null;
  canMove(from: Point, to: Point, mode: 'water-approach' | 'ashore' | 'land'): boolean;
  eggLandings(from: Point, rotation: number, count: number, minimumShoreDistancePx: number): readonly (Point | null)[];
  flightFree(from: Point, to: Point, radius: number): boolean;
  random(): number;
  diagnostic(message: string): void;
}

interface EggThrow { effect: KrakenEggLandEffect; from: Point; to: Point; releaseAt: number; released: boolean; }
interface PartRuntime { state: KrakenTentacleState; lane: KrakenLaneReservation; progress: KrakenHostActionProgress; }

/** Host-only Activity owner. preMovement runs BEFORE ordinary movement, actions AFTER it. */
export class CoopDefenseKrakenSystem {
  readonly contacts: KrakenTentacleTargets;
  private state: KrakenState | null = null;
  private bodyClaw: EnemyAreaClawState = { revision: 0, attack: null };
  private bodyProgress: KrakenHostActionProgress | null = null;
  private readonly parts = new Map<string, PartRuntime>();
  private throws: EggThrow[] = [];
  private sequence = 0;
  private now = 0;
  private nextActionAt = 0;
  private nextPartAt = 0;
  private nextWaterAction: 'ink' | 'eggs' = 'ink';
  private cooldowns = { ink: 0, eggs: 0, slam: 0 };
  private exit: KrakenExitReservation | null = null;
  private exitIndex = 0;
  private exitLength = 0;
  private exitTravelled = 0;
  private lunge: { from: Point; distance: number; stopped: boolean } | null = null;
  private nextExitRetry = 0;
  private blockedSince: number | null = null;
  private diagnosticSent = false;
  private lastPose = { x: 0, y: 0, angle: 0 };
  private lastPreAt = -Infinity;

  constructor(private readonly config: KrakenBossConfig, private readonly deps: KrakenHostDependencies) {
    this.contacts = new KrakenTentacleTargets(config.hitboxProfiles, boss => !!deps.entity.readBoss(boss)?.alive,
      (identity, status) => {
        if (status !== 'stun') return false; // No boss-wide status transfer or invented part DoT HP.
        this.retractPart(identity); return true;
      }, () => this.now);
  }

  /** Called exactly at successful BossSystem emergence; BossSystem remains the sole intro writer. */
  start(boss: BossTargetRef, habitatId: string, spawnedAt: number, cameraReturnedAt: number, introStartedAt?: number): void {
    this.clear();
    this.now = spawnedAt; this.lastPreAt = spawnedAt;
    const entity = this.deps.entity.readBoss(boss);
    if (!entity?.alive) return;
    this.lastPose = { x: entity.x, y: entity.y, angle: entity.angle };
    this.nextWaterAction = 'ink'; this.cooldowns = { ink: 0, eggs: 0, slam: 0 };
    this.nextActionAt = Math.max(cameraReturnedAt, spawnedAt) + this.config.firstAttackDelayMs;
    this.state = { boss: structuredClone(boss), revision: 0, cycleId: 1, habitatId,
      phase: cameraReturnedAt > spawnedAt ? { kind: 'intro', startedAt: introStartedAt ?? spawnedAt - 1,
        emergeAt: spawnedAt, cameraReturnedAt } : { kind: 'surfaced', startedAt: spawnedAt, nextDiveAt: spawnedAt + this.config.dive.intervalMs },
      phaseTwoPending: false, bodyTargetability: { revision: 0, effectiveAt: spawnedAt, mode: 'exposed' },
      movement: 'water-anchored', bodyAction: null, inkClouds: [], tentacles: [], eggs: [] };
    this.deps.entity.setBodyTargetability(boss, this.state.bodyTargetability);
    this.move('water-anchored', null); this.publish();
  }

  getState(): KrakenState | null { return this.state ? structuredClone(this.state) : null; }
  getBodyClaw(): EnemyAreaClawState { return structuredClone(this.bodyClaw); }
  isDefeatComplete(): boolean { return this.state?.phase.kind === 'removed'; }

  preMovement(now: number, deltaMs: number): void {
    if (!this.state || now < this.lastPreAt || !Number.isFinite(now)) return;
    const dt = this.lastPreAt === now ? 0 : Math.max(0, Math.min(deltaMs, now - this.lastPreAt));
    this.lastPreAt = now; this.now = now;
    const s = this.state, entity = this.deps.entity.readBoss(s.boss);
    if (entity) this.lastPose = { x: entity.x, y: entity.y, angle: entity.angle };
    if (!entity?.alive || entity.hp <= 0) { this.die(now); this.advanceDeath(now); return; }
    if (s.phase.kind === 'dying' || s.phase.kind === 'removed') { this.advanceDeath(now); return; }
    if (!s.phaseTwoPending && entity.hp <= entity.maxHp * this.config.phaseTwoHpRatio) {
      s.phaseTwoPending = true;
    }
    if (entity.stunned && s.bodyAction) this.cancelBody();
    const p = s.phase, d = this.config.dive;
    switch (p.kind) {
      case 'intro':
        this.move('water-anchored', null);
        if (now >= p.cameraReturnedAt) s.phase = { kind: 'surfaced', startedAt: now, nextDiveAt: now + d.intervalMs };
        break;
      case 'surfaced':
        this.move('water-anchored', null);
        if (s.bodyAction) break;
        if (s.phaseTwoPending) { this.beginExit(now); break; }
        if (now >= p.nextDiveAt) { s.phase = { kind: 'diving', startedAt: now, submergedAt: now + d.submergedAtMs, endsAt: now + d.durationMs }; break; }
        if (!entity.stunned) this.approachAndFace(entity, dt);
        break;
      case 'diving':
        this.move('water-anchored', null);
        if (now >= p.submergedAt) this.targetability('hidden', p.submergedAt);
        if (now >= p.endsAt) {
          s.phase = { kind: 'submerged', startedAt: now, stopSpawningAt: now + d.submergedDurationMs };
          this.nextPartAt = now;
        }
        break;
      case 'submerged':
        this.move('water-anchored', null);
        this.expireParts(now);
        if ((s.phaseTwoPending || now >= p.stopSpawningAt) && !this.parts.size) this.surface(now);
        break;
      case 'surfacing':
        this.move('water-anchored', null);
        if (now >= p.vulnerableAt) this.targetability('exposed', p.vulnerableAt);
        if (now >= p.recoveryEndsAt) {
          s.phase = { kind: 'surfaced', startedAt: now, nextDiveAt: now + d.intervalMs };
          this.nextActionAt = now;
        }
        break;
      case 'ashore': this.advanceExit(now, dt, entity); break;
      case 'land':
        this.move(s.bodyAction || entity.stunned ? 'locked' : 'land', null);
        if (s.bodyAction?.kind === 'slam') this.advanceLunge(now, entity);
        if (!s.bodyAction && !entity.stunned) this.faceTarget(entity, dt);
        break;
    }
    this.syncParts();
  }

  hostUpdateActions(now: number): void {
    const s = this.state;
    if (!s || now !== this.lastPreAt) return;
    this.now = now;
    if (!this.alive()) { this.die(now); this.advanceDeath(now); this.publish(); return; }
    s.inkClouds = s.inkClouds.filter(c => now < c.cloudEndsAt);
    if (s.phase.kind === 'submerged') this.updateParts(now);
    if (!this.alive()) { this.die(now); this.publish(); return; }
    if (s.bodyAction) this.updateBody(now);
    else if (now >= this.nextActionAt && ['surfaced', 'land'].includes(s.phase.kind)
      && !(s.phase.kind === 'surfaced' && s.phaseTwoPending) && !this.deps.entity.readBoss(s.boss)?.stunned) this.chooseAction(now);
    if (!this.alive()) this.die(now);
    this.deps.brood.hostUpdate(now);
    s.eggs = this.deps.brood.getEggs(s.boss);
    this.syncParts(); this.publish();
  }

  clear(): void {
    const old = this.state;
    // Invalidate owner first so reentrant callbacks cannot restart actions.
    this.state = null; this.originId = null;
    if (old) {
      this.clearClaw({ kind: 'body' }, old.boss);
      for (const part of this.parts.values()) this.clearClaw(this.slot(part.state), old.boss);
      this.deps.brood.clearBoss(old.boss);
    }
    for (const p of this.parts.values()) this.deps.habitat.release(p.lane.reservationId);
    this.parts.clear(); this.contacts.clear(); this.throws = []; this.bodyProgress = null; this.lunge = null;
    if (this.exit) this.deps.habitat.release(this.exit.reservationId);
    this.exit = null; this.blockedSince = null; this.diagnosticSent = false;
    if (old) this.deps.publish.publish(null);
  }

  private approachAndFace(entity: Point & { angle: number }, dt: number): void {
    const target = this.deps.intent.readTarget(this.state!.boss);
    if (!target) return;
    const destination = this.deps.waterApproach(entity, target);
    if (destination) {
      const next = this.step(entity, destination, this.config.waterApproachSpeedPxPerSec * dt / 1000);
      if (this.deps.canMove(entity, next, 'water-approach')) this.move('water-approach', next);
    }
    this.faceTarget(entity, dt);
  }
  private faceTarget(entity: Point & { angle: number }, dt: number): void {
    const target = this.deps.intent.readTarget(this.state!.boss);
    if (!target) return;
    this.facePoint(entity, target, dt);
  }
  private facePoint(entity: Point & { angle: number }, target: Point, dt: number): void {
    const desired = Math.atan2(target.y - entity.y, target.x - entity.x);
    const diff = Math.atan2(Math.sin(desired - entity.angle), Math.cos(desired - entity.angle));
    const rate = this.state!.phase.kind === 'land' ? this.config.landTurnRateDegPerSec : this.config.turnRateDegPerSec;
    const limit = rate * Math.PI / 180 * dt / 1000;
    this.deps.entity.setFacing(this.state!.boss, entity.angle + Math.max(-limit, Math.min(limit, diff)));
  }

  private chooseAction(now: number): void {
    const s = this.state!, entity = this.deps.entity.readBoss(s.boss), target = this.deps.intent.readTarget(s.boss);
    if (!entity || !target) return;
    const desired = Math.atan2(target.y - entity.y, target.x - entity.x);
    const error = Math.abs(Math.atan2(Math.sin(desired - entity.angle), Math.cos(desired - entity.angle)));
    if (error > (s.phase.kind === 'land' ? this.config.slam.frontArcDegrees * Math.PI / 360 : Math.PI / 36)) return;
    if (s.phase.kind === 'surfaced') {
      const approach = this.deps.waterApproach(entity, target);
      if (approach && Math.hypot(approach.x - entity.x, approach.y - entity.y) > 1) return;
      if (this.nextWaterAction === 'ink') this.startAttack('ink', now, entity);
      else this.startEggs(now, entity);
      this.nextWaterAction = this.nextWaterAction === 'ink' ? 'eggs' : 'ink';
    } else {
      // An overdue ability gets priority over repeating slam, avoiding starvation at close range.
      const ready = (['slam', 'ink', 'eggs'] as const).filter(k => now >= this.cooldowns[k]
        && (k === 'slam' || error <= Math.PI / 36)
        && (k !== 'slam' || Math.hypot(target.x - entity.x, target.y - entity.y) <= this.config.bodyRadiusPx + this.config.slam.length))
        .sort((a, b) => this.cooldowns[a] - this.cooldowns[b]);
      const kind = ready[0];
      if (!kind) return;
      if (kind === 'eggs') this.startEggs(now, entity); else this.startAttack(kind, now, entity);
      this.cooldowns[kind] = now + this.config.landCooldowns[`${kind}Ms`];
    }
  }

  private startAttack(kind: 'ink' | 'slam', now: number, entity: Point & { angle: number }): void {
    const c = this.config[kind], offset = kind === 'ink' ? this.config.ink.mouthOffset : { x: this.config.bodyRadiusPx, y: 0 };
    const origin = this.rotateOffset(entity, offset), attackId = this.id(kind);
    const attack: EnemyAreaClawAttack = { attackId, weaponId: `kraken-${kind}`, presentation: kind,
      startedAt: now, strikeAt: now + c.windupMs,
      hitAt: now + c.windupMs + (kind === 'ink' ? this.config.ink.spitDelayMs : this.config.slam.strikeMs),
      endsAt: now + c.windupMs + (kind === 'ink' ? this.config.ink.spitDelayMs : this.config.slam.strikeMs) + c.recoveryMs,
      pose: { originX: origin.x, originY: origin.y, angle: entity.angle,
        geometry: kind === 'ink' ? { kind: 'sector', range: this.config.ink.range, arcDegrees: this.config.ink.arcDegrees }
          : { kind: 'lane', length: this.config.slam.length, width: this.config.slam.width } } };
    this.state!.bodyAction = kind === 'ink' ? { kind, attackId, startedAt: now, chargeAt: attack.strikeAt, spitAt: attack.hitAt, endsAt: attack.endsAt } : { kind, attackId };
    this.bodyProgress = { actionId: attackId, released: false, impacted: false };
    if (kind === 'slam') this.lunge = { from: { x: entity.x, y: entity.y }, distance: 0, stopped: false };
    this.bodyClaw = { revision: this.bodyClaw.revision + 1, attack };
    this.move(this.state!.phase.kind === 'land' ? 'locked' : 'water-anchored', null);
    this.emitClaw({ kind: 'body' }, this.bodyClaw);
  }

  private startEggs(now: number, entity: Point & { angle: number }): void {
    const c = this.config.eggs, castId = this.id('eggs'), s = this.state!;
    const rotation = this.deps.random() * Math.PI * 2;
    const points = this.deps.eggLandings(entity, rotation, c.volleyCount, this.config.eggs.minimumShoreDistancePx);
    const releaseAt = now + c.windupMs;
    const action: KrakenBodyAction = { kind: 'eggs', castId, startedAt: now, releaseAt,
      endsAt: releaseAt + (c.volleyCount - 1) * this.config.eggs.releaseSpacingMs + c.recoveryMs };
    this.throws = [];
    for (let i = 0; i < c.volleyCount; i++) {
      const to = points[i]; if (!to) continue;
      const from = this.rotateOffset(entity, c.releaseOffsets[i]);
      if (!this.deps.flightFree(from, to, c.radiusPx)) continue;
      const effect: KrakenEggLandEffect = { type: 'kraken_egg_land', boss: s.boss, castId,
        eggId: this.id('egg'), broodTableId: c.broodTable.id, originId: this.originId ?? s.boss.id };
      if (this.deps.brood.reserveEgg(effect)) this.throws.push({ effect, from, to,
        releaseAt: releaseAt + i * this.config.eggs.releaseSpacingMs, released: false });
    }
    s.bodyAction = action;
    this.bodyProgress = { actionId: castId, released: false, impacted: false };
    this.move(s.phase.kind === 'land' ? 'locked' : 'water-anchored', null);
  }

  /** Encounter origin is supplied by AP2; children keep it across egg/projectile lifetimes. */
  originId: string | null = null;

  private updateBody(now: number): void {
    const s = this.state!, action = s.bodyAction!, progress = this.bodyProgress!;
    if (action.kind === 'eggs') {
      for (const egg of this.throws) {
        if (egg.released || now < egg.releaseAt) continue;
        egg.released = true;
        // A large host step must not collapse the stagger into a simultaneous catch-up volley.
        let nextRelease = now + this.config.eggs.releaseSpacingMs;
        for (const future of this.throws) if (!future.released) {
          future.releaseAt = Math.max(future.releaseAt, nextRelease);
          nextRelease = future.releaseAt + this.config.eggs.releaseSpacingMs;
          action.endsAt = Math.max(action.endsAt, future.releaseAt + this.config.eggs.recoveryMs);
        }
        action.endsAt = Math.max(action.endsAt, now + this.config.eggs.recoveryMs);
        if (!this.alive() || !this.deps.flightFree(egg.from, egg.to, this.config.eggs.radiusPx)) { this.deps.brood.cancelEgg(egg.effect); continue; }
        const distance = Math.hypot(egg.to.x - egg.from.x, egg.to.y - egg.from.y), flightMs = this.config.eggs.flightMs;
        const projectile = this.deps.projectiles.spawnProjectile({
          origin: { ...egg.from, angle: Math.atan2(egg.to.y - egg.from.y, egg.to.x - egg.from.x) },
          flight: { speed: distance / (flightMs / 1000), size: this.config.eggs.radiusPx * 2,
            lifetimeMs: flightMs, fuseTimeMs: flightMs, maxBounces: 0, isGrenade: true,
            collisionFilter: { airborne: true } },
          provenance: { gameplaySourceId: s.boss.id, gameplaySourceKind: 'enemy', attributionId: s.boss.id,
            attributionKind: 'enemy', allegiance: { ownerId: s.boss.id, kind: 'enemy' },
            weaponSourceId: 'kraken-eggs', correlation: { executionId: action.castId } },
          // Authored presentation; the semantic land effect retains gameplay identity.
          interaction: { grenadeEffect: egg.effect }, presentation: { style: 'grenade', color: 0xffffff, grenadePreset: this.config.eggs.presentationPreset },
        });
        this.deps.brood.released(egg.effect, projectile);
        break;
      }
      progress.released = this.throws.every(e => e.released);
      if (now >= action.endsAt) this.finishBody(now);
      return;
    }
    const attack = this.bodyClaw.attack;
    if (!attack) return;
    if (!progress.impacted && now >= attack.hitAt) {
      progress.impacted = true;
      if (action.kind === 'ink') s.inkClouds.push({ attackId: attack.attackId, pose: attack.pose,
        spitAt: attack.hitAt, cloudEndsAt: attack.hitAt + this.config.ink.cloudFadeMs });
      this.impact(attack, { kind: 'body' }, this.bodyClaw.revision, this.config[action.kind].damage, now);
    }
    if (this.state === s && s.bodyAction === action && now >= attack.endsAt) this.finishBody(now);
  }
  private advanceLunge(now: number, entity: Point): void {
    const attack = this.bodyClaw.attack, lunge = this.lunge;
    if (!attack || !lunge || lunge.stopped || now < attack.strikeAt) return;
    const desired = this.config.slam.lungeDistancePx * Math.min(1, (now - attack.strikeAt) / (attack.hitAt - attack.strikeAt));
    const point = (d: number): Point => ({ x: lunge.from.x + Math.cos(attack.pose.angle) * d,
      y: lunge.from.y + Math.sin(attack.pose.angle) * d });
    let distance = desired;
    if (!this.deps.canMove(entity, point(distance), 'land')) {
      let low = lunge.distance, high = distance;
      // Every query sweeps the complete body circle, including obstacles between both endpoints.
      for (let i = 0; i < 16; i++) { const mid = (low + high) / 2;
        if (this.deps.canMove(entity, point(mid), 'land')) low = mid; else high = mid;
      }
      distance = low; lunge.stopped = true;
    }
    lunge.distance = distance;
    // Existing explicit-position movement mode; land phase and targetability remain authoritative.
    this.move('ashore', point(distance));
  }
  private finishBody(now: number): void { this.cancelBody(); this.nextActionAt = now + (this.state?.phase.kind === 'land' ? 0 : this.config.actionPauseMs); }
  private cancelBody(): void {
    const s = this.state; if (!s) return;
    s.bodyAction = null; this.bodyProgress = null; this.lunge = null;
    const eggs = this.throws; this.throws = [];
    for (const egg of eggs) if (!egg.released) this.deps.brood.cancelEgg(egg.effect);
    if (this.bodyClaw.attack) this.clearClaw({ kind: 'body' }, s.boss);
    this.nextActionAt = this.now + this.config.actionPauseMs;
  }

  private updateParts(now: number): void {
    const s = this.state!, p = s.phase;
    if (p.kind !== 'submerged') return;
    for (const part of [...this.parts.values()]) {
      const attack = part.state.claw.attack;
      if (!attack || part.progress.impacted || now < attack.hitAt) continue;
      part.progress.impacted = true;
      if (!this.deps.habitat.revalidateLane(part.lane)) { this.retractPart(part.state.contact.identity); continue; }
      this.impact(attack, this.slot(part.state), part.state.claw.revision, this.config.tentacles.damage, now);
      if (!this.alive()) return;
    }
    this.expireParts(now);
    if ((s.phaseTwoPending || now >= p.stopSpawningAt) && !this.parts.size) { this.surface(now); return; }
    if (s.phaseTwoPending || now >= p.stopSpawningAt || now < this.nextPartAt) return;
    this.nextPartAt = now + this.config.tentacles.retryMs;
    const target = this.deps.intent.readTarget(s.boss), secondary = this.deps.intent.readSecondaryTargets(s.boss);
    if (!target && !secondary.length) return;
    const lanes = this.deps.habitat.reserveLanes(s.boss, s.habitatId, target ? [target, ...secondary] : secondary,
      this.config.tentacles.maxConcurrent - this.parts.size);
    for (const lane of lanes) this.createPart(lane, now);
  }
  private createPart(lane: KrakenLaneReservation, now: number): void {
    const s = this.state!, c = this.config.tentacles, partId = this.id('part');
    const attack: EnemyAreaClawAttack = { attackId: this.id('tentacle'), weaponId: 'kraken-tentacle', pose: lane.pose,
      presentation: 'tentacle', startedAt: now, strikeAt: now + c.windupMs,
      hitAt: now + c.windupMs + c.strikeMs, endsAt: now + c.windupMs + c.strikeMs + c.recoveryMs };
    const part: KrakenTentacleState = { revision: 1, phase: 'rise', startedAt: now, hoverAt: now + c.riseMs,
      retractAt: attack.endsAt, endsAt: attack.endsAt + c.retractMs,
      claw: { revision: 1, attack }, contact: { identity: { boss: s.boss, partId, partGeneration: 1, cycleId: s.cycleId },
        contactId: this.id('contact'), hitboxProfileId: c.hitboxProfileId,
        x: lane.waterEntry.x, y: lane.waterEntry.y, angle: lane.pose.angle,
        targetableFrom: now + c.targetableAfterRiseMs, targetableUntil: attack.endsAt + c.untargetableAfterRetractMs } };
    this.parts.set(partId, { state: part, lane, progress: { actionId: attack.attackId, impacted: false, released: false } });
    this.syncParts(); this.emitClaw(this.slot(part), part.claw);
  }
  private expireParts(now: number): void {
    for (const [id, part] of [...this.parts]) {
      const s = part.state;
      // Promised impacts are resolved in the combat step, even when one step spans recovery.
      if (s.claw.attack && !part.progress.impacted && now >= s.claw.attack.hitAt) continue;
      if (now >= s.endsAt) { this.removePart(id); continue; }
      if (now >= s.retractAt) {
        if (s.claw.attack) this.retractPart(s.contact.identity, false);
        s.phase = 'retract';
      } else if (s.phase !== 'retract') {
        const phase = now >= (s.claw.attack?.strikeAt ?? Infinity) ? 'slam' : now >= s.hoverAt ? 'hover' : 'rise';
        if (phase !== s.phase) { s.phase = phase; s.revision++; }
      }
    }
  }
  private retractPart(identity: CombatPartIdentity, cancelled = true): void {
    const part = this.parts.get(identity.partId);
    if (!part || part.state.phase === 'retract') return;
    const p = part.state;
    if (cancelled) this.contacts.invalidate(p.contact.contactId);
    part.progress.impacted = true;
    p.phase = 'retract'; p.revision++;
    if (cancelled) {
      p.retractAt = this.now;
      p.startedAt = Math.min(p.startedAt, this.now - .002);
      p.hoverAt = Math.min(p.hoverAt, this.now - .001);
      p.endsAt = this.now + this.config.tentacles.retractMs;
    }
    // Contact invalidation is immediate; keep the serialized window ordered.
    if (cancelled) p.contact.targetableUntil = Math.max(p.contact.targetableFrom + 0.001, Math.min(p.contact.targetableUntil, this.now));
    p.claw = { revision: p.claw.revision + 1, attack: null };
    this.emitClaw(this.slot(p), p.claw); this.syncParts();
  }
  private removePart(id: string): void {
    const part = this.parts.get(id); if (!part) return;
    this.parts.delete(id); this.deps.habitat.release(part.lane.reservationId);
    if (part.state.claw.attack) this.emitClaw(this.slot(part.state), { revision: part.state.claw.revision + 1, attack: null });
    this.syncParts();
  }
  private surface(now: number): void {
    this.contacts.clear(); const s = this.state!, d = this.config.dive;
    s.phase = { kind: 'surfacing', startedAt: now, vulnerableAt: now + d.vulnerableAtMs,
      endsAt: now + d.surfaceDurationMs, recoveryEndsAt: now + d.surfaceDurationMs + d.recoveryMs };
    s.cycleId++; this.targetability('protected', now);
  }

  private beginExit(now: number): void {
    if (now < this.nextExitRetry) return;
    this.nextExitRetry = now + this.config.exit.retryMs;
    const s = this.state!, intent = this.deps.intent.readTarget(s.boss), players = this.deps.intent.readSecondaryTargets(s.boss);
    const target = intent ?? (players.length ? { x: players.reduce((sum, p) => sum + p.x, 0) / players.length,
      y: players.reduce((sum, p) => sum + p.y, 0) / players.length } : undefined);
    const result = this.deps.habitat.reserveExit(s.boss, s.habitatId, target);
    if (result.status !== 'valid') { this.blocked(now, result.reason); return; }
    this.exit = result.value; this.exitIndex = 0;
    const c = this.config.exit, moveAt = now + c.warningMs;
    let previous: Point = this.lastPose, length = 0;
    for (const p of this.exit.path) { length += Math.hypot(p.x - previous.x, p.y - previous.y); previous = p; }
    this.exitLength = length; this.exitTravelled = 0;
    s.phase = { kind: 'ashore', corridorId: this.exit.corridorId, startedAt: now, moveAt,
      gripAt: moveAt + c.gripAfterMs, heaveAt: moveAt + c.heaveAfterMs,
      endsAt: moveAt + c.durationMs, recoveryEndsAt: moveAt + c.durationMs + c.recoveryMs, blocked: false };
    this.targetability('protected', now); this.move('locked', null);
    this.blockedSince = null;
  }
  private advanceExit(now: number, dt: number, entity: Point & { angle: number }): void {
    const s = this.state!, p = s.phase;
    if (p.kind !== 'ashore' || !this.exit) return;
    const valid = this.deps.habitat.revalidateExit(this.exit);
    if (valid.status !== 'valid') {
      this.pauseExit(now, dt); this.blocked(now, valid.reason);
      // Topology revoked the permit: restart a warned authored corridor from the current safe pose.
      if (valid.status === 'invalid' && now >= this.nextExitRetry) {
        this.deps.habitat.release(this.exit.reservationId); this.exit = null;
        s.phase = { kind: 'surfaced', startedAt: now, nextDiveAt: now + this.config.dive.intervalMs };
        this.targetability('exposed', now); this.beginExit(now);
      }
      return;
    }
    p.blocked = false; this.blockedSince = null;
    const facing = this.exit.path.slice(this.exitIndex).find(q => Math.hypot(q.x - entity.x, q.y - entity.y) > 1);
    if (facing) this.facePoint(entity, facing, dt);
    if (now < p.moveAt) { this.move('locked', null); return; }
    const desired = this.exitLength * krakenExitDistance(p, now, this.config.exit);
    let position: Point = entity, remaining = Math.max(0, desired - this.exitTravelled), index = this.exitIndex;
    while (index < this.exit.path.length) {
      const waypoint = this.exit.path[index], distance = Math.hypot(waypoint.x - position.x, waypoint.y - position.y);
      const next = this.step(position, waypoint, remaining);
      if (!this.deps.canMove(position, next, 'ashore')) { this.pauseExit(now, dt); this.blocked(now, 'Exit movement obstructed'); return; }
      position = next; remaining -= distance;
      if (remaining < 0) break;
      index++;
    }
    this.exitIndex = index; this.exitTravelled = desired;
    this.move('ashore', position);
    if (this.exitIndex >= this.exit.path.length && now >= p.recoveryEndsAt) {
      this.deps.habitat.release(this.exit.reservationId); this.exit = null;
      s.phase = { kind: 'land', startedAt: now }; this.targetability('exposed', now);
      // Apply final waypoint before ordinary land navigation becomes available next step.
      this.nextActionAt = now + this.config.actionPauseMs;
    }
  }
  private pauseExit(now: number, dt: number): void {
    const p = this.state!.phase; if (p.kind !== 'ashore') return;
    const delay = Math.min(dt, Math.max(0, now - p.moveAt));
    p.blocked = true; p.moveAt += delay; p.gripAt += delay; p.heaveAt += delay;
    p.endsAt += delay; p.recoveryEndsAt += delay; this.move('locked', null);
  }
  private blocked(now: number, reason: string): void {
    this.blockedSince ??= now;
    if (!this.diagnosticSent && now - this.blockedSince >= this.config.exit.diagnosticAfterMs) {
      this.diagnosticSent = true; this.deps.diagnostic(`Kraken exit blocked: ${reason}`);
    }
  }

  private die(now: number): void {
    const s = this.state; if (!s || s.phase.kind === 'dying' || s.phase.kind === 'removed') return;
    const land = s.phase.kind === 'land' || s.phase.kind === 'ashore' && now >= s.phase.gripAt;
    const submerged = s.bodyTargetability.mode === 'hidden';
    this.cancelBody();
    s.phase = { kind: 'dying', startedAt: now, endsAt: now + (land ? this.config.death.landMs : this.config.death.waterMs),
      terminalPose: { ...this.lastPose }, asset: land ? 'land' : 'water', submerged };
    this.targetability('protected', now); this.move('locked', null);
    for (const id of [...this.parts.keys()]) this.removePart(id);
    this.contacts.clear(); this.deps.brood.clearBoss(s.boss); s.eggs = []; s.inkClouds = [];
    if (this.exit) this.deps.habitat.release(this.exit.reservationId); this.exit = null;
  }
  private advanceDeath(now: number): void {
    const s = this.state;
    if (s?.phase.kind === 'dying' && now >= s.phase.endsAt) s.phase = { kind: 'removed', removedAt: now };
  }
  private impact(attack: EnemyAreaClawAttack, slot: EnemyClawSlot, revision: number, damage: number, now: number): void {
    const boss = this.state!.boss;
    this.deps.combat.resolveAreaAttack({ claw: { worldRevision: boss.scope.worldRevision,
      activityRevision: boss.instance.activityRevision, enemyId: boss.id, entityGeneration: boss.instance.entityGeneration,
      slot, revision, attack }, source: { gameplaySource: { kind: 'enemy', id: boss.id }, attribution: { kind: 'enemy', id: boss.id },
      allegiance: { ownerId: boss.id, kind: 'enemy' }, authoredSourceId: attack.weaponId, origin: 'direct', correlation: { executionId: attack.attackId } },
      damage, nowMs: now, targetPolicy: 'hostile-combatants' });
  }
  private alive(): boolean {
    if (!this.state || ['dying', 'removed'].includes(this.state.phase.kind)) return false;
    const entity = this.deps.entity.readBoss(this.state.boss);
    return !!entity?.alive && entity.hp > 0;
  }
  private targetability(mode: KrakenState['bodyTargetability']['mode'], at: number): void {
    const s = this.state!; if (s.bodyTargetability.mode === mode) return;
    s.bodyTargetability = { revision: s.bodyTargetability.revision + 1, effectiveAt: at, mode };
    this.deps.entity.setBodyTargetability(s.boss, s.bodyTargetability);
  }
  private move(mode: KrakenState['movement'], destination: Point | null): void { const s = this.state!; s.movement = mode; this.deps.entity.setMovement(s.boss, mode, destination); }
  private emitClaw(slot: EnemyClawSlot, state: EnemyAreaClawState, boss = this.state!.boss): void {
    this.deps.claw({ worldRevision: boss.scope.worldRevision, activityRevision: boss.instance.activityRevision,
      enemyId: boss.id, entityGeneration: boss.instance.entityGeneration, slot, state: structuredClone(state) });
  }
  private clearClaw(slot: EnemyClawSlot, boss: BossTargetRef): void {
    if (slot.kind === 'body') this.bodyClaw = { revision: this.bodyClaw.revision + 1, attack: null };
    this.emitClaw(slot, slot.kind === 'body' ? this.bodyClaw : { revision: (this.parts.get(slot.partId)?.state.claw.revision ?? 0) + 1, attack: null }, boss);
  }
  private slot(p: KrakenTentacleState): EnemyClawSlot { const i = p.contact.identity; return { kind: 'part', partId: i.partId, partGeneration: i.partGeneration, cycleId: i.cycleId }; }
  private syncParts(): void { if (this.state) this.state.tentacles = [...this.parts.values()].map(p => structuredClone(p.state)); this.contacts.sync(this.state?.tentacles ?? []); }
  private publish(): void { if (this.state) { this.state.revision++; this.deps.publish.publish(this.getState()); } }
  private id(kind: string): string { return `${this.state!.boss.id}:${this.state!.boss.instance.entityGeneration}:${kind}:${++this.sequence}`; }
  private step(from: Point, to: Point, distance: number): Point { const d = Math.hypot(to.x - from.x, to.y - from.y), t = d ? Math.min(1, Math.max(0, distance) / d) : 1; return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }; }
  private rotateOffset(p: Point & { angle: number }, offset: Point): Point { return { x: p.x + Math.cos(p.angle) * offset.x - Math.sin(p.angle) * offset.y, y: p.y + Math.sin(p.angle) * offset.x + Math.cos(p.angle) * offset.y }; }
}
