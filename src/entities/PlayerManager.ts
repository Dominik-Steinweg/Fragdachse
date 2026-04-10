import * as Phaser from 'phaser';
import type {
  ArenaLayout,
  PlayerProfile,
  SyncedFireZone,
  SyncedMeteorStrike,
  SyncedNukeStrike,
  SyncedStinkCloud,
  TeamId,
  SyncedTeslaDome,
} from '../types';
import { PlayerEntity }       from './PlayerEntity';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,
  CELL_SIZE, GRID_COLS, GRID_ROWS,
  type ArenaGridRegion,
  getCaptureTheBeerBaseRegion,
  getCaptureTheBeerTeamSpawnRegion,
  isCaptureTheBeerBaseModeActive,
} from '../config';

const PREFERRED_OPPONENT_DISTANCE_PX = CELL_SIZE * 10;
const MIN_OPPONENT_DISTANCE_PX = CELL_SIZE * 2;
const EFFECT_SAFE_BUFFER_PX = Math.round(CELL_SIZE * 0.5);
const WARNING_SAFE_BUFFER_PX = CELL_SIZE;
const TURRET_SAFE_BUFFER_PX = CELL_SIZE;
const PROJECTILE_SOFT_RADIUS_PX = CELL_SIZE * 3;
const EDGE_SOFT_DISTANCE_PX = CELL_SIZE * 2;
const TOP_SPAWN_CHOICES = 8;

interface SpawnTurretSnapshot {
  x: number;
  y: number;
  ownerId: string;
  range: number;
}

interface SpawnProjectileSnapshot {
  x: number;
  y: number;
  ownerId: string;
  radius: number;
}

interface SpawnContextSnapshot {
  readonly fires: readonly SyncedFireZone[];
  readonly stinkClouds: readonly SyncedStinkCloud[];
  readonly teslaDomes: readonly SyncedTeslaDome[];
  readonly nukes: readonly SyncedNukeStrike[];
  readonly meteors: readonly SyncedMeteorStrike[];
  readonly turrets: readonly SpawnTurretSnapshot[];
  readonly projectiles: readonly SpawnProjectileSnapshot[];
  readonly isRelevantOpponent?: (playerId: string) => boolean;
  readonly hasLineOfSight?: (sx: number, sy: number, ex: number, ey: number) => boolean;
}

interface SpawnCandidate {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
}

interface SpawnEvaluation {
  candidate: SpawnCandidate;
  nearestOpponentDistance: number;
  nearestProjectileDistance: number;
  edgeDistance: number;
  hardDangerHits: number;
  softDangerHits: number;
  hardTurretHits: number;
  softTurretHits: number;
  projectilePenalty: number;
  score: number;
}

type SpawnContextProvider = (playerId: string | null) => SpawnContextSnapshot | null;

const EMPTY_SPAWN_CONTEXT: SpawnContextSnapshot = {
  fires: [],
  stinkClouds: [],
  teslaDomes: [],
  nukes: [],
  meteors: [],
  turrets: [],
  projectiles: [],
};

export class PlayerManager {
  private scene:   Phaser.Scene;
  private players: Map<string, PlayerEntity> = new Map();
  private layout:  ArenaLayout | null = null;
  private localPlayerId: string | null = null;
  private spawnContextProvider: SpawnContextProvider | null = null;
  private relationshipResolver: ((localPlayerId: string, otherPlayerId: string) => boolean) | null = null;
  private teamResolver: ((playerId: string) => TeamId | null) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  setRelationshipResolver(resolver: ((localPlayerId: string, otherPlayerId: string) => boolean) | null): void {
    this.relationshipResolver = resolver;
  }

  setTeamResolver(resolver: ((playerId: string) => TeamId | null) | null): void {
    this.teamResolver = resolver;
  }

  setSpawnContextProvider(provider: SpawnContextProvider | null): void {
    this.spawnContextProvider = provider;
  }

  /**
   * Übergibt das aktuelle Arena-Layout.
   * Muss vor addPlayer() und vor Respawns aufgerufen werden.
   */
  setLayout(layout: ArenaLayout): void {
    this.layout = layout;
  }

  /** Erstellt eine PlayerEntity an einer zufällig freien Arena-Position.
   *  Wird nur aufgerufen wenn isReady === true. */
  addPlayer(profile: PlayerProfile): void {
    if (this.players.has(profile.id)) return;
    const spawn = this.getSpawnPoint(profile.id);
    const entity = new PlayerEntity(
      this.scene, profile,
      ARENA_OFFSET_X + spawn.x,
      ARENA_OFFSET_Y + spawn.y,
      this.localPlayerId !== null && this.resolveIsEnemy(profile.id),
    );
    this.players.set(profile.id, entity);
  }

