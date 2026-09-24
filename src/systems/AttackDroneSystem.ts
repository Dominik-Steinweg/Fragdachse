import { ATTACK_DRONE_RULES as R, attackDroneBurstShots, shouldServiceAttackDrone, type AttackDroneStats } from '../config/attackDrone';
import type { AttackDronePhase, SyncedAttackDrone } from '../types';
import { AttackDroneTargetIndex, droneDistance, droneExplosionTouches, nearestDroneTargetPoint, selectDroneBombCorridor, selectDroneGunTarget,
  type AttackDroneTarget, type DroneBombCorridor, type DronePoint, type DroneRect } from './AttackDroneTargeting';

export interface AttackDroneStation extends DronePoint {
  readonly id: number; readonly ownerId: string; readonly ownerColor: number; readonly stats: AttackDroneStats;
}
export interface AttackDroneOwner extends DronePoint { readonly alive: boolean; readonly available: boolean }
export interface AttackDroneAttack extends DronePoint {
  readonly stationId: number; readonly droneId: string; readonly ownerId: string; readonly ownerColor: number;
  readonly attackId: string; readonly at: number; readonly stats: AttackDroneStats;
}
export interface AttackDronePorts {
  readonly bounds: DroneRect;
  readonly stations: () => readonly AttackDroneStation[];
  readonly owner: (id: string) => AttackDroneOwner | null;
  readonly targets: () => readonly AttackDroneTarget[];
  readonly readTarget: (key: string) => AttackDroneTarget | null;
  readonly canTarget: (ownerId: string, target: AttackDroneTarget) => boolean;
  readonly fire: (shot: AttackDroneAttack & { readonly angle: number }) => void;
  /** The World effect owner retains dropped bombs independently of station/drone lifetime. */
  readonly dropBomb: (bomb: AttackDroneAttack) => void;
}
interface DroneRuntime {
  id: string; station: AttackDroneStation; x: number; y: number; flightAngle: number; gunAngle: number;
  phase: AttackDronePhase; phaseStartedAt: number; lastShotAt: number; shotSequence: number;
  anchor: DronePoint; ammo: number; exhausted: boolean; gunReadyAt: number; bombReadyAt: number;
  nextScanAt: number; nextSupplyAt: number; nextPatrolAt: number; random: number;
  destination: DronePoint; burst?: { keys: readonly string[]; centerAngle: number; sweep: number; nextShot: number; attackId: string };
  corridor?: DroneBombCorridor; dropped: number; bombAttackId: string; attackSequence: number;
  serviceEndsAt: number; waitDeadline: number;
}

/** Host-only station companion simulation. It requires no scene, renderer, network or physics body. */
export class AttackDroneSystem {
  private readonly drones = new Map<number, DroneRuntime>();
  private readonly index = new AttackDroneTargetIndex();
  private nextTargetRefreshAt = -Infinity;
  private generation = 0;
  private clock: number | null = null;
  constructor(private readonly ports: AttackDronePorts) {}

  update(now: number, deltaMs: number): void {
    if (!Number.isFinite(now) || !Number.isFinite(deltaMs)) return;
    const stations = this.ports.stations();
    const present = new Set<number>();
    const start = Math.max(this.clock ?? now - Math.max(0, deltaMs), now - Math.max(0, deltaMs));
    for (const station of stations) {
      present.add(station.id);
      const existing = this.drones.get(station.id);
      if (existing && existing.station.ownerId === station.ownerId) existing.station = station;
      else this.drones.set(station.id, this.create(station, start));
    }
    for (const id of this.drones.keys()) if (!present.has(id)) this.drones.delete(id);
    // Bounded local integration slices preserve phase transitions and regeneration during a hitch.
    // Scheduled shot times and distance-based drops remain independent of the outer frame rate.
    let time = start;
    do {
      const next = Math.min(now, time + 25);
      if (next >= this.nextTargetRefreshAt) {
        this.index.replace(this.ports.targets()); this.nextTargetRefreshAt = next + R.targetScanMs;
      }
      for (const drone of this.drones.values()) this.step(drone, next, next - time);
      time = next;
    } while (time < now);
    this.clock = now;
  }

