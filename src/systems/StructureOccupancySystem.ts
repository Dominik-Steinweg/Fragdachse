import type { StructureOccupancyState } from '../types';
import { WATCHTOWER_OCCUPANCY_RULES } from '../config/watchtower';
import { nearestConstructionPoint } from './ConstructionGeometry';

export type StructureOccupancyRequest =
  | { readonly action: 'enter'; readonly structureId: number }
  | { readonly action: 'exit'; readonly structureId: number; readonly revision: number };
export interface StructurePlatform {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly footprint: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

/** The player's centre, rather than its collision circle, stays on the platform. */
export function clampStructurePosition(platform: StructurePlatform, x: number, y: number) {
  const b = platform.footprint, inset = WATCHTOWER_OCCUPANCY_RULES.platformInsetPx;
  const ix = Math.min(inset, (b.right - b.left) / 2), iy = Math.min(inset, (b.bottom - b.top) / 2);
  return { x: Math.max(b.left + ix, Math.min(b.right - ix, x)),
    y: Math.max(b.top + iy, Math.min(b.bottom - iy, y)) };
}

export interface StructureOccupancyPorts {
  readonly getStructures: () => readonly StructurePlatform[];
  readonly getActor: (id: string) => { x: number; y: number; angle: number } | null;
  readonly canOccupy: (id: string) => boolean;
  readonly canEnter: (id: string) => boolean;
  readonly enter: (id: string, platform: StructurePlatform) => void;
  readonly exit: (id: string, platform: StructurePlatform, origin: { x: number; y: number }, angle: number) => void;
  readonly detach: (id: string) => void;
  readonly kill: (id: string, attackerId?: string) => void;
}

/** Sole host writer. Cached geometry survives construction removal until occupants are handled. */
export class StructureOccupancySystem {
  private readonly players = new Map<string, { state: StructureOccupancyState; platform: StructurePlatform; origin: { x: number; y: number } }>();
  private revision = 0;
  constructor(private readonly ports: StructureOccupancyPorts) {}
  getState(id: string): StructureOccupancyState | undefined { return this.players.get(id)?.state; }
  getPlatform(id: string): StructurePlatform | undefined { return this.players.get(id)?.platform; }
  getOccupants(structureId: number): string[] {
    return [...this.players].filter(([, p]) => p.state.structureId === structureId).map(([id]) => id);
  }
  request(id: string, request: StructureOccupancyRequest): boolean {
    const occupied = this.players.get(id);
    if (request.action === 'exit') {
      if (!occupied || occupied.state.structureId !== request.structureId || occupied.state.revision !== request.revision) return false;
      this.release(id); return true;
    }
    if (occupied || !this.ports.canOccupy(id) || !this.ports.canEnter(id)) return false;
    const actor = this.ports.getActor(id), platform = this.ports.getStructures().find(p => p.id === request.structureId);
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !platform || this.getOccupants(platform.id).length >= WATCHTOWER_OCCUPANCY_RULES.capacity
      || nearestConstructionPoint(platform.footprint, actor.x, actor.y).distance > WATCHTOWER_OCCUPANCY_RULES.enterRangePx) return false;
    this.players.set(id, { state: { structureId: platform.id, revision: ++this.revision }, platform, origin: { x: actor.x, y: actor.y } });
    try { this.ports.enter(id, platform); }
    catch (error) { this.players.delete(id); this.ports.detach(id); throw error; }
    return true;
  }
  reconcile(): void {
    const structures = new Map(this.ports.getStructures().map(p => [p.id, p]));
    for (const [id, occupied] of this.players) {
      if (!this.ports.canOccupy(id) || !this.ports.getActor(id)) this.release(id, false);
      else if (!structures.has(occupied.state.structureId)) this.release(id);
      else occupied.platform = structures.get(occupied.state.structureId)!;
    }
  }
  release(id: string, placeOnGround = true): void {
    const occupied = this.players.get(id);
    if (!occupied) return;
    this.players.delete(id);
    this.ports.detach(id);
    if (placeOnGround) this.ports.exit(id, occupied.platform, occupied.origin, this.ports.getActor(id)?.angle ?? 0);
  }
  constructionDestroyed(structureId: number, cause: 'damage' | 'decay' | 'removal' | 'teardown', attackerId?: string): void {
    const ids = this.getOccupants(structureId);
    const lethal = cause === 'damage' || cause === 'decay';
    // Remove the complete representation before death callbacks can re-enter the owner.
    for (const id of ids) this.release(id, !lethal);
    if (lethal) for (const id of ids) this.ports.kill(id, attackerId);
  }
  clear(): void { for (const id of [...this.players.keys()]) this.release(id); }
}