  private resolveIsEnemy(otherPlayerId: string): boolean {
    if (this.localPlayerId === null) return true;
    if (this.localPlayerId === otherPlayerId) return false;
    return this.relationshipResolver?.(this.localPlayerId, otherPlayerId) ?? true;
  }

  /** Zerstört die PlayerEntity. */
  removePlayer(id: string): void {
    const entity = this.players.get(id);
    if (entity) {
      entity.destroy();
      this.players.delete(id);
    }
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayer(id: string): PlayerEntity | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): PlayerEntity[] {
    return Array.from(this.players.values());
  }

  /**
   * Gibt eine zufällige freie Arena-Zelle zurück (relative Arena-Koordinaten).
   * Schließt blockierte Zellen (Fels, Trunk) und aktuell belegte Spieler-Zellen aus.
   * Wird sowohl für Initial-Spawn als auch für Respawns verwendet.
   */
  getSpawnPoint(requestingPlayerId: string | null = null): { x: number; y: number } {
    const spawnContext = this.spawnContextProvider?.(requestingPlayerId) ?? EMPTY_SPAWN_CONTEXT;

    if (isCaptureTheBeerBaseModeActive() && requestingPlayerId) {
      const teamId = this.teamResolver?.(requestingPlayerId) ?? null;
      const blockedForBaseSpawn = this.buildBlockedCells(requestingPlayerId, spawnContext, false);
      const baseSpawn = this.tryGetCaptureTheBeerSpawn(teamId, blockedForBaseSpawn);
      if (baseSpawn) return baseSpawn;
    }

    const blocked = this.buildBlockedCells(requestingPlayerId, spawnContext, true);
    const free = this.collectFreeCells(blocked);

    if (free.length === 0) {
      return { x: CELL_SIZE / 2, y: CELL_SIZE / 2 }; // Notfall-Fallback
    }

    const evaluations = free.map(candidate => this.evaluateSpawnCandidate(candidate, requestingPlayerId, spawnContext));
    const relaxedThresholds = this.buildRelaxedOpponentThresholds();

    for (const threshold of relaxedThresholds) {
      const strictMatches = evaluations.filter((evaluation) => (
        evaluation.hardDangerHits === 0
        && evaluation.softDangerHits === 0
        && evaluation.hardTurretHits === 0
        && evaluation.softTurretHits === 0
        && this.meetsOpponentThreshold(evaluation, threshold)
      ));
      const strictChoice = this.pickCandidate(strictMatches);
      if (strictChoice) return strictChoice;

      const softenedMatches = evaluations.filter((evaluation) => (
        evaluation.hardDangerHits === 0
        && evaluation.hardTurretHits === 0
        && this.meetsOpponentThreshold(evaluation, threshold)
      ));
      const softenedChoice = this.pickCandidate(softenedMatches);
      if (softenedChoice) return softenedChoice;
    }

    const safeChoice = this.pickCandidate(evaluations.filter((evaluation) => (
      evaluation.hardDangerHits === 0
      && evaluation.hardTurretHits === 0
      && this.meetsOpponentThreshold(evaluation, MIN_OPPONENT_DISTANCE_PX)
    )));
    if (safeChoice) return safeChoice;

    const minimumChoice = this.pickCandidate(evaluations.filter((evaluation) => (
      this.meetsOpponentThreshold(evaluation, MIN_OPPONENT_DISTANCE_PX)
    )));
    if (minimumChoice) return minimumChoice;

    return this.pickCandidate(evaluations) ?? { x: CELL_SIZE / 2, y: CELL_SIZE / 2 };
  }

