import type {
  SyncedProjectile,
  ProjectileStyle,
  BulletVisualPreset,
  GrenadeVisualPreset,
  EnergyBallVariant,
  GroundFireVisualStyle,
  MiniRocketFlightPhase,
  ProjectileBouncePresentation,
} from '../types';

/** Nichtautoritativer, rendererfreier Zustand eines replizierten Projectiles. */
export interface ProjectileClientReplicaState {
  readonly serverX: number;
  readonly serverY: number;
  readonly vx: number;
  readonly vy: number;
  readonly size: number;
  readonly color: number;
  readonly receivedAt: number;
  readonly style?: ProjectileStyle;
  readonly bulletVisualPreset?: BulletVisualPreset;
  readonly grenadeVisualPreset?: GrenadeVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly sporeVisualVariant?: 'spore' | 'spore_void';
  readonly ownerColor?: number;
  readonly projectileVisualScale?: number;
  readonly isDecaying: boolean;
  readonly velocityDecay: number;
  readonly miniRocketPhase?: MiniRocketFlightPhase;
  readonly miniRocketCascadeStage?: number;
  readonly projectileBurnVisualStyle?: GroundFireVisualStyle;
  readonly burning: boolean;
  /** Highest applied host presentation sequence for packet-loss healing and deduplication. */
  readonly bounceSequence?: number;
}

export interface ProjectileClientReplicaUpdate {
  readonly projectile: SyncedProjectile;
  readonly state: ProjectileClientReplicaState;
  readonly previous?: ProjectileClientReplicaState;
  readonly isNew: boolean;
  /** New host-authoritative outcome, emitted once per sequence. */
  readonly bounce?: ProjectileBouncePresentation;
}

export interface ProjectileClientReplicaRemovedState {
  readonly id: number;
  readonly state: ProjectileClientReplicaState;
}

export interface ProjectileClientReplicaFrame {
  readonly projectiles: readonly SyncedProjectile[];
  readonly activeIds: ReadonlySet<number>;
  readonly updates: readonly ProjectileClientReplicaUpdate[];
  readonly removed: ReadonlyMap<number, ProjectileClientReplicaState>;
  readonly newIds: ReadonlySet<number>;
}

export interface ProjectileClientExtrapolatedState {
  readonly id: number;
  readonly state: ProjectileClientReplicaState;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
}

/**
 * Rendererfreier Client-Owner für Snapshot-State und Extrapolation.
 *
 * Diese Klasse entscheidet weder Kollisionen noch Explosionen und entfernt kein Gameplay-Objekt
 * lokal. Sie behandelt Removal-by-absence ausschließlich als Ende der nichtautoritativen Replica.
 */
export class ProjectileClientReplica {
  private readonly states = new Map<number, ProjectileClientReplicaState>();
  private readonly retiredIds = new Set<number>();

  reset(): void {
    this.states.clear();
    this.retiredIds.clear();
  }

  get size(): number {
    return this.states.size;
  }

  getState(id: number): ProjectileClientReplicaState | undefined {
    return this.states.get(id);
  }

  /** Nimmt einen vollständigen Dynamic-Snapshot entgegen und entfernt fehlende IDs. */
  sync(data: readonly SyncedProjectile[], receivedAt = performance.now()): ProjectileClientReplicaFrame {
    const incoming = new Map<number, SyncedProjectile>();
    for (const projectile of data) {
      if (!this.retiredIds.has(projectile.id)) incoming.set(projectile.id, projectile);
    }

    const activeIds = new Set(incoming.keys());
    const removed = new Map<number, ProjectileClientReplicaState>();
    for (const [id, state] of this.states) {
      if (!activeIds.has(id)) {
        removed.set(id, state);
        this.states.delete(id);
        this.retiredIds.add(id);
      }
    }

    const updates: ProjectileClientReplicaUpdate[] = [];
    const newIds = new Set<number>();
    for (const projectile of incoming.values()) {
      const previous = this.states.get(projectile.id);
      const bounce = readNewBounce(projectile.bounce, previous?.bounceSequence);
      const state = createReplicaState(projectile, receivedAt, previous?.bounceSequence, bounce);
      updates.push({
        projectile,
        state,
        previous,
        isNew: previous === undefined,
        bounce,
      });
      if (previous === undefined) newIds.add(projectile.id);
      this.states.set(projectile.id, state);
    }

    return {
      projectiles: [...incoming.values()],
      activeIds,
      updates,
      removed,
      newIds,
    };
  }

