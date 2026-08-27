import * as Phaser from 'phaser';
import { COLORS } from '../config';
import { getCoopDefenseEnemyXp, type CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { CombatSystem } from './CombatSystem';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const STAT_PREFIX = 'player.necromancy';
const DEFAULT_INTERVAL_MS = 4000;
const DEFAULT_CORPSE_LIFETIME_MS = 6000;
const DEFAULT_REVIVE_RADIUS = 300;
const DEFAULT_TARGET_RADIUS = 350;
const DEFAULT_LEASH_RADIUS = 500;
const DEFAULT_TELEPORT_DISTANCE = 1200;
const TELEPORT_SEARCH_RADIUS_CELLS = 3;
const STEER_RESPONSIVENESS = 9;

/**
 * Gefolge-Ring um den Besitzer. Die Wiederbelebten laufen nicht auf den Spieler, sondern auf
 * ihren eigenen Platz auf diesem Ring – sonst stapeln sie sich exakt auf seiner Position.
 */
const FOLLOW_RADIUS_BASE_PX = 56;
const FOLLOW_RADIUS_PER_ALLY_PX = 14;
const FOLLOW_RADIUS_MAX_PX = 140;
/**
 * Innerhalb dieser Distanz zum eigenen Platz übernimmt die direkte Steuerung. Das Flowfield kennt
 * nur ein gemeinsames Ziel (den Besitzer) und würde die Gruppe sonst wieder zusammenziehen.
 */
const FOLLOW_DIRECT_STEER_PX = 96;
const FOLLOW_ARRIVAL_PX = 10;
/** So viele Ringplätze werden durchprobiert, bevor der Verbündete auf den Besitzer selbst zielt. */
const FOLLOW_ANCHOR_ATTEMPTS = 8;
/** Goldener Winkel: verteilt neue Plätze auch bei wachsender Schar gleichmäßig. */
const FOLLOW_SLOT_ANGLE_STEP = Math.PI * (3 - Math.sqrt(5));

export type NecromancyStatResolver = (playerId: string, stat: string, baseValue: number) => number;

/** Meldet Entstehen und Verschwinden einer Leiche an die Darstellungsschicht. */
export interface NecromancyCorpseSink {
  onCorpseAdded(corpseId: number, x: number, y: number, enemySize: number, lifetimeMs: number): void;
  onCorpseRemoved(corpseId: number): void;
}

interface CorpseRecord {
  readonly id: number;
  readonly kind: CoopDefenseEnemyKind;
  readonly x: number;
  readonly y: number;
  readonly xp: number;
  readonly diedAt: number;
  readonly expiresAt: number;
}

interface OwnerState {
  nextRaiseAt: number;
}

interface NecromancyConfig {
  enabled: boolean;
  maxAllies: number;
  hpMultiplier: number;
  moveSpeedMultiplier: number;
  hpRegenPerSecond: number;
  intervalMs: number;
  corpseLifetimeMs: number;
  reviveRadius: number;
  targetRadius: number;
  leashRadius: number;
  teleportDistance: number;
  undyingCount: number;
  replaceWeakest: boolean;
}

/** Host-authoritative summons for the Nekromantie boss upgrade. */
export class NecromancySystem {
  private readonly corpses: CorpseRecord[] = [];
  private readonly owners = new Map<string, OwnerState>();
  /** Feste Ringplätze der Wiederbelebten, damit ihre Position nicht bei jedem Frame springt. */
  private readonly followSlots = new Map<string, number>();
  private readonly undyingAllyIds = new Set<string>();
  private corpseSink: NecromancyCorpseSink | null = null;
  private nextCorpseId = 1;
  private nextFollowSlot = 0;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly allyFlowFields: ReadonlyMap<string, EnemyFlowFieldService>,
    private readonly resolveStat: NecromancyStatResolver,
  ) {}

  /** Registriert die Leichen-Darstellung; ohne Sink bleibt das System rein mechanisch. */
  setCorpseSink(sink: NecromancyCorpseSink | null): void {
    this.corpseSink = sink;
  }

  recordEnemyDeath(death: EnemyDeathInfo, now = Date.now()): void {
    if (death.faction !== 'hostile') return;
    const corpse: CorpseRecord = {
      id: this.nextCorpseId++,
      kind: death.kind,
      x: death.x,
      y: death.y,
      xp: getCoopDefenseEnemyXp(death.kind),
      diedAt: now,
      expiresAt: now + DEFAULT_CORPSE_LIFETIME_MS,
    };
    this.corpses.push(corpse);
    this.corpseSink?.onCorpseAdded(corpse.id, corpse.x, corpse.y, death.size, DEFAULT_CORPSE_LIFETIME_MS);
  }

  /**
   * Fängt den Tod der stärksten Wiederbelebten ab (Upgrade „Untote Wiederkehr"). Der Gegner wird
   * dabei vollständig geheilt; der Rang wird einmal pro Frame in `hostUpdate` bestimmt.
   */
  handleLethalDamage(enemy: EnemyEntity): boolean {
    if (enemy.faction !== 'allied' || !this.undyingAllyIds.has(enemy.id)) return false;
    enemy.setHp(enemy.getMaxHp());
    return true;
  }

  /**
   * Übernimmt einen Gegner ohne Wiederbelebung als Verbündeten – etwa eine an der Reflexkuppel
   * abgefangene Brutbombe. Das Ally-Limit wird hier bewusst **nicht** geprüft, so dass eine
   * Übernahme darüber hinausgehen darf; die übernommenen Einheiten zählen danach aber ganz normal
   * ins Limit für reguläre Wiederbelebungen. Nekromantie-Boni (HP-Multiplikator beim Spawn, Tempo
   * und Regeneration im Frame-Update) gelten wie für wiederbelebte Dachse.
   */
  captureAlly(ownerId: string, x: number, y: number, kind: CoopDefenseEnemyKind): EnemyEntity | null {
    const owner = this.playerManager.getPlayer(ownerId);
    if (!owner?.active || !this.combatSystem.isAlive(ownerId)) return null;
    const cfg = this.resolveConfig(ownerId);
    return this.enemyManager.hostSpawnAllyAtWorld(x, y, kind, ownerId, owner.color, cfg.hpMultiplier);
  }

  hostUpdate(now: number, deltaMs: number): void {
    this.pruneExpiredCorpses(now);
    const activeOwners = new Set<string>();
    const knownAllyIds = new Set<string>();
    this.undyingAllyIds.clear();

    for (const player of this.playerManager.getAllPlayers()) {
      const cfg = this.resolveConfig(player.id);
      const alive = player.active && this.combatSystem.isAlive(player.id);
      // Auch ohne Nekromantie-Upgrade werden bereits übernommene Verbündete weiter gesteuert –
      // sonst würden an der Kuppel abgefangene Dachse sofort wieder verschwinden.
      const hasAllies = this.enemyManager.getAlliedEnemies(player.id).length > 0;
      if (!alive || (!cfg.enabled && !hasAllies)) {
        this.clearOwner(player.id);
        continue;
      }

      activeOwners.add(player.id);
      const owner = this.owners.get(player.id) ?? { nextRaiseAt: now };
      this.owners.set(player.id, owner);

      if (cfg.enabled && now >= owner.nextRaiseAt
        && this.raiseForOwner(player.id, player.color, player.x, player.y, cfg)) {
        owner.nextRaiseAt = now + cfg.intervalMs;
      }

      const allies = this.enemyManager.getAlliedEnemies(player.id);
      for (const ally of allies) {
        knownAllyIds.add(ally.id);
        this.prepareAlly(ally, player.id, player.x, player.y, cfg, deltaMs);
      }
      for (const ally of this.selectStrongestAllies(allies, cfg.undyingCount)) {
        this.undyingAllyIds.add(ally.id);
      }

      const target = this.findTarget(player.x, player.y, cfg.targetRadius);
      const targetInLeash = target
        && Phaser.Math.Distance.Between(target.sprite.x, target.sprite.y, player.x, player.y) <= cfg.leashRadius;
      // Ein Flowfield wird pro Besitzer geteilt. Wenn auch nur ein Mitglied der
      // Gruppe die Leash verlassen hat, kehrt deshalb die ganze Gruppe kurz zum
      // Besitzer zurueck. So zeigen Navigation und tatsaechliches Ziel immer auf
      // dieselbe Position.
      const returningHome = !targetInLeash || allies.some((ally) => (
        Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, player.x, player.y) > cfg.leashRadius
      ));
      const destination = returningHome
        ? { x: player.x, y: player.y, target: undefined }
        : { x: target.sprite.x, y: target.sprite.y, target };

      this.updateFlowFieldGoal(player.id, destination.x, destination.y);
      const followRadius = Math.min(
        FOLLOW_RADIUS_MAX_PX,
        FOLLOW_RADIUS_BASE_PX + FOLLOW_RADIUS_PER_ALLY_PX * Math.max(0, allies.length - 1),
      );
      for (const ally of allies) {
        this.updateAlly(ally, player.id, player.color, destination, followRadius, now, deltaMs);
      }
    }

    for (const ownerId of [...this.owners.keys()]) {
      if (activeOwners.has(ownerId)) continue;
      this.clearOwner(ownerId);
    }
    for (const allyId of [...this.followSlots.keys()]) {
      if (!knownAllyIds.has(allyId)) this.followSlots.delete(allyId);
    }
  }

  clear(): void {
    for (const corpse of this.corpses) this.corpseSink?.onCorpseRemoved(corpse.id);
    this.corpses.length = 0;
    for (const ownerId of [...this.owners.keys()]) this.clearOwner(ownerId);
    this.owners.clear();
    this.followSlots.clear();
    this.undyingAllyIds.clear();
  }

  /**
   * Ein Wiederbelebungsversuch für einen Besitzer. Unterhalb des Limits wird schlicht die beste
   * Leiche in Reichweite gehoben. Mit „Herrschaft der Toten" darf am Limit zusätzlich der
   * schwächste Wiederbelebte einer stärkeren Leiche weichen.
   *
   * @returns true, wenn der Versuch das Intervall verbraucht. Am Limit ohne Ersetzung bleibt der
   *   Zeitpunkt offen, damit ein frei werdender Platz sofort nachbesetzt wird.
   */
  private raiseForOwner(
    ownerId: string,
    ownerColor: number,
    ownerX: number,
    ownerY: number,
    cfg: NecromancyConfig,
  ): boolean {
    const allies = this.enemyManager.getAlliedEnemies(ownerId);
    const atLimit = allies.length >= cfg.maxAllies;
    if (atLimit && (!cfg.replaceWeakest || allies.length === 0)) return false;

    const corpseIndex = this.findBestCorpseIndex(ownerX, ownerY, cfg.reviveRadius);
    if (corpseIndex < 0) return !atLimit;

    if (atLimit) {
      const weakest = this.findWeakestAlly(allies);
      if (!weakest || this.corpses[corpseIndex].xp <= getCoopDefenseEnemyXp(weakest.kind)) return false;
      this.enemyManager.hostRemoveEnemy(weakest.id);
      this.followSlots.delete(weakest.id);
      this.undyingAllyIds.delete(weakest.id);
    }

    const [corpse] = this.corpses.splice(corpseIndex, 1);
    this.corpseSink?.onCorpseRemoved(corpse.id);
    this.enemyManager.hostSpawnAllyAtWorld(corpse.x, corpse.y, corpse.kind, ownerId, ownerColor, cfg.hpMultiplier);
    return true;
  }

  /** Rangfolge der Wiederbelebten: XP der Gattung zuerst, dann tatsächliche maximale HP. */
  private selectStrongestAllies(allies: readonly EnemyEntity[], count: number): EnemyEntity[] {
    if (count <= 0 || allies.length === 0) return [];
    return [...allies]
      .sort((left, right) => (
        getCoopDefenseEnemyXp(right.kind) - getCoopDefenseEnemyXp(left.kind)
        || right.getMaxHp() - left.getMaxHp()
        || left.id.localeCompare(right.id)
      ))
      .slice(0, count);
  }

  private findWeakestAlly(allies: readonly EnemyEntity[]): EnemyEntity | null {
    let weakest: EnemyEntity | null = null;
    for (const ally of allies) {
      if (!weakest) {
        weakest = ally;
        continue;
      }
      const candidateXp = getCoopDefenseEnemyXp(ally.kind);
      const weakestXp = getCoopDefenseEnemyXp(weakest.kind);
      if (candidateXp < weakestXp || (candidateXp === weakestXp && ally.getMaxHp() < weakest.getMaxHp())) {
        weakest = ally;
      }
    }
    return weakest;
  }

  /**
   * Persönlicher Platz im Gefolge-Ring. Die Wiederbelebten suchen damit die Nähe des Besitzers,
   * ohne auf seiner Position zu stehen.
   *
   * Steht der Besitzer an einer Basis, fällt ein Teil des Rings in den Basis-Footprint. Ein dort
   * angesetzter Platz ist unerreichbar: Der Verbündete drückt gegen die Wand, kommt nie an und
   * bleibt am Rand stehen. Solche Plätze werden deshalb entlang des Rings weitergedreht und
   * fallen notfalls auf die Besitzerposition zurück.
   */
  private resolveFollowAnchor(
    allyId: string,
    ownerId: string,
    ownerX: number,
    ownerY: number,
    followRadius: number,
  ): { x: number; y: number } {
    let slot = this.followSlots.get(allyId);
    if (slot === undefined) {
      slot = this.nextFollowSlot++;
      this.followSlots.set(allyId, slot);
    }

    const flowField = this.allyFlowFields.get(ownerId) ?? null;
    for (let attempt = 0; attempt < FOLLOW_ANCHOR_ATTEMPTS; attempt += 1) {
      const angle = (slot + attempt) * FOLLOW_SLOT_ANGLE_STEP;
      const candidate = {
        x: ownerX + Math.cos(angle) * followRadius,
        y: ownerY + Math.sin(angle) * followRadius,
      };
      if (!flowField) return candidate;
      const cell = flowField.worldToGrid(candidate.x, candidate.y);
      if (cell && flowField.isTraversableAt(cell.gridX, cell.gridY)) return candidate;
    }
    return { x: ownerX, y: ownerY };
  }

  private updateAlly(
    ally: EnemyEntity,
    ownerId: string,
    ownerColor: number,
    destination: { x: number; y: number; target?: EnemyEntity },
    followRadius: number,
    now: number,
    deltaMs: number,
  ): void {
    if (!ally.isAttackMovementPaused(now)) {
      // Beim Angriff zählt das Ziel selbst, beim Rückweg der eigene Platz im Gefolge-Ring.
      const anchor = destination.target
        ? { x: destination.x, y: destination.y }
        : this.resolveFollowAnchor(ally.id, ownerId, destination.x, destination.y, followRadius);
      const dx = anchor.x - ally.sprite.x;
      const dy = anchor.y - ally.sprite.y;
      const length = Math.hypot(dx, dy);
      if (length > FOLLOW_ARRIVAL_PX) {
        const flowDirection = this.getFlowDirection(ownerId, ally);
        if (flowDirection === null) {
          ally.stopMovement();
        } else {
          // Das Flowfield kennt nur das gemeinsame Ziel; die letzten Meter zum eigenen Platz
          // laufen deshalb direkt – aber nur, wenn die Luftlinie frei ist. Liegt eine Basisecke
          // dazwischen, würde die Direktsteuerung den Verbündeten in die Wand laufen lassen,
          // während das Flowfield ihn sauber herumführt.
          const steerDirectly = flowDirection === undefined
            || (length <= FOLLOW_DIRECT_STEER_PX && this.hasClearPathToAnchor(ownerId, ally, anchor));
          const directionX = steerDirectly ? dx / length : flowDirection.x;
          const directionY = steerDirectly ? dy / length : flowDirection.y;
          const desiredVx = directionX * ally.getMoveSpeed();
          const desiredVy = directionY * ally.getMoveSpeed();
          const current = ally.getDesiredVelocity();
          const lerp = 1 - Math.exp(-STEER_RESPONSIVENESS * Math.min(100, Math.max(0, deltaMs)) / 1000);
          ally.setDesiredVelocity(
            Phaser.Math.Linear(current.vx, desiredVx, lerp),
            Phaser.Math.Linear(current.vy, desiredVy, lerp),
          );
        }
      } else {
        ally.stopMovement();
      }
    }

    if (!destination.target?.sprite.active || !this.combatSystem.isAlive(destination.target.id) || !ally.canScanForAttack(now)) return;
    ally.scheduleNextAttackScan(now);
    for (const attackWeapon of ally.getAttackWeapons()) {
      const weapon = attackWeapon.weapon;
      if (weapon.config.fire.type === 'healing_aura' || weapon.config.fire.type === 'tesla_dome') continue;
      const distance = Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y);
      if (distance > weapon.config.range || !this.combatSystem.hasClearLineOfFire(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y)) continue;
      if (!ally.isWeaponReady(weapon, now)) return;
      const angle = Phaser.Math.Angle.Between(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y);
      if (!this.loadoutManager.fireAutomatedWeapon(
        weapon.config,
        ally.sprite.x,
        ally.sprite.y,
        angle,
        destination.target.sprite.x,
        destination.target.sprite.y,
        ally.id,
        ownerColor || COLORS.GREEN_2,
      )) return;
      ally.faceAngle(angle);
      ally.pauseAttackMovement(now);
      ally.recordWeaponUse(weapon, now);
      return;
    }
  }

  private prepareAlly(
    ally: EnemyEntity,
    ownerId: string,
    ownerX: number,
    ownerY: number,
    cfg: NecromancyConfig,
    deltaMs: number,
  ): void {
    ally.setMoveSpeedMultiplier(cfg.moveSpeedMultiplier);
    if (cfg.hpRegenPerSecond > 0 && ally.getHp() > 0 && ally.getHp() < ally.getMaxHp()) {
      ally.setHp(Math.min(ally.getMaxHp(), ally.getHp() + cfg.hpRegenPerSecond * Math.max(0, deltaMs) / 1000));
    }

    if (Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, ownerX, ownerY) <= cfg.teleportDistance) return;
    const fallback = this.findTeleportPosition(ownerId, ownerX, ownerY);
    ally.stopMovement();
    ally.setPosition(fallback.x, fallback.y);
  }

  private findTarget(ownerX: number, ownerY: number, radius: number): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDistance = radius;
    for (const enemy of this.enemyManager.getHostileEnemies()) {
      if (!enemy.sprite.active || !this.combatSystem.isAlive(enemy.id)) continue;
      const distance = Phaser.Math.Distance.Between(ownerX, ownerY, enemy.sprite.x, enemy.sprite.y);
      if (distance > bestDistance) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Setzt nur das Ziel. Die Taktung uebernimmt seit dem Worker-Umbau der `FlowFieldCoordinator`;
   * ein eigener Rebuild-Aufruf hier wuerde am festen Nav-Tick vorbeirechnen.
   */
  private updateFlowFieldGoal(ownerId: string, worldX: number, worldY: number): void {
    const flowField = this.allyFlowFields.get(ownerId);
    if (!flowField) return;
    const goal = flowField.worldToGrid(worldX, worldY);
    flowField.setDynamicGoalCells(goal ? [goal] : []);
  }

  /**
   * Nutzt dieselben Integrationswerte und Richtungsvektoren wie normale Gegner.
   * undefined bedeutet: Zielzelle erreicht, die letzten Pixel direkt laufen.
   * null bedeutet: kein erreichbarer Pfad; nicht blind durch Hindernisse steuern.
   */
  private getFlowDirection(ownerId: string, ally: EnemyEntity): { x: number; y: number } | null | undefined {
    const flowField = this.allyFlowFields.get(ownerId);
    if (!flowField) return undefined;
    const cell = flowField.worldToGrid(ally.sprite.x, ally.sprite.y);
    if (!cell) return undefined;
    const integration = flowField.getIntegrationValueAt(cell.gridX, cell.gridY);
    if (integration >= EnemyFlowFieldService.INTEGRATION_INFINITY) {
      const recovery = flowField.findNearestReachableWorldPosition(cell.gridX, cell.gridY);
      if (!recovery) return null;
      const dx = recovery.x - ally.sprite.x;
      const dy = recovery.y - ally.sprite.y;
      const length = Math.hypot(dx, dy);
      return length > 0.001 ? { x: dx / length, y: dy / length } : null;
    }
    if (integration <= 0) return undefined;
    const vector = flowField.getVectorAt(cell.gridX, cell.gridY);
    if (vector.x === 0 && vector.y === 0) return null;
    // Wie bei den Gegnern: Der grobe Zellvektor genügt auf freier Fläche, an Basiswänden nicht.
    if (!ally.isBoss() && !flowField.isWallAdjacentAt(cell.gridX, cell.gridY)) return vector;
    const waypoint = flowField.getNextCellWorldPosition(cell.gridX, cell.gridY);
    if (!waypoint) return vector;
    const dx = waypoint.x - ally.sprite.x;
    const dy = waypoint.y - ally.sprite.y;
    const length = Math.hypot(dx, dy);
    return length > 0.001 ? { x: dx / length, y: dy / length } : vector;
  }

  private hasClearPathToAnchor(
    ownerId: string,
    ally: EnemyEntity,
    anchor: { x: number; y: number },
  ): boolean {
    const flowField = this.allyFlowFields.get(ownerId);
    if (!flowField) return true;
    return flowField.hasWalkableLine(ally.sprite.x, ally.sprite.y, anchor.x, anchor.y);
  }

  private findTeleportPosition(ownerId: string, ownerX: number, ownerY: number): { x: number; y: number } {
    const flowField = this.allyFlowFields.get(ownerId);
    const ownerCell = flowField?.worldToGrid(ownerX, ownerY);
    if (!flowField || !ownerCell) return { x: ownerX, y: ownerY };

    for (let radius = 1; radius <= TELEPORT_SEARCH_RADIUS_CELLS; radius += 1) {
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          const gridX = ownerCell.gridX + offsetX;
          const gridY = ownerCell.gridY + offsetY;
          if (!flowField.isTraversableAt(gridX, gridY)) continue;
          const world = flowField.gridToWorld(gridX, gridY);
          if (world) return world;
        }
      }
    }

    return { x: ownerX, y: ownerY };
  }

  private findBestCorpseIndex(ownerX: number, ownerY: number, radius: number): number {
    let bestIndex = -1;
    for (let index = 0; index < this.corpses.length; index += 1) {
      const candidate = this.corpses[index];
      const candidateDistance = Phaser.Math.Distance.Between(ownerX, ownerY, candidate.x, candidate.y);
      if (candidateDistance > radius) continue;
      if (bestIndex < 0) {
        bestIndex = index;
        continue;
      }
      const best = this.corpses[bestIndex];
      const bestDistance = Phaser.Math.Distance.Between(ownerX, ownerY, best.x, best.y);
      if (candidate.xp > best.xp || (candidate.xp === best.xp && (candidateDistance < bestDistance || (candidateDistance === bestDistance && candidate.diedAt < best.diedAt)))) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private pruneExpiredCorpses(now: number): void {
    for (let index = this.corpses.length - 1; index >= 0; index -= 1) {
      // Der Marker blendet in der Darstellung selbst aus; hier fällt nur der Datensatz weg.
      if (now >= this.corpses[index].expiresAt) this.corpses.splice(index, 1);
    }
  }

  private clearOwner(ownerId: string): void {
    for (const ally of this.enemyManager.getAlliedEnemies(ownerId)) {
      this.enemyManager.hostRemoveEnemy(ally.id);
      this.followSlots.delete(ally.id);
      this.undyingAllyIds.delete(ally.id);
    }
    this.owners.delete(ownerId);
  }

  private resolveConfig(playerId: string): NecromancyConfig {
    const leashRadius = Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.leashRadius`, DEFAULT_LEASH_RADIUS));
    return {
      enabled: this.resolveStat(playerId, `${STAT_PREFIX}.enabled`, 0) > 0,
      maxAllies: Math.max(0, Math.floor(this.resolveStat(playerId, `${STAT_PREFIX}.maxAllies`, 0))),
      hpMultiplier: Math.max(1, this.resolveStat(playerId, `${STAT_PREFIX}.hpMultiplier`, 1)),
      moveSpeedMultiplier: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.moveSpeedMultiplier`, 1)),
      hpRegenPerSecond: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.hpRegenPerSecond`, 0)),
      intervalMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.intervalMs`, DEFAULT_INTERVAL_MS)),
      corpseLifetimeMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.corpseLifetimeMs`, DEFAULT_CORPSE_LIFETIME_MS)),
      reviveRadius: this.resolveStat(playerId, `${STAT_PREFIX}.reviveRadius`, DEFAULT_REVIVE_RADIUS),
      targetRadius: this.resolveStat(playerId, `${STAT_PREFIX}.targetRadius`, DEFAULT_TARGET_RADIUS),
      leashRadius,
      teleportDistance: Math.max(
        leashRadius,
        this.resolveStat(playerId, `${STAT_PREFIX}.teleportDistance`, DEFAULT_TELEPORT_DISTANCE),
      ),
      undyingCount: Math.max(0, Math.floor(this.resolveStat(playerId, `${STAT_PREFIX}.undyingCount`, 0))),
      replaceWeakest: this.resolveStat(playerId, `${STAT_PREFIX}.replaceWeakest`, 0) > 0,
    };
  }
}