  getSnapshot(): SyncedAttackDrone[] {
    return [...this.drones.values()].map(d => ({ id: d.id, stationId: d.station.id,
      ownerId: d.station.ownerId, ownerColor: d.station.ownerColor, x: d.x, y: d.y,
      flightAngle: d.flightAngle, gunAngle: d.gunAngle, phase: d.phase, phaseStartedAt: d.phaseStartedAt,
      lastShotAt: d.lastShotAt, shotSequence: d.shotSequence }));
  }
  /** Read-only diagnostics for the existing balance/stress harnesses. */
  getDiagnostics(): readonly { stationId: number; phase: AttackDronePhase; ammo: number; bombReadyAt: number }[] {
    return [...this.drones.values()].map(d => ({ stationId: d.station.id, phase: d.phase, ammo: d.ammo, bombReadyAt: d.bombReadyAt }));
  }
  invalidateActivity(): void {
    this.index.clear(); this.nextTargetRefreshAt = -Infinity;
    for (const d of this.drones.values()) {
      d.burst = undefined; d.corridor = undefined;
      if (d.phase === 'gun' || d.phase === 'bomb_run' || d.phase === 'bomb_approach') this.phase(d, 'patrol', this.clock ?? 0);
    }
  }
  clear(): void { this.drones.clear(); this.index.clear(); this.clock = null; this.nextTargetRefreshAt = -Infinity; }

