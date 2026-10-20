import type { CombatActorStatePort, CombatDamageEffectPort } from '../../combat/CombatCapabilities';
import type { TrainManager } from '../../train/TrainManager';
import { findPortalCrossing, gatePortalExit, portalEndpointKey, releasePortalGates,
  type PortalGates, type PortalPair, type PortalPoint, type PortalQueryPort } from '../PortalTraversal';

export interface PortalActor extends PortalPoint {
  readonly id: string;
  readonly kind: 'player' | 'enemy';
  readonly radius: number;
  readonly alive: boolean;
  readonly surface: boolean;
  readonly revision: number;
  /** Classification for sources that admit only some bodies; absent counts as false. */
  readonly boss?: boolean;
  readonly fixed?: boolean;
}

/** Pull and slow of a collapsing pair; the translocator's authored values are one instance. */
export interface PortalCollapseConfig {
  readonly collapseRadius: number;
  readonly collapseSlowFraction: number;
  readonly collapseSlowDurationMs: number;
  readonly collapsePullSpeed: number;
  readonly collapsePullDurationMs: number;
}

export interface PortalTransportWorldPort {
  readonly getActors: () => readonly PortalActor[];
  readonly canOccupy: (actor: PortalActor, x: number, y: number) => boolean;
  readonly resolveExitMovement?: (actor: PortalActor, from: PortalPoint, to: PortalPoint) => PortalPoint;
  readonly transferActor: (actor: PortalActor, x: number, y: number) => void;
  readonly collapseEnemy: (actor: PortalActor, center: PortalPoint, config: PortalCollapseConfig,
    ownerId: string, now: number) => void;
}

export interface PortalTransportNetworkPort {
  readonly broadcastTranslocatorFlash: (x: number, y: number, color: number, phase: 'start' | 'end', ownerId: string) => void;
}

export interface PortalTransferFlash {
  readonly start: number;
  readonly end: number;
  /** Minimum spacing per endpoint, so a crowd crossing does not flood the flash channel. */
  readonly throttleMs?: number;
}

/** One owner of portal pairs. The transport moves actors through them but never changes their lifetime. */
export interface PortalPairSource {
  /** Same array identity until the source mutates its pairs. */
  getPortalPairs(): readonly PortalPair[];
  isPortalFriendly(ownerId: string, actorId: string): boolean;
  readonly transferFlash: PortalTransferFlash;
  /** Opens an exit gate after this time even without distance; absent keeps distance-only gates. */
  readonly gateReleaseMs?: number;
  admitsActor?(pair: PortalPair, actor: PortalActor): boolean;
  onActorTransferred?(pair: PortalPair, actor: PortalActor, now: number): void;
}

export interface PortalSourceRegistrationPort {
  register(source: PortalPairSource): () => void;
}

const NO_PAIRS: readonly PortalPair[] = Object.freeze([]);

/** Sole writer of actor portal jumps. Projectile and hitscan stages read the same merged pair view. */
export class WorldPortalTransport implements PortalQueryPort, PortalSourceRegistrationPort {
  private readonly sources: PortalPairSource[] = [];
  private sourceArrays: (readonly PortalPair[])[] = [];
  private merged: readonly PortalPair[] = NO_PAIRS;
  private readonly pairSource = new Map<string, PortalPairSource>();
  private readonly ownerSource = new Map<string, PortalPairSource>();
  private filtering = false;
  private readonly gates = new Map<string, PortalGates>();
  private readonly positions = new Map<string, PortalActor>();
  private readonly lastFlashAt = new Map<string, number>();
  private world: PortalTransportWorldPort | null = null;
  private positionResetCb: ((playerId: string, x: number, y: number) => void) | null = null;

  constructor(private readonly combat: Pick<CombatActorStatePort, 'isAlive'> & Pick<CombatDamageEffectPort, 'applyDamage'>,
    private readonly network: PortalTransportNetworkPort, private trainManager: TrainManager | null = null) {}

