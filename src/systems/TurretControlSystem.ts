import type { TurretControlInput, TurretControlRequest, TurretControlState } from '../types';
import type { AutomatedTurret, AutomatedTurretId } from './TurretSystem';
import { CELL_SIZE, COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID } from '../config';
import { interactionCandidateScore, selectInteractionCandidate, WORLD_INTERACTION_RULES } from './WorldInteractionSelection';

export function isFriendlyTurret(playerId: string, turret: AutomatedTurret, isEnemyPair: (a: string, b: string) => boolean): boolean {
  if (turret.ownerId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID) return false;
  return turret.ownerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID || turret.ownerId === playerId || !isEnemyPair(playerId, turret.ownerId);
}

export const TURRET_CONTROL_RULES = {
  range: 100, ...WORLD_INTERACTION_RULES, inputTimeoutMs: 500,
} as const;

export interface TurretControlActor { readonly x: number; readonly y: number; readonly angle: number }

/** Searches beyond the full carrier contour before falling back to the original entry point. */
export function resolveTurretExit(
  turret: AutomatedTurret, origin: { x: number; y: number }, angle: number, radius: number,
  geometry: Pick<import('../world/WorldGeometryQueries').WorldGeometryQueries, 'resolveSafeGroundPoint'> | null,
  spawn: () => { x: number; y: number },
): { x: number; y: number } {
  const bounds = turret.footprint ?? { left: turret.x - CELL_SIZE / 2, right: turret.x + CELL_SIZE / 2,
    top: turret.y - CELL_SIZE / 2, bottom: turret.y + CELL_SIZE / 2 };
  const valid = (x: number, y: number): boolean => {
    const point = geometry?.resolveSafeGroundPoint(x, y, radius);
    return !!point && Math.hypot(point.x - x, point.y - y) < 0.001;
  };
  for (let index = 0; index < 16; index++) {
    const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1) * Math.PI / 8;
    const dx = Math.cos(angle + offset), dy = Math.sin(angle + offset);
    const tx = Math.abs(dx) < 1e-8 ? Infinity : ((dx > 0 ? bounds.right + radius : bounds.left - radius) - turret.x) / dx;
    const ty = Math.abs(dy) < 1e-8 ? Infinity : ((dy > 0 ? bounds.bottom + radius : bounds.top - radius) - turret.y) / dy;
    const edge = Math.max(radius, Math.min(tx, ty)) + 1;
    for (let step = 0; step <= 4; step++) {
      const distance = edge + step * 16;
      const x = turret.x + dx * distance, y = turret.y + dy * distance;
      if (valid(x, y)) return { x, y };
    }
  }
  if (valid(origin.x, origin.y)) return { ...origin };
  return spawn();
}
export interface ManualTurretControl {
  readonly playerId: string;
  readonly revision: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly fireHeld: boolean;
  readonly fresh: boolean;
}

export function turretCandidateScore(actor: TurretControlActor, turret: Pick<AutomatedTurret, 'x' | 'y'>): number {
  return interactionCandidateScore(actor, { ...turret, radius: TURRET_CONTROL_RULES.range });
}

export function selectTurretCandidate(
  actor: TurretControlActor, turrets: readonly AutomatedTurret[], currentId: AutomatedTurretId | null,
  eligible: (turret: AutomatedTurret) => boolean,
): AutomatedTurret | null {
  return selectInteractionCandidate(actor, turrets.filter(eligible).map(turret => ({
    ...turret, turret, key: `${typeof turret.id}:${turret.id}`, radius: TURRET_CONTROL_RULES.range,
  })), currentId === null ? null : `${typeof currentId}:${currentId}`)?.turret ?? null;
}

interface Occupancy {
  readonly state: TurretControlState;
  readonly origin: { x: number; y: number };
  turret: AutomatedTurret;
}

