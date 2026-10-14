import type { BomberSquadronUltimateConfig } from '../../loadout/LoadoutTypes';
import type {
  PlayerUltimateBomberSquadronCapability, PlayerUltimateBomberSquadronRequest, PlayerUltimateDeploymentResult,
} from '../../world/PlayerUltimateBehaviorRuntime';
import {
  bomberDrops, bomberLaunchAt, bomberPlanParamsFromConfig, bomberSquadronEndsAt, isBomberImpactInWorld,
  chooseBomberAim, isBomberFlightPlanValid, type BomberAimTarget, type BomberSquadronDrop, type BomberSquadronWorldBounds,
} from './BomberSquadronPlan';
import {
  bomberSquadronBombKey, EMPTY_BOMBER_SQUADRON_SNAPSHOT,
  type BomberSquadronAnchor, type BomberSquadronDeploymentSnapshot, type BomberSquadronSnapshot,
} from './BomberSquadronSnapshot';

/** Host-Fakten für den Schadensadapter; nicht Bestandteil des replizierten Flugplans. */
type BombConfig = Pick<BomberSquadronUltimateConfig, 'explosionRadius' | 'maxDamage' | 'minDamage' | 'fireChunksPerBomb'>;

export interface BomberSquadronBombEvent extends BomberSquadronDrop {
  readonly kind: 'drop' | 'impact';
  readonly at: number;
  readonly squadronId: number;
  readonly ownerId: string;
  readonly bombKey: string;
  readonly config: BombConfig;
}

export interface BomberSquadronRuntimeDeps {
  readOwner(ownerId: string): { readonly x: number; readonly y: number; readonly color: number } | null;
  readTargets(): readonly BomberAimTarget[];
  worldBounds(): BomberSquadronWorldBounds;
}

interface SquadronState {
  snapshot: BomberSquadronDeploymentSnapshot;
  readonly config: BombConfig;
  pending: BomberSquadronBombEvent[];
  readonly launchedImpacts: BomberSquadronDrop[];
}

function compareEvents(a: BomberSquadronBombEvent, b: BomberSquadronBombEvent): number {
  return a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'drop' ? -1 : 1)
    || a.squadronId - b.squadronId || a.drone - b.drone || a.pass - b.pass || a.bomb - b.bomb;
}

/** World-lokaler Host-Owner. Aufrufer liefern monotone Host-Zeit; Treffer führt erst der Adapter aus. */
export class BomberSquadronRuntime implements PlayerUltimateBomberSquadronCapability {
  private nextId = 1;
  private readonly squadrons = new Map<string, SquadronState>();
  private snapshot: BomberSquadronSnapshot | null = EMPTY_BOMBER_SQUADRON_SNAPSHOT;

  constructor(private readonly deps: BomberSquadronRuntimeDeps) {}

  tryActivate(request: PlayerUltimateBomberSquadronRequest): PlayerUltimateDeploymentResult {
    const { playerId, config, angle, nowMs } = request;
    if (this.isActive(playerId)) return { ok: false, reason: 'blocked' };
    const owner = this.deps.readOwner(playerId);
    const params = Object.freeze(bomberPlanParamsFromConfig(config));
    if (!owner || ![nowMs, angle, owner.x, owner.y, ...Object.values(params)].every(Number.isFinite)
      || nowMs < 0 || !Number.isInteger(params.droneCount) || params.droneCount < 1
      || !Number.isInteger(params.bombsPerPass) || params.bombsPerPass < 1
      || !isBomberFlightPlanValid(params) || params.runSpeedPxPerSec <= 0 || params.corridorLengthPx <= 0
      || Object.values(params).some(value => value < 0)) return { ok: false, reason: 'blocked' };
    const facts = {
      id: this.nextId++, ownerId: playerId, ownerColor: owner.color, startedAt: nowMs, angle, params,
      anchors: Object.freeze(Array<BomberSquadronAnchor | null>(params.droneCount).fill(null)), stoppedAt: null,
    };
    const state: SquadronState = {
      snapshot: Object.freeze({ ...facts, endsAt: bomberSquadronEndsAt(facts) }),
      config: Object.freeze({ explosionRadius: config.explosionRadius, maxDamage: config.maxDamage,
        minDamage: config.minDamage, fireChunksPerBomb: config.fireChunksPerBomb }),
      pending: [], launchedImpacts: [],
    };
    this.squadrons.set(playerId, state);
    this.launch(state, 0, owner);
    return { ok: true };
  }