  bindWorld(world: PortalTransportWorldPort | null): void { this.world = world; }
  setTrainManager(train: TrainManager | null): void { this.trainManager = train; }
  setPositionResetCallback(cb: ((id: string, x: number, y: number) => void) | null): void { this.positionResetCb = cb; }

  register(source: PortalPairSource): () => void {
    if (!this.sources.includes(source)) this.sources.push(source);
    return () => {
      const index = this.sources.indexOf(source);
      if (index < 0) return;
      for (const pair of source.getPortalPairs()) this.forgetPair(pair);
      this.sources.splice(index, 1);
      this.refresh(true);
    };
  }

  getPortalPairs(): readonly PortalPair[] { this.refresh(false); return this.merged; }

  isPortalFriendly(ownerId: string, attackerId: string): boolean {
    this.refresh(false);
    const source = this.ownerSource.get(ownerId)
      ?? this.sources.find(candidate => candidate.getPortalPairs().some(pair => pair.ownerId === ownerId));
    return source?.isPortalFriendly(ownerId, attackerId) ?? false;
  }

  /** Initial gate of a traveler that is placed into an endpoint instead of crossing it. */
  gateActor(actorId: string, key: string, gate: { readonly center: PortalPoint; readonly releaseDistance: number }): void {
    this.actorGates(actorId).set(key, gate);
  }

  forgetPair(pair: PortalPair): void {
    const a = portalEndpointKey(pair, 'a'), b = portalEndpointKey(pair, 'b');
    for (const gates of this.gates.values()) { gates.delete(a); gates.delete(b); }
    this.lastFlashAt.delete(a); this.lastFlashAt.delete(b);
  }

  forgetActor(actorId: string): void { this.gates.delete(actorId); this.positions.delete(actorId); }

  clearActorState(): void { this.positions.clear(); this.gates.clear(); this.lastFlashAt.clear(); }

  /** A direct relocation (e.g. a translocator teleport) shares the flash and reset path of a crossing. */
  jump(actor: PortalActor, x: number, y: number, flash: PortalTransferFlash): void {
    this.move(actor, x, y, flash, null, null, 0);
  }

  /** After physics, before any owner consumes traveled actor segments. */
  transferActors(now: number, opening = false): void {
    const pairs = this.getPortalPairs();
    if (!this.world || !pairs.length) { this.positions.clear(); return; }
    const present = new Set<string>();
    for (const actor of this.world.getActors()) {
      present.add(actor.id);
      const previous = this.positions.get(actor.id);
      let from: PortalPoint = !opening && previous?.revision === actor.revision ? previous : actor;
      let to: PortalPoint = actor;
      const gates = this.actorGates(actor.id);
      releasePortalGates(gates, from, now);
      const visited = new Set<string>();
      let transfers = 0;
      if (actor.alive && actor.surface) {
        const excludedPairs = this.excludedPairs(actor, pairs);
        for (;;) {
          const hit = findPortalCrossing(pairs, from, to, { gates, excludedEndpoints: visited, excludedPairs });
          if (!hit) break;
          visited.add(hit.sourceKey);
          if (!this.world.canOccupy(actor, hit.exit.x, hit.exit.y)) continue;
          const source = this.pairSource.get(hit.pair.id);
          const rest = { x: to.x - hit.entry.x, y: to.y - hit.entry.y };
          gatePortalExit(gates, hit, source?.gateReleaseMs === undefined ? undefined : now + source.gateReleaseMs);
          from = hit.exit;
          const desired = { x: hit.exit.x + rest.x, y: hit.exit.y + rest.y };
          to = this.world.resolveExitMovement?.(actor, hit.exit, desired)
            ?? (this.world.canOccupy(actor, desired.x, desired.y) ? desired : hit.exit);
          this.move({ ...actor, x: hit.entry.x, y: hit.entry.y }, to.x, to.y, source?.transferFlash ?? null,
            hit.sourceKey, hit.exitKey, now);
          transfers++;
          source?.onActorTransferred?.(hit.pair, actor, now);
          if (actor.kind === 'player') {
            this.checkExitHazard(actor.id, to.x, to.y, actor.radius);
            if (!this.combat.isAlive(actor.id)) break;
          }
        }
      }
      this.positions.set(actor.id, { ...actor, x: to.x, y: to.y, revision: actor.revision + transfers });
    }
    for (const id of this.positions.keys()) if (!present.has(id)) { this.positions.delete(id); this.gates.delete(id); }
  }