  private create(station: AttackDroneStation, now: number): DroneRuntime {
    const owner = this.ports.owner(station.ownerId);
    let seed = station.id | 0;
    for (const char of station.ownerId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    return { id: `${station.id}:${++this.generation}`, station, x: station.x, y: station.y,
      flightAngle: 0, gunAngle: 0, phase: 'catchup', phaseStartedAt: now, lastShotAt: -1, shotSequence: 0,
      anchor: owner ? { x: owner.x, y: owner.y } : station, ammo: R.magazine, exhausted: false,
      gunReadyAt: now, bombReadyAt: now, nextScanAt: now, nextSupplyAt: now, nextPatrolAt: now,
      random: seed >>> 0 || 1, destination: station, dropped: 0, bombAttackId: '', attackSequence: 0,
      serviceEndsAt: 0, waitDeadline: 0 };
  }
  private step(d: DroneRuntime, now: number, dt: number): void {
    const owner = this.ports.owner(d.station.ownerId), s = d.station.stats;
    if (owner?.alive && owner.available) d.anchor = { x: owner.x, y: owner.y };
    const available = owner?.available === true;
    if (!available && !['returning', 'servicing', 'docked'].includes(d.phase)) {
      d.burst = undefined; d.corridor = undefined; this.phase(d, 'returning', now);
    }
    if (d.phase !== 'gun' && d.phase !== 'servicing') d.ammo = Math.min(R.magazine, d.ammo + s.regenerationPerMs * dt);
    if (d.ammo + 1e-8 >= attackDroneBurstShots()) d.exhausted = false;
    if (d.phase === 'docked') {
      d.x = d.station.x; d.y = d.station.y;
      if (available) this.phase(d, 'catchup', now);
      return;
    }
    if (d.phase === 'returning') {
      if (this.move(d, d.station, s.travelSpeed, dt)) {
        this.phase(d, 'servicing', now); d.serviceEndsAt = now + s.serviceMs;
      }
      return;
    }
    if (d.phase === 'servicing') {
      d.x = d.station.x; d.y = d.station.y;
      if (now >= d.serviceEndsAt) { d.ammo = R.magazine; d.exhausted = false; this.phase(d, available ? 'catchup' : 'docked', now); }
      return;
    }
    if (d.phase === 'gun') { this.gun(d, now, dt); return; }
    if (d.phase === 'bomb_approach' || d.phase === 'bomb_run') { this.bombs(d, now, dt); return; }
    if (d.phase === 'catchup') {
      if (droneDistance(d, d.anchor) > R.catchupEndRadius) { this.move(d, d.anchor, s.travelSpeed, dt); return; }
      this.phase(d, 'patrol', now);
    }
    if (droneDistance(d, d.anchor) > R.catchupStartRadius) { this.phase(d, 'catchup', now); return; }
    if (now >= d.nextScanAt) {
      d.nextScanAt = now + R.targetScanMs;
      if (this.decide(d, now)) return;
    }
    if (now >= d.nextPatrolAt || droneDistance(d.destination, d.anchor) > R.ownerRadius) {
      const angle = this.random(d) * Math.PI * 2, radius = R.patrolMinRadius + this.random(d) * (R.patrolMaxRadius - R.patrolMinRadius);
      d.destination = this.clamp({ x: d.anchor.x + Math.cos(angle) * radius, y: d.anchor.y + Math.sin(angle) * radius });
      d.nextPatrolAt = now + R.patrolMinMs + this.random(d) * (R.patrolMaxMs - R.patrolMinMs);
    }
    this.move(d, d.destination, s.patrolSpeed, dt);
  }
  private decide(d: DroneRuntime, now: number): boolean {
    const targets = this.index.query(d.anchor, R.ownerRadius + R.range + R.muzzleOffset)
      .filter(t => this.ports.readTarget(t.key) && this.ports.canTarget(d.station.ownerId, t));
    const gun = selectDroneGunTarget(d, targets);
    const corridor = d.station.stats.bombsEnabled && d.bombReadyAt - now <= R.bombWaitMs
      ? selectDroneBombCorridor(d, d.anchor, targets, d.station.stats.bombCount, this.ports.bounds) : null;
    const bombPreferred = !!corridor && (corridor.targetKeys.length >= R.bombGroupThreshold || d.exhausted);
    if (bombPreferred && now >= d.bombReadyAt) { this.beginBombs(d, corridor!, now); return true; }
    if (gun && !d.exhausted && d.ammo >= 1 && now >= d.gunReadyAt) {
      this.phase(d, 'gun', now);
      d.gunAngle = Math.atan2(gun.point.y - d.y, gun.point.x - d.x);
      // A short radial run preserves the firing solution. A full lateral burst-length flight
      // outruns the independent gun's limited tracking and can leave its own target out of range.
      const standoff = R.range / 2;
      d.destination = this.clampAttack({ x: gun.point.x - Math.cos(d.gunAngle) * standoff,
        y: gun.point.y - Math.sin(d.gunAngle) * standoff }, d.anchor);
      d.burst = { keys: gun.targetKeys, centerAngle: d.gunAngle,
        sweep: (gun.targetKeys.length > 1 ? R.groupSweepDegrees : R.singleSweepDegrees) * Math.PI / 180,
        nextShot: 0, attackId: `${d.id}:gun:${++d.attackSequence}` };
      this.gun(d, now, 0); return true;
    }
    if (now < d.nextSupplyAt) return false;
    d.nextSupplyAt = now + R.supplyScanMs;
    const returnPoint = this.rejoinPoint(d.station, d.anchor);
    const service = shouldServiceAttackDrone({ ammo: d.ammo, stats: d.station.stats,
      outboundDistance: droneDistance(d, d.station), inboundDistance: droneDistance(d.station, returnPoint),
      gunReadyInMs: Math.max(0, d.gunReadyAt - now), hasTargets: targets.length > 0, exhausted: d.exhausted });
    if (service) {
      if (bombPreferred && d.bombReadyAt - now <= R.bombWaitMs) this.beginBombs(d, corridor!, now);
      else this.phase(d, 'returning', now);
      return true;
    }
    return false;
  }
  private gun(d: DroneRuntime, now: number, dt: number): void {
    const b = d.burst!;
    const live = b.keys.map(key => this.ports.readTarget(key)).filter((t): t is AttackDroneTarget => !!t && this.ports.canTarget(d.station.ownerId, t));
    if (!live.length) { this.finishGun(d, now); return; }
    const target = nearestDroneTargetPoint(live[0], d);
    const desired = Math.atan2(target.y - d.y, target.x - d.x);
    const diff = Math.atan2(Math.sin(desired - b.centerAngle), Math.cos(desired - b.centerAngle));
    const turn = R.aimDegreesPerSecond * Math.PI / 180 * dt / 1000;
    b.centerAngle += Math.max(-turn, Math.min(turn, diff));
    this.move(d, d.destination, d.station.stats.attackSpeed, dt);
    while (b.nextShot < attackDroneBurstShots() && d.phaseStartedAt + b.nextShot * R.shotIntervalMs <= now && d.ammo >= 1) {
      const at = d.phaseStartedAt + b.nextShot * R.shotIntervalMs;
      d.gunAngle = b.centerAngle + b.sweep * (b.nextShot / (attackDroneBurstShots() - 1) - 0.5);
      d.ammo -= 1; d.shotSequence++; d.lastShotAt = at; b.nextShot++;
      this.ports.fire({ ...this.attack(d, b.attackId, at), x: d.x + Math.cos(d.gunAngle) * R.muzzleOffset,
        y: d.y + Math.sin(d.gunAngle) * R.muzzleOffset, angle: d.gunAngle });
    }
    if (d.ammo < 1 && b.nextShot < attackDroneBurstShots()) { d.exhausted = true; this.finishGun(d, now); }
    else if (now >= d.phaseStartedAt + R.burstMs) this.finishGun(d, d.phaseStartedAt + R.burstMs);
  }
  private finishGun(d: DroneRuntime, now: number): void {
    if (d.ammo < 1) d.exhausted = true;
    d.burst = undefined; d.gunReadyAt = now + R.pauseMs; d.nextScanAt = now; d.nextSupplyAt = now;
    this.phase(d, 'patrol', now);
  }
  private beginBombs(d: DroneRuntime, corridor: DroneBombCorridor, now: number): void {
    d.corridor = corridor; d.dropped = 0; d.waitDeadline = now + R.bombWaitMs;
    d.bombAttackId = `${d.id}:bomb:${++d.attackSequence}`;
    this.phase(d, 'bomb_approach', now);
  }
  private bombs(d: DroneRuntime, now: number, dt: number): void {
    const c = d.corridor!;
    if (d.phase === 'bomb_approach') {
      const valid = c.targetKeys.some(key => {
        const t = this.ports.readTarget(key);
        return t && this.ports.canTarget(d.station.ownerId, t)
          && c.drops.some(drop => droneExplosionTouches(t, drop, R.bombRadius));
      });
      if (!valid || (now > d.waitDeadline && now < d.bombReadyAt)) { d.corridor = undefined; this.phase(d, 'patrol', now); return; }
      if (!this.move(d, c.start, d.station.stats.attackSpeed, dt) || now < d.bombReadyAt) return;
      this.phase(d, 'bomb_run', now);
      this.drop(d, 0, now); d.dropped = 1;
      return;
    }
    const previousDistance = droneDistance(d, c.start);
    this.move(d, c.end, d.station.stats.attackSpeed, dt);
    const distance = droneDistance(d, c.start);
    while (d.dropped < c.drops.length && distance + 1e-7 >= R.bombLength * d.dropped / (c.drops.length - 1)) {
      const threshold = R.bombLength * d.dropped / (c.drops.length - 1);
      const at = now - dt + Math.max(0, threshold - previousDistance) / d.station.stats.attackSpeed * 1000;
      this.drop(d, d.dropped++, at);
      if (d.dropped === c.drops.length) d.bombReadyAt = at + R.bombCooldownMs;
    }
    if (d.dropped === c.drops.length) { d.corridor = undefined; d.nextScanAt = now; d.nextSupplyAt = now; this.phase(d, 'patrol', now); }
  }
  private drop(d: DroneRuntime, index: number, at: number): void {
    this.ports.dropBomb({ ...this.attack(d, `${d.bombAttackId}:${index}`, at), ...d.corridor!.drops[index] });
  }
  private attack(d: DroneRuntime, attackId: string, at: number): AttackDroneAttack {
    return { stationId: d.station.id, droneId: d.id, ownerId: d.station.ownerId, ownerColor: d.station.ownerColor,
      attackId, at, x: d.x, y: d.y, stats: d.station.stats };
  }
  private phase(d: DroneRuntime, phase: AttackDronePhase, now: number): void { d.phase = phase; d.phaseStartedAt = now; }
  private move(d: DroneRuntime, point: DronePoint, speed: number, dt: number): boolean {
    const distance = droneDistance(d, point), step = speed * dt / 1000;
    if (distance > 1e-8) {
      d.flightAngle = Math.atan2(point.y - d.y, point.x - d.x);
      const ratio = Math.min(1, step / distance), pos = this.clamp({ x: d.x + (point.x - d.x) * ratio, y: d.y + (point.y - d.y) * ratio });
      d.x = pos.x; d.y = pos.y;
    }
    return distance <= step + 1e-7;
  }
  private clamp(p: DronePoint): DronePoint {
    const b = this.ports.bounds; return { x: Math.max(b.left, Math.min(b.right, p.x)), y: Math.max(b.top, Math.min(b.bottom, p.y)) };
  }
  private clampAttack(p: DronePoint, owner: DronePoint): DronePoint {
    const distance = droneDistance(p, owner), factor = Math.min(1, R.attackRadius / Math.max(1, distance));
    return this.clamp({ x: owner.x + (p.x - owner.x) * factor, y: owner.y + (p.y - owner.y) * factor });
  }
  private rejoinPoint(station: DronePoint, owner: DronePoint): DronePoint {
    const distance = droneDistance(station, owner), f = Math.min(1, R.catchupEndRadius / Math.max(1, distance));
    return this.clamp({ x: owner.x + (station.x - owner.x) * f, y: owner.y + (station.y - owner.y) * f });
  }
  private random(d: DroneRuntime): number { d.random = (Math.imul(1664525, d.random) + 1013904223) >>> 0; return d.random / 4294967296; }
}