  private launch(state: SquadronState, drone: number, owner: Pick<BomberSquadronAnchor, 'x' | 'y'>): void {
    const bounds = this.deps.worldBounds();
    const aim = chooseBomberAim(state.snapshot, drone, owner, this.deps.readTargets(), state.launchedImpacts, bounds);
    const anchor = Object.freeze({ x: owner.x, y: owner.y, ...aim });
    const anchors = [...state.snapshot.anchors];
    anchors[drone] = anchor;
    state.snapshot = Object.freeze({ ...state.snapshot, anchors: Object.freeze(anchors) });
    this.snapshot = null;
    for (const drop of bomberDrops(state.snapshot, drone, anchor)) {
      if (!isBomberImpactInWorld(drop.x, drop.y, bounds)) continue;
      state.launchedImpacts.push(drop);
      const facts = { ...drop, squadronId: state.snapshot.id, ownerId: state.snapshot.ownerId,
        bombKey: bomberSquadronBombKey(state.snapshot.id, drone, drop.pass, drop.bomb), config: state.config };
      state.pending.push({ ...facts, kind: 'drop', at: drop.dropAt }, { ...facts, kind: 'impact', at: drop.impactAt });
    }
  }

  /** Gemeinsame Zeitfolge über alle Staffeln; bei gleicher Zeit kommen Abwürfe vor Einschlägen. */
  update(nowMs: number): readonly BomberSquadronBombEvent[] {
    const due: BomberSquadronBombEvent[] = [];
    for (const state of this.squadrons.values()) {
      if (state.snapshot.stoppedAt === null) {
        for (let drone = 0; drone < state.snapshot.params.droneCount; drone++) {
          if (state.snapshot.anchors[drone]) continue;
          if (bomberLaunchAt(state.snapshot, drone) > nowMs) break;
          // Ohne Positionshistorie wird bei nachgeholten Starts die aktuelle Host-Position erfasst.
          const owner = this.deps.readOwner(state.snapshot.ownerId);
          if (!owner) {
            this.cancelUnlaunched(state.snapshot.ownerId, nowMs);
            break;
          }
          this.launch(state, drone, owner);
        }
      }
      const pending: BomberSquadronBombEvent[] = [];
      for (const event of state.pending) {
        if (event.at <= nowMs) due.push(event);
        else pending.push(event);
      }
      state.pending = pending;
      if (nowMs >= state.snapshot.endsAt) this.removeOwner(state.snapshot.ownerId);
    }
    return due.sort(compareEvents);
  }

  isActive(ownerId: string): boolean {
    return this.squadrons.has(ownerId);
  }

  cancelUnlaunched(ownerId: string, nowMs: number): void {
    const state = this.squadrons.get(ownerId);
    if (!state || state.snapshot.stoppedAt !== null) return;
    // Der Stopp gewinnt auch bei einem exakt gleichzeitigen, bereits erfassten Start.
    const anchors = state.snapshot.anchors.map((anchor, drone) =>
      bomberLaunchAt(state.snapshot, drone) < nowMs ? anchor : null);
    const facts = { ...state.snapshot, stoppedAt: nowMs, anchors: Object.freeze(anchors) };
    state.snapshot = Object.freeze({ ...facts, endsAt: bomberSquadronEndsAt(facts) });
    state.pending = state.pending.filter(event => anchors[event.drone] !== null);
    this.snapshot = null;
  }

  removeOwner(ownerId: string): void {
    if (this.squadrons.delete(ownerId)) this.snapshot = null;
  }

  clear(): void {
    this.squadrons.clear();
    this.snapshot = EMPTY_BOMBER_SQUADRON_SNAPSHOT;
    // IDs bleiben über Activity-Wechsel hinweg innerhalb dieser World eindeutig.
  }

  getSnapshot(): BomberSquadronSnapshot {
    if (this.snapshot === null) {
      this.snapshot = this.squadrons.size === 0 ? EMPTY_BOMBER_SQUADRON_SNAPSHOT
        : Object.freeze({ squadrons: Object.freeze([...this.squadrons.values()].map(state => state.snapshot)) });
    }
    return this.snapshot;
  }
}