  /** Pulls and slows living enemies near either endpoint; the caller decides who counts as hostile. */
  collapse(pair: PortalPair, config: PortalCollapseConfig, ownerId: string,
    affects: (actor: PortalActor) => boolean, now: number): void {
    if (!this.world) return;
    for (const actor of this.world.getActors()) {
      if (actor.kind !== 'enemy' || !actor.alive || !affects(actor)) continue;
      const da = Math.hypot(actor.x - pair.a.x, actor.y - pair.a.y);
      const db = Math.hypot(actor.x - pair.b.x, actor.y - pair.b.y);
      if (Math.min(da, db) <= config.collapseRadius) this.world.collapseEnemy(actor, da <= db ? pair.a : pair.b, config, ownerId, now);
    }
  }

  checkExitHazard(id: string, x: number, y: number, radius: number): void {
    for (const segment of this.trainManager?.getSegmentPositions() ?? []) {
      if (Math.abs(x - segment.x) < radius + 32 && Math.abs(y - segment.y) < radius + 32) {
        this.combat.applyDamage(id, 9999, true, 'train', 'Zug', { sourceX: segment.x, sourceY: segment.y }); break;
      }
    }
  }

  private move(actor: PortalActor, x: number, y: number, flash: PortalTransferFlash | null,
    startKey: string | null, endKey: string | null, now: number): void {
    if (flash && this.mayFlash(startKey, flash, now)) this.network.broadcastTranslocatorFlash(actor.x, actor.y, flash.start, 'start', actor.id);
    this.world!.transferActor(actor, x, y);
    if (actor.kind === 'player') this.positionResetCb?.(actor.id, x, y);
    if (flash && this.mayFlash(endKey, flash, now)) this.network.broadcastTranslocatorFlash(x, y, flash.end, 'end', actor.id);
  }

  private mayFlash(key: string | null, flash: PortalTransferFlash, now: number): boolean {
    if (!flash.throttleMs || key === null) return true;
    const last = this.lastFlashAt.get(key);
    if (last !== undefined && now - last < flash.throttleMs) return false;
    this.lastFlashAt.set(key, now);
    return true;
  }

  private excludedPairs(actor: PortalActor, pairs: readonly PortalPair[]): ReadonlySet<string> | undefined {
    if (!this.filtering) return undefined;
    let excluded: Set<string> | undefined;
    for (const pair of pairs) {
      const source = this.pairSource.get(pair.id);
      if (source?.admitsActor && !source.admitsActor(pair, actor)) (excluded ??= new Set()).add(pair.id);
    }
    return excluded;
  }

  private refresh(force: boolean): void {
    let changed = force || this.sourceArrays.length !== this.sources.length;
    for (let index = 0; !changed && index < this.sources.length; index++) {
      changed = this.sources[index].getPortalPairs() !== this.sourceArrays[index];
    }
    if (!changed) return;
    this.sourceArrays = this.sources.map(source => source.getPortalPairs());
    this.pairSource.clear(); this.ownerSource.clear();
    this.filtering = false;
    const filled: (readonly PortalPair[])[] = [];
    this.sources.forEach((source, index) => {
      const pairs = this.sourceArrays[index];
      if (pairs.length) filled.push(pairs);
      if (source.admitsActor && pairs.length) this.filtering = true;
      for (const pair of pairs) { this.pairSource.set(pair.id, source); this.ownerSource.set(pair.ownerId, source); }
    });
    // A single filled source keeps its own identity, so consumers that cache by reference stay stable.
    this.merged = filled.length === 0 ? NO_PAIRS : filled.length === 1 ? filled[0] : filled.flat();
  }

  private actorGates(id: string): PortalGates {
    let gates = this.gates.get(id); if (!gates) { gates = new Map(); this.gates.set(id, gates); } return gates;
  }
}
