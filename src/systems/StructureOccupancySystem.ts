export type OccupancyStructureKind = 'watchtower' | 'burrow';

export interface StructureOccupancyDefinition {
  readonly id: string;
  readonly kind: OccupancyStructureKind;
  readonly capacity: number | 'team';
  readonly interactionRange: number;
  readonly movementLocked: true;
  readonly weaponsAllowed: boolean;
  readonly utilityAllowed: boolean;
  readonly dashAllowed: false;
  readonly constructionAllowed: boolean;
  readonly directDamageImmune: boolean;
  readonly weaponRangeMultiplier?: number;
  readonly adrenalineRegenMultiplier?: number;
}

export interface StructureOccupancyPosition {
  readonly x: number;
  readonly y: number;
}

export interface StructureOccupancyCandidate {
  readonly structureId: string;
  readonly kind: OccupancyStructureKind;
  readonly distance: number;
  readonly aimError: number;
  readonly occupantCount: number;
}

export interface StructureOccupancyOptions {
  readonly getPlayerPosition: (playerId: string) => StructureOccupancyPosition | null;
  readonly getStructurePosition: (structureId: string) => StructureOccupancyPosition | null;
  readonly getTeamPlayerIds?: () => readonly string[];
  readonly onPlayerLockChanged?: (playerId: string, locked: boolean, structureId: string | null) => void;
  readonly onStructureDestroyed?: (structureId: string, occupantPlayerIds: readonly string[]) => void;
}

export interface StructureEnterResult {
  readonly ok: boolean;
  readonly structureId?: string;
  readonly reason?: 'not-found' | 'out-of-range' | 'full' | 'already-occupied' | 'invalid';
}

export interface StructureOccupancySnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly structures: Readonly<Record<string, readonly string[]>>;
  readonly playerStructureIds: Readonly<Record<string, string>>;
}

/**
 * Generic host-side occupancy state for permanent base structures. It intentionally knows nothing
 * about the existing burrow movement/tunnel mechanics; it only owns locks, selection and cleanup.
 */
export class StructureOccupancySystem {
  private readonly definitions = new Map<string, StructureOccupancyDefinition>();
  private readonly occupantsByStructure = new Map<string, string[]>();
  private readonly structureByPlayer = new Map<string, string>();
  private revision = 0;

  constructor(private readonly options: StructureOccupancyOptions) {}

  registerStructure(definition: StructureOccupancyDefinition): void {
    this.definitions.set(definition.id, definition);
    if (!this.occupantsByStructure.has(definition.id)) this.occupantsByStructure.set(definition.id, []);
  }

  getSnapshot(): StructureOccupancySnapshot {
    const structures: Record<string, readonly string[]> = {};
    for (const [structureId, occupants] of this.occupantsByStructure) structures[structureId] = [...occupants];
    const playerStructureIds: Record<string, string> = {};
    for (const [playerId, structureId] of this.structureByPlayer) playerStructureIds[playerId] = structureId;
    return { schemaVersion: 1, revision: this.revision, structures, playerStructureIds };
  }