  /** Iteriert den extrapolierten Zustand ohne Renderer- oder Phaser-Abhängigkeit. */
  readExtrapolated(
    now: number,
    sink: (state: ProjectileClientExtrapolatedState) => void,
  ): void {
    for (const [id, state] of this.states) {
      const extrapolated = extrapolateReplicaState(state, now);
      if (!extrapolated) continue;
      sink({ id, state, ...extrapolated });
    }
  }
}

function createReplicaState(
  projectile: SyncedProjectile,
  receivedAt: number,
  previousBounceSequence: number | undefined,
  bounce: ProjectileBouncePresentation | undefined,
): ProjectileClientReplicaState {
  const bounceSequence = Math.max(previousBounceSequence ?? 0, bounce?.sequence ?? 0);
  return {
    serverX: projectile.x,
    serverY: projectile.y,
    vx: projectile.vx,
    vy: projectile.vy,
    size: projectile.size,
    color: projectile.color,
    receivedAt,
    style: projectile.style,
    bulletVisualPreset: projectile.bulletVisualPreset,
    grenadeVisualPreset: projectile.grenadeVisualPreset,
    energyBallVariant: projectile.energyBallVariant,
    sporeVisualVariant: projectile.sporeVisualVariant,
    ownerColor: projectile.ownerColor,
    projectileVisualScale: projectile.projectileVisualScale,
    isDecaying: projectile.style === 'flame' || projectile.style === 'leaf_blower',
    velocityDecay: projectile.velocityDecay ?? 1,
    miniRocketPhase: projectile.miniRocketPhase,
    miniRocketCascadeStage: projectile.miniRocketCascadeStage,
    projectileBurnVisualStyle: projectile.projectileBurnVisualStyle,
    burning: projectile.burning === true,
    bounceSequence: bounceSequence > 0 ? bounceSequence : undefined,
  };
}

function readNewBounce(
  bounce: ProjectileBouncePresentation | undefined,
  previousSequence: number | undefined,
): ProjectileBouncePresentation | undefined {
  if (!bounce || !Number.isSafeInteger(bounce.sequence) || bounce.sequence <= (previousSequence ?? 0)) return undefined;
  if (![bounce.x, bounce.y, bounce.vx, bounce.vy].every(Number.isFinite)) return undefined;
  return bounce;
}

function extrapolateReplicaState(
  state: ProjectileClientReplicaState,
  now: number,
): Omit<ProjectileClientExtrapolatedState, 'id' | 'state'> | null {
  const dt = (now - state.receivedAt) / 1000;
  if (dt <= 0) return null;

  if (state.isDecaying) {
    const decay = Math.max(0.001, Math.min(state.velocityDecay, 1));
    if (decay === 1) {
      return {
        x: state.serverX + state.vx * dt,
        y: state.serverY + state.vy * dt,
        velocityX: state.vx,
        velocityY: state.vy,
      };
    }
    const lnDecay = Math.log(decay);
    const integralFactor = (1 - Math.pow(decay, dt)) / (-lnDecay);
    const decayFactor = Math.pow(decay, dt);
    return {
      x: state.serverX + state.vx * integralFactor,
      y: state.serverY + state.vy * integralFactor,
      velocityX: state.vx * decayFactor,
      velocityY: state.vy * decayFactor,
    };
  }

  return {
    x: state.serverX + state.vx * dt,
    y: state.serverY + state.vy * dt,
    velocityX: state.vx,
    velocityY: state.vy,
  };
}