  private buildBlockedCells(
    requestingPlayerId: string | null,
    spawnContext: SpawnContextSnapshot,
    respectRelevantOpponentFilter: boolean,
  ): Set<string> {
    const blocked = new Set<string>();

    // Felsen, Baumstümpfe und Gleise aus dem Layout blockieren
    if (this.layout) {
      for (const r of this.layout.rocks) blocked.add(`${r.gridX}_${r.gridY}`);
      for (const t of this.layout.trees) blocked.add(`${t.gridX}_${t.gridY}`);
      for (const track of this.layout.tracks) {
        blocked.add(`${track.gridX}_${track.gridY}`);
        blocked.add(`${track.gridX + 1}_${track.gridY}`);
      }
      for (const pedestal of this.layout.powerUpPedestals) {
        blocked.add(`${pedestal.gridX}_${pedestal.gridY}`);
      }
    }

    // Aktuell belegte Spieler-Zellen ausschließen
    for (const p of this.players.values()) {
      if (!p.sprite.active) continue;
      if (requestingPlayerId && p.id === requestingPlayerId) continue;
      if (respectRelevantOpponentFilter && spawnContext.isRelevantOpponent && !spawnContext.isRelevantOpponent(p.id)) continue;
      const gx = Math.floor((p.sprite.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((p.sprite.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    return blocked;
  }

  private collectFreeCells(blocked: ReadonlySet<string>, region?: ArenaGridRegion): SpawnCandidate[] {
    const free: SpawnCandidate[] = [];
    const minGridX = region?.minGridX ?? 0;
    const maxGridX = region?.maxGridX ?? GRID_COLS - 1;
    const minGridY = region?.minGridY ?? 0;
    const maxGridY = region?.maxGridY ?? GRID_ROWS - 1;

    for (let gy = minGridY; gy <= maxGridY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        if (!blocked.has(`${gx}_${gy}`)) {
          const x = gx * CELL_SIZE + CELL_SIZE / 2;
          const y = gy * CELL_SIZE + CELL_SIZE / 2;
          free.push({
            x,
            y,
            worldX: ARENA_OFFSET_X + x,
            worldY: ARENA_OFFSET_Y + y,
          });
        }
      }
    }

    return free;
  }

  private tryGetCaptureTheBeerSpawn(
    teamId: TeamId | null,
    blocked: ReadonlySet<string>,
  ): { x: number; y: number } | null {
    if (!teamId) return null;

    const baseCandidates = this.collectFreeCells(blocked, getCaptureTheBeerBaseRegion(teamId));
    if (baseCandidates.length > 0) {
      return this.pickRandomSpawn(baseCandidates);
    }

    const teamZoneCandidates = this.collectFreeCells(blocked, getCaptureTheBeerTeamSpawnRegion(teamId));
    if (teamZoneCandidates.length > 0) {
      return this.pickRandomSpawn(teamZoneCandidates);
    }

    return null;
  }

  private pickRandomSpawn(candidates: readonly SpawnCandidate[]): { x: number; y: number } | null {
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return { x: chosen.x, y: chosen.y };
  }

  private buildRelaxedOpponentThresholds(): number[] {
    const thresholds: number[] = [];
    for (let distance = PREFERRED_OPPONENT_DISTANCE_PX; distance >= MIN_OPPONENT_DISTANCE_PX; distance -= CELL_SIZE) {
      thresholds.push(distance);
    }
    if (thresholds[thresholds.length - 1] !== MIN_OPPONENT_DISTANCE_PX) {
      thresholds.push(MIN_OPPONENT_DISTANCE_PX);
    }
    return thresholds;
  }

  private meetsOpponentThreshold(evaluation: SpawnEvaluation, threshold: number): boolean {
    return evaluation.nearestOpponentDistance >= threshold;
  }

  private pickCandidate(evaluations: readonly SpawnEvaluation[]): { x: number; y: number } | null {
    if (evaluations.length === 0) return null;
    const shuffled = Phaser.Utils.Array.Shuffle([...evaluations]);
    const sorted = shuffled.sort((left, right) => right.score - left.score);
    const bestScore = sorted[0].score;
    const bestScorePool = sorted.filter((evaluation) => Math.abs(evaluation.score - bestScore) < 0.001);
    const choicePool = bestScorePool.length > 0
      ? bestScorePool
      : sorted.slice(0, Math.min(TOP_SPAWN_CHOICES, sorted.length));
    const chosen = choicePool[Math.floor(Math.random() * choicePool.length)];
    return { x: chosen.candidate.x, y: chosen.candidate.y };
  }

  private evaluateSpawnCandidate(
    candidate: SpawnCandidate,
    requestingPlayerId: string | null,
    spawnContext: SpawnContextSnapshot,
  ): SpawnEvaluation {
    let nearestOpponentDistance = Number.POSITIVE_INFINITY;
    for (const player of this.players.values()) {
      if (requestingPlayerId && player.id === requestingPlayerId) continue;
      if (!player.sprite.active) continue;
      if (spawnContext.isRelevantOpponent && !spawnContext.isRelevantOpponent(player.id)) continue;
      const distance = Phaser.Math.Distance.Between(candidate.worldX, candidate.worldY, player.sprite.x, player.sprite.y);
      nearestOpponentDistance = Math.min(nearestOpponentDistance, distance);
    }

    if (!Number.isFinite(nearestOpponentDistance)) {
      nearestOpponentDistance = PREFERRED_OPPONENT_DISTANCE_PX;
    }

    const fireDanger = this.countZoneDanger(candidate, spawnContext.fires, EFFECT_SAFE_BUFFER_PX);
    const stinkDanger = this.countZoneDanger(candidate, spawnContext.stinkClouds, EFFECT_SAFE_BUFFER_PX);
    const teslaDanger = this.countZoneDanger(candidate, spawnContext.teslaDomes, WARNING_SAFE_BUFFER_PX);
    const nukeDanger = this.countZoneDanger(candidate, spawnContext.nukes, WARNING_SAFE_BUFFER_PX);
    const meteorDanger = this.countZoneDanger(candidate, spawnContext.meteors, WARNING_SAFE_BUFFER_PX);

    const turretDanger = this.countTurretDanger(candidate, requestingPlayerId, spawnContext);
    const projectileDanger = this.measureProjectileDanger(candidate, requestingPlayerId, spawnContext.projectiles);

    const edgeDistance = Math.min(
      candidate.x,
      ARENA_WIDTH - candidate.x,
      candidate.y,
      ARENA_HEIGHT - candidate.y,
    );

    let score = 0;
    score += Math.min(nearestOpponentDistance, PREFERRED_OPPONENT_DISTANCE_PX) * 2.5;
    score += Math.min(projectileDanger.nearestDistance, PROJECTILE_SOFT_RADIUS_PX * 2) * 0.8;
    score += Math.min(edgeDistance, EDGE_SOFT_DISTANCE_PX) * 0.7;

    if (edgeDistance < EDGE_SOFT_DISTANCE_PX) {
      score -= (EDGE_SOFT_DISTANCE_PX - edgeDistance) * 2.2;
    }

    score -= projectileDanger.penalty * 3.0;
    score -= (fireDanger.softHits + stinkDanger.softHits + teslaDanger.softHits + nukeDanger.softHits + meteorDanger.softHits) * 260;
    score -= (fireDanger.hardHits + stinkDanger.hardHits + teslaDanger.hardHits + nukeDanger.hardHits + meteorDanger.hardHits) * 2600;
    score -= turretDanger.softHits * 320;
    score -= turretDanger.hardHits * 2800;

    return {
      candidate,
      nearestOpponentDistance,
      nearestProjectileDistance: projectileDanger.nearestDistance,
      edgeDistance,
      hardDangerHits: fireDanger.hardHits + stinkDanger.hardHits + teslaDanger.hardHits + nukeDanger.hardHits + meteorDanger.hardHits,
      softDangerHits: fireDanger.softHits + stinkDanger.softHits + teslaDanger.softHits + nukeDanger.softHits + meteorDanger.softHits,
      hardTurretHits: turretDanger.hardHits,
      softTurretHits: turretDanger.softHits,
      projectilePenalty: projectileDanger.penalty,
      score,
    };
  }

  private countZoneDanger(
    candidate: SpawnCandidate,
    zones: readonly { x: number; y: number; radius: number }[],
    safeBufferPx: number,
  ): { hardHits: number; softHits: number } {
    let hardHits = 0;
    let softHits = 0;

    for (const zone of zones) {
      const distance = Phaser.Math.Distance.Between(candidate.worldX, candidate.worldY, zone.x, zone.y);
      if (distance <= zone.radius) {
        hardHits += 1;
        continue;
      }
      if (distance <= zone.radius + safeBufferPx) {
        softHits += 1;
      }
    }

    return { hardHits, softHits };
  }

  private countTurretDanger(
    candidate: SpawnCandidate,
    requestingPlayerId: string | null,
    spawnContext: SpawnContextSnapshot,
  ): { hardHits: number; softHits: number } {
    let hardHits = 0;
    let softHits = 0;

    for (const turret of spawnContext.turrets) {
      if (requestingPlayerId && turret.ownerId === requestingPlayerId) continue;
      const distance = Phaser.Math.Distance.Between(candidate.worldX, candidate.worldY, turret.x, turret.y);
      const hasSight = spawnContext.hasLineOfSight
        ? spawnContext.hasLineOfSight(turret.x, turret.y, candidate.worldX, candidate.worldY)
        : true;
      if (!hasSight) continue;

      if (distance <= turret.range) {
        hardHits += 1;
        continue;
      }
      if (distance <= turret.range + TURRET_SAFE_BUFFER_PX) {
        softHits += 1;
      }
    }

    return { hardHits, softHits };
  }

  private measureProjectileDanger(
    candidate: SpawnCandidate,
    requestingPlayerId: string | null,
    projectiles: readonly SpawnProjectileSnapshot[],
  ): { nearestDistance: number; penalty: number } {
    let nearestDistance = Number.POSITIVE_INFINITY;
    let penalty = 0;

    for (const projectile of projectiles) {
      if (requestingPlayerId && projectile.ownerId === requestingPlayerId) continue;
      const distance = Phaser.Math.Distance.Between(candidate.worldX, candidate.worldY, projectile.x, projectile.y);
      nearestDistance = Math.min(nearestDistance, distance);

      const dangerRadius = Math.max(PROJECTILE_SOFT_RADIUS_PX, projectile.radius);
      if (distance <= dangerRadius) {
        penalty += dangerRadius - distance;
      }
    }

    if (!Number.isFinite(nearestDistance)) {
      nearestDistance = PROJECTILE_SOFT_RADIUS_PX * 2;
    }

    return { nearestDistance, penalty };
  }
}