  applySnapshot(snapshot: StructureOccupancySnapshot | null): void {
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.revision < this.revision) return;
    for (const occupants of this.occupantsByStructure.values()) occupants.splice(0, occupants.length);
    this.structureByPlayer.clear();
    for (const [structureId, occupants] of Object.entries(snapshot.structures)) {
      if (!this.definitions.has(structureId) || !Array.isArray(occupants)) continue;
      const valid = occupants.filter((playerId): playerId is string => typeof playerId === 'string');
      this.occupantsByStructure.set(structureId, [...valid]);
      for (const playerId of valid) this.structureByPlayer.set(playerId, structureId);
    }
    this.revision = snapshot.revision;
  }

  unregisterStructure(structureId: string): readonly string[] {
    const occupants = [...(this.occupantsByStructure.get(structureId) ?? [])];
    for (const playerId of occupants) this.clearPlayer(playerId);
    this.occupantsByStructure.delete(structureId);
    this.definitions.delete(structureId);
    this.revision += 1;
    return occupants;
  }

  getOccupants(structureId: string): readonly string[] {
    return [...(this.occupantsByStructure.get(structureId) ?? [])];
  }

  getStructureForPlayer(playerId: string): string | null {
    return this.structureByPlayer.get(playerId) ?? null;
  }

  isOccupied(playerId: string): boolean {
    return this.structureByPlayer.has(playerId);
  }

  getDefinition(structureId: string): StructureOccupancyDefinition | null {
    return this.definitions.get(structureId) ?? null;
  }

  getCandidates(
    playerId: string,
    aimAngle: number,
    nowPosition = this.options.getPlayerPosition(playerId),
  ): StructureOccupancyCandidate[] {
    if (!nowPosition) return [];
    const candidates: StructureOccupancyCandidate[] = [];
    for (const [structureId, definition] of this.definitions) {
      const structurePosition = this.options.getStructurePosition(structureId);
      if (!structurePosition) continue;
      const dx = structurePosition.x - nowPosition.x;
      const dy = structurePosition.y - nowPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance > definition.interactionRange) continue;
      const targetAngle = Math.atan2(dy, dx);
      candidates.push({
        structureId,
        kind: definition.kind,
        distance,
        aimError: absoluteAngleDistance(aimAngle, targetAngle),
        occupantCount: this.occupantsByStructure.get(structureId)?.length ?? 0,
      });
    }
    return candidates.sort((left, right) => left.aimError - right.aimError
      || left.distance - right.distance
      || (left.structureId < right.structureId ? -1 : 1));
  }

  selectStructure(playerId: string, aimAngle: number): string | null {
    const candidates = this.getCandidates(playerId, aimAngle);
    for (const candidate of candidates) {
      const definition = this.definitions.get(candidate.structureId);
      if (!definition) continue;
      const capacity = definition.capacity === 'team'
        ? this.options.getTeamPlayerIds?.().length ?? Number.MAX_SAFE_INTEGER
        : definition.capacity;
      if (candidate.occupantCount < capacity) return candidate.structureId;
    }
    return null;
  }

  enter(playerId: string, structureId: string): StructureEnterResult {
    const definition = this.definitions.get(structureId);
    if (!definition) return { ok: false, reason: 'not-found' };
    const position = this.options.getPlayerPosition(playerId);
    const structurePosition = this.options.getStructurePosition(structureId);
    if (!position || !structurePosition
      || Math.hypot(position.x - structurePosition.x, position.y - structurePosition.y) > definition.interactionRange) {
      return { ok: false, reason: 'out-of-range' };
    }
    const current = this.structureByPlayer.get(playerId);
    if (current === structureId) return { ok: true, structureId };
    if (current) return { ok: false, reason: 'already-occupied' };
    const occupants = this.occupantsByStructure.get(structureId) ?? [];
    const capacity = definition.capacity === 'team'
      ? this.options.getTeamPlayerIds?.().length ?? Number.MAX_SAFE_INTEGER
      : definition.capacity;
    if (occupants.length >= capacity) return { ok: false, reason: 'full' };
    occupants.push(playerId);
    this.occupantsByStructure.set(structureId, occupants);
    this.structureByPlayer.set(playerId, structureId);
    this.revision += 1;
    this.options.onPlayerLockChanged?.(playerId, true, structureId);
    return { ok: true, structureId };
  }

  exit(playerId: string): boolean {
    return this.clearPlayer(playerId);
  }

  clearPlayer(playerId: string): boolean {
    const structureId = this.structureByPlayer.get(playerId);
    if (!structureId) return false;
    this.structureByPlayer.delete(playerId);
    const occupants = this.occupantsByStructure.get(structureId);
    if (occupants) this.occupantsByStructure.set(structureId, occupants.filter((id) => id !== playerId));
    this.revision += 1;
    this.options.onPlayerLockChanged?.(playerId, false, null);
    return true;
  }

  clearAll(): void {
    for (const playerId of [...this.structureByPlayer.keys()]) this.clearPlayer(playerId);
  }

  onPlayerDeath(playerId: string): void { this.clearPlayer(playerId); }
  onPlayerDisconnect(playerId: string): void { this.clearPlayer(playerId); }
  onMapChange(): void { this.clearAll(); }
  onEditorChange(): void { this.clearAll(); }

  onStructureDestroyed(structureId: string): readonly string[] {
    const occupants = this.getOccupants(structureId);
    for (const playerId of occupants) this.clearPlayer(playerId);
    this.options.onStructureDestroyed?.(structureId, occupants);
    return occupants;
  }

  canMoveStructure(structureId: string): boolean {
    return (this.occupantsByStructure.get(structureId)?.length ?? 0) === 0;
  }

  getPlayerModifiers(playerId: string): {
    readonly weaponRangeMultiplier: number;
    readonly adrenalineRegenMultiplier: number;
  } {
    const structureId = this.structureByPlayer.get(playerId);
    const definition = structureId ? this.definitions.get(structureId) : undefined;
    return {
      weaponRangeMultiplier: definition?.weaponRangeMultiplier ?? 1,
      adrenalineRegenMultiplier: definition?.adrenalineRegenMultiplier ?? 1,
    };
  }

  isActionAllowed(playerId: string, action: 'move' | 'weapon' | 'utility' | 'dash' | 'construction' | 'direct-damage'): boolean {
    const structureId = this.structureByPlayer.get(playerId);
    if (!structureId) return true;
    const definition = this.definitions.get(structureId);
    if (!definition) return false;
    if (action === 'move' || action === 'dash') return false;
    if (action === 'weapon') return definition.weaponsAllowed;
    if (action === 'utility') return definition.utilityAllowed;
    if (action === 'construction') return definition.constructionAllowed;
    return !definition.directDamageImmune;
  }

  isPlayerProtectedFromDirectDamage(playerId: string): boolean {
    const structureId = this.structureByPlayer.get(playerId);
    return structureId ? this.definitions.get(structureId)?.directDamageImmune === true : false;
  }

  /** Occupied players are replaced by the relevant structure proxy in enemy target selection. */
  isPlayerTargetableToEnemies(playerId: string): boolean {
    return !this.structureByPlayer.has(playerId);
  }

  isStructureTargetProxy(structureId: string): boolean {
    return this.definitions.has(structureId)
      && (this.occupantsByStructure.get(structureId)?.length ?? 0) > 0;
  }
}

function absoluteAngleDistance(left: number, right: number): number {
  const delta = Math.abs((left - right) % (Math.PI * 2));
  return Math.min(delta, Math.PI * 2 - delta);
}
