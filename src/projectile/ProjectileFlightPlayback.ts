import { NET_TICK_INTERVAL_MS } from '../config';
import type { SyncedProjectile, ProjectileBouncePresentation } from '../types';
import { sampleProjectilePath, PROJECTILE_PATH_HISTORY_MS } from './ProjectileFlightPath';

interface BufferedFlight {
  projectile: SyncedProjectile;
  receivedAt: number;
  presentationTime: number;
  bounceSequence: number;
  appeared: boolean;
  headless: boolean;
}

/** A visual clock, never a replacement for the network/gameplay replica. */
export class ProjectileFlightPlayback {
  private readonly flights = new Map<number, BufferedFlight>();
  private readonly retired = new Map<number, { flight: BufferedFlight; expiresAt: number }>();

  sync(data: readonly SyncedProjectile[], now: number): void {
    this.prune(now);
    const incoming = new Set<number>();
    for (const projectile of data) {
      if (!projectile.flightPath) continue;
      const retired = this.retired.get(projectile.id);
      if (retired) {
        const oldPoints = retired.flight.projectile.flightPath!.points;
        const newPoints = projectile.flightPath.points;
        // Absence can precede the terminal packet. Heal only its new tail, never its head.
        if (!projectile.flightPath.ended
          || (newPoints[newPoints.length - 1]?.sequence ?? 0) <= (oldPoints[oldPoints.length - 1]?.sequence ?? 0)) continue;
        retired.flight.headless = true;
        this.flights.set(projectile.id, retired.flight);
        this.retired.delete(projectile.id);
      }
      incoming.add(projectile.id);
      const prior = this.flights.get(projectile.id);
      if (prior) {
        if (projectile.flightPath.timeMs < (prior.projectile.flightPath?.timeMs ?? 0)) continue;
        // A repeated tombstone must not restart its playback clock.
        if (prior.projectile.flightPath?.ended && projectile.flightPath.ended
          && (projectile.flightPath.points[projectile.flightPath.points.length - 1]?.sequence ?? 0)
            <= (prior.projectile.flightPath.points[prior.projectile.flightPath.points.length - 1]?.sequence ?? 0)) continue;
        if (projectile.flightPath.timeMs > prior.projectile.flightPath!.timeMs) prior.receivedAt = now;
        prior.projectile = projectile;
      } else this.flights.set(projectile.id, { projectile, receivedAt: now,
        presentationTime: projectile.flightPath.timeMs - NET_TICK_INTERVAL_MS,
        bounceSequence: 0, appeared: false, headless: projectile.flightPath.ended === true });
    }
    for (const [id, flight] of this.flights) {
      if (!incoming.has(id) && !flight.projectile.flightPath?.ended) {
        flight.projectile = { ...flight.projectile, flightPath: { ...flight.projectile.flightPath!, ended: true } };
      }
    }
  }

  has(id: number): boolean { return this.flights.has(id) || this.retired.has(id); }

  read(now: number, sink: (projectile: SyncedProjectile, timeMs: number, isNew: boolean,
    bounces: readonly ProjectileBouncePresentation[], complete: boolean, headless: boolean) => void): void {
    this.prune(now);
    for (const [id, flight] of this.flights) {
      const path = flight.projectile.flightPath!;
      const timeMs = Math.max(flight.presentationTime, path.timeMs + now - flight.receivedAt - NET_TICK_INTERVAL_MS);
      flight.presentationTime = timeMs;
      const position = sampleProjectilePath(path, timeMs);
      if (!position) continue;
      const bounces = (flight.projectile.bounceOutcomes ?? (flight.projectile.bounce ? [flight.projectile.bounce] : []))
        .filter(b => b.sequence > flight.bounceSequence && path.points.some(p => p.bounceSequence === b.sequence && p.timeMs <= timeMs));
      for (const b of bounces) flight.bounceSequence = Math.max(flight.bounceSequence, b.sequence);
      const complete = path.ended === true && timeMs >= path.timeMs;
      const isNew = !flight.appeared;
      // Late terminal history is rendered as trail only, without resurrecting a head.
      const projectile = { ...flight.projectile, x: position.x, y: position.y, vx: position.vx, vy: position.vy };
      sink(projectile, timeMs, isNew, bounces, complete, flight.headless);
      flight.appeared = true;
      if (complete) {
        this.flights.delete(id);
        this.retired.set(id, { flight, expiresAt: now + PROJECTILE_PATH_HISTORY_MS });
        if (this.retired.size > 8192) this.retired.delete(this.retired.keys().next().value!);
      }
    }
  }

  clear(): void { this.flights.clear(); this.retired.clear(); }
  private prune(now: number): void {
    for (const [id, entry] of this.retired) if (entry.expiresAt <= now) this.retired.delete(id);
  }
}