export interface TurretControlPorts {
  readonly getTurrets: () => readonly AutomatedTurret[];
  readonly getActor: (id: string) => TurretControlActor | null;
  readonly canOccupy: (id: string) => boolean;
  readonly canEnter: (id: string) => boolean;
  readonly isFriendly: (id: string, turret: AutomatedTurret) => boolean;
  readonly getInput: (id: string) => { input: TurretControlInput; receivedAt: number } | null;
  readonly enter: (id: string, turret: AutomatedTurret) => void;
  readonly pin: (id: string, turret: AutomatedTurret) => void;
  readonly exit: (id: string, turret: AutomatedTurret, origin: { x: number; y: number }, angle: number) => void;
}

/** One host writer for World-local occupancy. Presentation only reads its snapshot projection. */
export class TurretControlSystem {
  private readonly players = new Map<string, Occupancy>();
  private readonly turrets = new Map<AutomatedTurretId, string>();
  private revision = 0;

  constructor(private readonly ports: TurretControlPorts) {}

  getState(playerId: string): TurretControlState | undefined { return this.players.get(playerId)?.state; }
  getOccupant(turretId: AutomatedTurretId): string | undefined { return this.turrets.get(turretId); }
  isOccupied(playerId: string): boolean { return this.players.has(playerId); }

  request(playerId: string, request: TurretControlRequest): boolean {
    const occupied = this.players.get(playerId);
    if (request.action === 'exit') {
      if (!occupied || occupied.state.revision !== request.revision || occupied.state.turretId !== request.turretId) return false;
      this.release(playerId);
      return true;
    }
    if (occupied || !this.ports.canOccupy(playerId) || !this.ports.canEnter(playerId)) return false;
    const actor = this.ports.getActor(playerId);
    const turret = this.ports.getTurrets().find(candidate => candidate.id === request.turretId);
    if (!actor || !turret || this.turrets.has(turret.id) || !this.ports.isFriendly(playerId, turret)
      || turretCandidateScore(actor, turret) < TURRET_CONTROL_RULES.minimumScore) return false;
    const state = { turretId: turret.id, revision: ++this.revision };
    this.players.set(playerId, { state, turret, origin: { x: actor.x, y: actor.y } });
    this.turrets.set(turret.id, playerId);
    try { this.ports.enter(playerId, turret); }
    catch (error) { this.players.delete(playerId); this.turrets.delete(turret.id); throw error; }
    return true;
  }

  getManualControl(turretId: AutomatedTurretId, nowMs: number): ManualTurretControl | null {
    const playerId = this.turrets.get(turretId);
    const occupied = playerId === undefined ? undefined : this.players.get(playerId);
    if (!occupied || playerId === undefined) return null;
    const packet = this.ports.getInput(playerId);
    const input = packet?.input;
    const fresh = !!packet && !!input && input.turretId === turretId && input.revision === occupied.state.revision
      && Number.isFinite(input.targetX) && Number.isFinite(input.targetY) && typeof input.fireHeld === 'boolean'
      && nowMs - packet.receivedAt <= TURRET_CONTROL_RULES.inputTimeoutMs && nowMs >= packet.receivedAt;
    const actor = this.ports.getActor(playerId);
    return { playerId, revision: occupied.state.revision, fresh,
      targetX: fresh ? input!.targetX : occupied.turret.x + Math.cos(actor?.angle ?? 0) * 100,
      targetY: fresh ? input!.targetY : occupied.turret.y + Math.sin(actor?.angle ?? 0) * 100,
      fireHeld: fresh && input!.fireHeld };
  }

  reconcile(): void {
    const available = new Map(this.ports.getTurrets().map(turret => [turret.id, turret]));
    for (const [id, occupied] of this.players) {
      const turret = available.get(occupied.state.turretId);
      if (!turret || !this.ports.canOccupy(id) || !this.ports.isFriendly(id, turret)) this.release(id);
      else { occupied.turret = turret; this.ports.pin(id, turret); }
    }
  }

  release(playerId: string): void {
    const occupied = this.players.get(playerId);
    if (!occupied) return;
    this.players.delete(playerId);
    this.turrets.delete(occupied.state.turretId);
    this.ports.exit(playerId, occupied.turret, occupied.origin, this.ports.getActor(playerId)?.angle ?? 0);
  }

  clear(): void { for (const id of [...this.players.keys()]) this.release(id); }
}
