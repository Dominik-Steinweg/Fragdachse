import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { CombatActorStatePort, CombatRelationshipQueryPort } from '../combat/CombatCapabilities';
import type { TurretDamageBuff } from '../types';
import { DEFAULT_TURRET_AIM_TOLERANCE_DEG, type TurretAimConfig } from '../config/turretAim';
import { stepTurretAngle, turretAngleDifference } from '../utils/turretAngle';
import type { ManualTurretControl } from './TurretControlSystem';

/**
 * Schusslinienprüfung des Turrets. Bewusst die Schuss- und nicht die Sichtlinie: ein Turret,
 * dessen Projektil im Zug einschlägt, darf das Ziel gar nicht erst wählen.
 */
type LineOfFireChecker = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  skipRockIndex?: number,
  sourceCarrierBaseId?: string,
) => boolean;
export type AutomatedTurretId = number | string;
export type AutomatedTurretTargetMode = 'players' | 'enemies';
export interface AutomatedTurret extends TurretAimConfig {
  /** Occupant exit contour; retained through removal of the turret or its carrier. */
  readonly footprint?: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly angle?: number;
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly weaponId?: keyof typeof WEAPON_CONFIGS;
  readonly skipRockIndex?: number;
  /** Nur der konkrete Träger ist bis zum ersten vollständigen Austritt freigegeben. */
  readonly sourceCarrierBaseId?: string;
  readonly secondProjectileDamageFactor?: number;
  /** Beim Platzieren eingefrorene Zielreichweite; fehlt bei Basis-Turrets (dann gilt die Config). */
  readonly targetRange?: number;
  readonly projectileRange?: number;
  readonly cooldownMs?: number;
  readonly damage?: number;
  readonly muzzleOffset?: number;
  /** Erzwingt die Laufzeit-Zielfraktion; ohne Wert bleibt das bisherige gemischte Verhalten. */
  readonly targetMode?: AutomatedTurretTargetMode;
}
export type TurretFireState = 'active' | 'paused';
/**
 * Eintrag des Turmfeuers. Eine Konstruktion ist ohne Feuerleitung genau eine Quelle, deren
 * Identitäts-, Folge- und Darstellungsschlüssel ihre eigene ID sind. Temporäre Quellen (Turmkopien)
 * tragen eine eigene `id`, verweisen aber über `identityId` auf ihr Original.
 */
export interface TurretFireSource extends AutomatedTurret {
  /** Konstruktion, der identitätsgebundene Effekte, Bemannung und Attribution gehören. */
  readonly identityId: AutomatedTurretId;
  /** Owner von Cooldown und laufender Salve; Einträge mit gleichem Schlüssel teilen ihre Feuerfolge. */
  readonly sequenceKey: AutomatedTurretId;
  /** Startzustand einer noch unbekannten eigenen Folge (`nextFireAt` dieses Schlüssels). */
  readonly sequenceSeedKey?: AutomatedTurretId;
  /** Pausierte Quellen beginnen nichts Neues, halten aber ihre Feuerfolge am Leben. */
  readonly fireState: TurretFireState;
  /** Sprite, das Schussanimation und Rohrdrehung dieses Eintrags darstellt. */
  readonly visualId: AutomatedTurretId;
}
/** Zusatzwissen eines Schusses, das nicht in die positionalen Fire-Handler-Argumente gehört. */
export interface TurretFireContext {
  readonly source: TurretFireSource;
}
export function toLocalTurretFireSource(turret: AutomatedTurret): TurretFireSource {
  return { ...turret, identityId: turret.id, sequenceKey: turret.id, visualId: turret.id, fireState: 'active' };
}
type TurretProvider = () => readonly AutomatedTurret[];
type TurretFireSourceProvider = () => readonly TurretFireSource[];
type TurretAngleUpdater = (source: TurretFireSource, angle: number) => void;
type EnemyTargetProvider = () => readonly { id: string; x: number; y: number }[];
type FocusTargetProvider = (ownerId: string) => { targetType: 'enemy' | 'base'; targetId: string } | null;
type FocusedBaseTargetProvider = (targetId: string, turretX: number, turretY: number) => { id: string; x: number; y: number } | null;
interface PendingTurretBurst {
  /** Eintrag, der die Salve begonnen hat; nur er darf sie fortsetzen. */
  ownerEntryId: AutomatedTurretId;
  /** Cooldown der Folge, falls die Salve mit ihrem Eintrag abgebrochen wird. */
  cooldownMs: number;
  shotsRemaining: number;
  nextShotAt: number;
  targetX: number;
  targetY: number;
  damageMultiplier: number;
  rangeFactor: number;
}
type TurretFireHandler = (
  ownerId: string,
  color: number,
  weaponId: keyof typeof WEAPON_CONFIGS,
  x: number,
  y: number,
  angle: number,
  targetX: number,
  targetY: number,
  damageFactor?: number,
  rangeFactor?: number,
  /** Identität (Original) für Attribution und identitätsgebundene Trefferwirkungen. */
  sourceTurretId?: AutomatedTurretId,
  skipRockIndex?: number,
  sourceCarrierBaseId?: string,
  context?: TurretFireContext,
) => void;

export class TurretSystem {
  private manualControlProvider: ((id: AutomatedTurretId, now: number) => ManualTurretControl | null) | null = null;
  private readonly controlRevisions = new Map<AutomatedTurretId, number>();

  setManualControlProvider(provider: typeof this.manualControlProvider): void {
    this.manualControlProvider = provider;
  }
  private lineOfFireChecker: LineOfFireChecker | null = null;
  private turretProvider: TurretProvider | null = null;
  private fireSourceProvider: TurretFireSourceProvider | null = null;
  private turretAngleUpdater: TurretAngleUpdater | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private focusTargetProvider: FocusTargetProvider | null = null;
  private focusedBaseTargetProvider: FocusedBaseTargetProvider | null = null;
  private fireHandler: TurretFireHandler | null = null;
  private turretDamageBuffProvider: ((x: number, y: number) => TurretDamageBuff | null) | null = null;
  private turretDamageMultiplierProvider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null = null;
  /** Nach `sequenceKey`; überlebt Pausen und Wechsel zwischen Original und Kopie. */
  private nextFireAt = new Map<AutomatedTurretId, number>();
  /** Nach `sequenceKey`; `ownerEntryId` bindet die Salve an ihren Eintrag. */
  private pendingBursts = new Map<AutomatedTurretId, PendingTurretBurst>();
  private targetScore: ((turret: TurretFireSource, kind: 'player' | 'enemy' | 'base', id: string, now: number) => number) | null = null;

  setTargetScoreProvider(provider: typeof this.targetScore): void { this.targetScore = provider; }

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatActorStatePort & CombatRelationshipQueryPort,
  ) {}

  setLineOfFireChecker(checker: LineOfFireChecker | null): void {
    this.lineOfFireChecker = checker;
  }

  /**
   * Konstruktionsbestand (für `getTurrets()`) und Winkel-Senke. Ohne eigenen Feuerquellen-Provider
   * ist jede Konstruktion genau eine lokale Feuerquelle.
   */
  setTurretProvider(provider: TurretProvider | null, angleUpdater: TurretAngleUpdater | null): void {
    this.turretProvider = provider;
    this.turretAngleUpdater = angleUpdater;
  }

  /**
   * Vollständige Feuerquellen-Liste einschließlich temporärer Quellen. Temporäre Quellen gelangen
   * bewusst nur hierüber ins Turmfeuer und nie in `getTurrets()`: Bemannung, Interaktion, Homing und
   * Fernsteuerung lesen den Konstruktionsbestand.
   */
  setFireSourceProvider(provider: TurretFireSourceProvider | null): void {
    this.fireSourceProvider = provider;
  }

  setEnemyTargetProvider(provider: EnemyTargetProvider | null): void {
    this.enemyTargetProvider = provider;
  }

  setFocusTargetProvider(provider: FocusTargetProvider | null): void {
    this.focusTargetProvider = provider;
  }

  setFocusedBaseTargetProvider(provider: FocusedBaseTargetProvider | null): void {
    this.focusedBaseTargetProvider = provider;
  }

  setFireHandler(handler: TurretFireHandler | null): void {
    this.fireHandler = handler;
    if (!handler) {
      this.nextFireAt.clear();
      this.pendingBursts.clear();
      this.controlRevisions.clear();
    }
  }

  /**
   * Ortsbezogener Konstruktionsbuff aus der Verstärkungsmatrix-/Energieinjektor-Pipeline.
   * Bewusst positionsbasiert, damit platzierte Konstruktionen, Fliegenpilze und Basistuerme
   * ohne Sonderfall profitieren. Abgefragt wird die Position der Identität (des Originals), nie die
   * einer temporären Quelle.
   */
  setTurretDamageBuffProvider(provider: ((x: number, y: number) => TurretDamageBuff | null) | null): void {
    this.turretDamageBuffProvider = provider;
  }

  /** Zusätzlicher, quellenbezogener Schadensmultiplikator für Konstrukte; erhält die Identität. */
  setTurretDamageMultiplierProvider(
    provider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null,
  ): void {
    this.turretDamageMultiplierProvider = provider;
  }

  /**
   * Aktueller Konstruktionsbestand aus derselben Quelle, die auch das Turmfeuer speist. Der
   * Energieinjektor braucht ihn fuer Zielsuche und Treffer-Zuordnung; ein zweiter
   * Enumerationspfad wuerde sonst Basistuerme oder Fliegenpilze vergessen. Temporäre
   * Feuerquellen (`setFireSourceProvider`) sind bewusst nicht enthalten.
   */
  getTurrets(): readonly AutomatedTurret[] {
    return this.turretProvider?.() ?? [];
  }

  hostUpdate(
    now: number,
    config: PlaceableTurretUtilityConfig,
    _weaponConfig: WeaponConfig,
    deltaMs = 0,
  ): void {
    const turrets = this.fireSourceProvider?.() ?? (this.turretProvider?.() ?? []).map(toLocalTurretFireSource);
    const entrySequences = new Map<AutomatedTurretId, AutomatedTurretId>();
    const activeSequences = new Set<AutomatedTurretId>();
    const activeIdentities = new Set<AutomatedTurretId>();
    let constructions: Map<AutomatedTurretId, AutomatedTurret> | null = null;
    const identityOf = (source: TurretFireSource): AutomatedTurret | null => {
      if (source.id === source.identityId) return source;
      constructions ??= new Map((this.turretProvider?.() ?? []).map(turret => [turret.id, turret]));
      return constructions.get(source.identityId) ?? null;
    };
    // Neue eigene Folgen übernehmen den Stand ihres Seeds vom Tick-Beginn, unabhängig davon, ob der
    // Seed in diesem Tick vor ihnen feuert.
    for (const source of turrets) {
      if (source.sequenceSeedKey === undefined || this.nextFireAt.has(source.sequenceKey)) continue;
      this.nextFireAt.set(source.sequenceKey, this.nextFireAt.get(source.sequenceSeedKey) ?? 0);
    }

    for (const turret of turrets) {
      // Eine temporäre Quelle ohne bestehendes Original ist verwaist: Sie feuert nicht und hält
      // weder Feuerfolge noch Bemannungszustand am Leben.
      const identity = identityOf(turret);
      if (!identity) continue;
      const sequenceKey = turret.sequenceKey;
      entrySequences.set(turret.id, sequenceKey);
      activeSequences.add(sequenceKey);
      activeIdentities.add(turret.identityId);

      const turretX = turret.x;
      const turretY = turret.y;
      // Zielreichweite-Upgrades haengen am platzierten Turret, nicht an der Basis-Config. Der
      // gleiche Faktor streckt die Waffenreichweite mit, sonst sterben Projektile vor dem Ziel.
      const baseTargetRange = config.placeable.targetRange;
      const targetRange = turret.targetRange ?? baseTargetRange;
      const turretWeaponId = turret.weaponId ?? 'SPORES';
      const turretWeaponConfig = WEAPON_CONFIGS[turretWeaponId] ?? _weaponConfig;
      const cooldownMs = Math.max(1, turret.cooldownMs ?? turretWeaponConfig.cooldown);
      // Bemannbar ist nur die Konstruktion selbst, nie eine temporäre Projektion.
      const construction = turret.id === turret.identityId;
      const manned = construction ? this.manualControlProvider?.(turret.identityId, now) ?? null : null;
      if (construction) {
        const revision = manned?.revision ?? 0;
        if ((this.controlRevisions.get(turret.identityId) ?? 0) !== revision) {
          if (this.deleteOwnedBurst(turret)) {
            this.nextFireAt.set(sequenceKey, Math.max(this.nextFireAt.get(sequenceKey) ?? 0, now + cooldownMs));
          }
          this.controlRevisions.set(turret.identityId, revision);
        }
      }
      // Tesla-Konstrukte werden vom TeslaDomeSystem als Feldwaffe verarbeitet und
      // duerfen hier nicht zusaetzlich den generischen Projektilpfad ausloesen.
      if (turretWeaponConfig.fire.type === 'tesla_dome') continue;
      const pendingBurst = this.pendingBursts.get(sequenceKey);
      // Eine Salve gehört ihrem Eintrag: Eine andere Quelle derselben Folge wartet ihr Ende ab,
      // statt sie fortzusetzen oder parallel eine neue zu beginnen.
      if (pendingBurst && pendingBurst.ownerEntryId !== turret.id) continue;
      // Pausierte Quellen beginnen nichts Neues; eine eigene laufende Salve führen sie zu Ende.
      const paused = turret.fireState === 'paused';
      if (paused && !pendingBurst) continue;
      const manual = paused ? null : manned;
      const rangeFactor = turret.projectileRange !== undefined ? turret.projectileRange / turretWeaponConfig.range : turret.muzzleOffset === undefined
        ? (baseTargetRange > 0 ? targetRange / baseTargetRange : 1)
        : Math.max(1, targetRange / Math.max(1, turretWeaponConfig.range));
      const muzzleOffset = turret.muzzleOffset ?? config.placeable.muzzleOffset;
      const manualTarget = manual ? this.resolveManualTarget(turret, manual, targetRange, muzzleOffset) : null;
      if (manual && !manual.fresh) {
        if (this.deleteOwnedBurst(turret)) this.nextFireAt.set(sequenceKey, now + cooldownMs);
        continue;
      }

      if (pendingBurst) {
        if (manualTarget) {
          pendingBurst.targetX = manualTarget.x;
          pendingBurst.targetY = manualTarget.y;
        }
        // Legacy bursts only update their pose when due; limited turrets track between shots.
        if (turret.rotationSpeedDegPerSec === undefined && (now < pendingBurst.nextShotAt || !this.fireHandler)) continue;
        const desiredAngle = Phaser.Math.Angle.Between(
          turretX,
          turretY,
          pendingBurst.targetX,
          pendingBurst.targetY,
        );
        const burstAngle = this.updateAim(turret, desiredAngle, deltaMs);
        if (now < pendingBurst.nextShotAt || !this.fireHandler) continue;
        if (turret.rotationSpeedDegPerSec === undefined
          && !this.hasLineOfFireFromMuzzle(turret, turretX, turretY, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset)) continue;
        if (!this.canFireAtAngle(turret, burstAngle, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset)) continue;
        const muzzleX = turretX + Math.cos(burstAngle) * muzzleOffset;
        const muzzleY = turretY + Math.sin(burstAngle) * muzzleOffset;
        this.fireHandler?.(
          turret.ownerId,
          turret.ownerColor,
          turretWeaponId,
          muzzleX,
          muzzleY,
          burstAngle,
          pendingBurst.targetX,
          pendingBurst.targetY,
          pendingBurst.damageMultiplier,
          pendingBurst.rangeFactor,
          turret.identityId,
          turret.skipRockIndex,
          turret.sourceCarrierBaseId,
          { source: turret },
        );
        pendingBurst.shotsRemaining -= 1;
        if (pendingBurst.shotsRemaining > 0) {
          pendingBurst.nextShotAt = now + Math.max(1, turretWeaponConfig.turretBurst?.intervalMs ?? 1);
        } else {
          this.pendingBursts.delete(sequenceKey);
          this.nextFireAt.set(sequenceKey, now + cooldownMs);
        }
        continue;
      }

      const target = manualTarget ?? this.findNearestTarget(
        turret,
        turretX,
        turretY,
        targetRange,
        muzzleOffset,
        now,
      );
      if (!target) continue;

      const angle = this.updateAim(turret, Phaser.Math.Angle.Between(turretX, turretY, target.x, target.y), deltaMs);

      if (manual && !manual.fireHeld) continue;
      if (now < (this.nextFireAt.get(sequenceKey) ?? 0)) continue;
      if (manual && turret.rotationSpeedDegPerSec === undefined
        && !this.hasLineOfFireFromMuzzle(turret, turretX, turretY, target.x, target.y, muzzleOffset)) continue;
      if (!this.canFireAtAngle(turret, angle, target.x, target.y, muzzleOffset)) continue;
      // Identitätsgebundene Verstärkungen (Injektor, Fernsteuerung) folgen dem Original, auch wenn
      // eine temporäre Quelle an anderem Ort feuert.
      const buff = this.turretDamageBuffProvider?.(identity.x, identity.y) ?? null;
      const damageMultiplier = (buff?.damageMultiplier ?? 1)
        * (turret.damage === undefined ? 1 : turret.damage / turretWeaponConfig.damage)
        * Math.max(0, this.turretDamageMultiplierProvider?.(identity, turrets) ?? 1);

      const muzzleDistance = muzzleOffset;
      const muzzleX = turretX + Math.cos(angle) * muzzleDistance;
      const muzzleY = turretY + Math.sin(angle) * muzzleDistance;
      if (!this.fireHandler) continue;
      this.fireHandler?.(
        turret.ownerId,
        turret.ownerColor,
        turretWeaponId,
        muzzleX,
        muzzleY,
        angle,
        target.x,
        target.y,
        damageMultiplier,
        rangeFactor,
        turret.identityId,
        turret.skipRockIndex,
        turret.sourceCarrierBaseId,
        { source: turret },
      );
      const burstCount = turretWeaponConfig.turretBurst
        ? Math.max(1, Math.floor(turretWeaponConfig.turretBurst.count))
        : 1;
      if (burstCount > 1) {
        this.pendingBursts.set(sequenceKey, {
          ownerEntryId: turret.id,
          cooldownMs,
          shotsRemaining: burstCount - 1,
          nextShotAt: now + Math.max(1, turretWeaponConfig.turretBurst?.intervalMs ?? 1),
          targetX: target.x,
          targetY: target.y,
          damageMultiplier,
          rangeFactor,
        });
      } else {
        this.nextFireAt.set(sequenceKey, now + cooldownMs);
      }
      if (burstCount <= 1 && (turret.secondProjectileDamageFactor ?? 0) > 0) {
        const secondTarget = manualTarget ?? this.findNearestTarget(
          turret,
          turretX,
          turretY,
          targetRange,
          muzzleOffset,
          now,
          target,
        );
        if (secondTarget) {
          const secondAngle = turret.rotationSpeedDegPerSec === undefined
            ? Phaser.Math.Angle.Between(turretX, turretY, secondTarget.x, secondTarget.y) : angle;
          if (!this.canFireAtAngle(turret, secondAngle, secondTarget.x, secondTarget.y, muzzleOffset)) continue;
          this.fireHandler?.(
            turret.ownerId,
            turret.ownerColor,
            turretWeaponId,
            muzzleX,
            muzzleY,
            secondAngle,
            secondTarget.x,
            secondTarget.y,
            (turret.secondProjectileDamageFactor ?? 0) * damageMultiplier,
            rangeFactor,
            turret.identityId,
            turret.skipRockIndex,
            turret.sourceCarrierBaseId,
            { source: turret },
          );
        }
      }
    }

    for (const [sequenceKey, burst] of [...this.pendingBursts]) {
      if (entrySequences.get(burst.ownerEntryId) === sequenceKey) continue;
      this.pendingBursts.delete(sequenceKey);
      // Lebt die Folge in einem anderen Eintrag weiter, kostet der Abbruch den regulären Cooldown,
      // statt eine freie Salve zu hinterlassen.
      if (activeSequences.has(sequenceKey)) {
        this.nextFireAt.set(sequenceKey, Math.max(this.nextFireAt.get(sequenceKey) ?? 0, now + burst.cooldownMs));
      }
    }
    for (const sequenceKey of [...this.nextFireAt.keys()]) {
      if (!activeSequences.has(sequenceKey)) this.nextFireAt.delete(sequenceKey);
    }
    for (const id of this.controlRevisions.keys()) {
      if (!activeIdentities.has(id)) this.controlRevisions.delete(id);
    }
  }

  /** Entfernt die Salve der Folge nur, wenn dieser Eintrag sie begonnen hat. */
  private deleteOwnedBurst(source: TurretFireSource): boolean {
    const burst = this.pendingBursts.get(source.sequenceKey);
    if (!burst || burst.ownerEntryId !== source.id) return false;
    return this.pendingBursts.delete(source.sequenceKey);
  }

  private resolveManualTarget(turret: AutomatedTurret, control: ManualTurretControl, range: number, muzzle: number): { x: number; y: number } {
    const dx = control.targetX - turret.x, dy = control.targetY - turret.y;
    const angle = dx === 0 && dy === 0 ? turret.angle ?? 0 : Math.atan2(dy, dx);
    const distance = Math.max(muzzle, Math.min(range, Math.hypot(dx, dy)));
    return { x: turret.x + Math.cos(angle) * distance, y: turret.y + Math.sin(angle) * distance };
  }

  private updateAim(turret: TurretFireSource, desiredAngle: number, deltaMs: number): number {
    const angle = turret.rotationSpeedDegPerSec === undefined ? desiredAngle
      : stepTurretAngle(turret.angle ?? 0, desiredAngle, turret.rotationSpeedDegPerSec, deltaMs);
    this.turretAngleUpdater?.(turret, angle);
    return angle;
  }

  private canFireAtAngle(turret: AutomatedTurret, angle: number, targetX: number, targetY: number, muzzleOffset: number): boolean {
    if (turret.rotationSpeedDegPerSec === undefined) return true;
    const desiredAngle = Math.atan2(targetY - turret.y, targetX - turret.x);
    const tolerance = (turret.aimToleranceDeg ?? DEFAULT_TURRET_AIM_TOLERANCE_DEG) * Math.PI / 180;
    if (Math.abs(turretAngleDifference(angle, desiredAngle)) > tolerance + 1e-10) return false;
    if (!this.lineOfFireChecker) return true;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const distance = Math.max(muzzleOffset, Math.hypot(targetX - turret.x, targetY - turret.y));
    return this.lineOfFireChecker(
      turret.x + dx * muzzleOffset, turret.y + dy * muzzleOffset,
      turret.x + dx * distance, turret.y + dy * distance,
      turret.skipRockIndex, turret.sourceCarrierBaseId,
    );
  }

  private findNearestTarget(
    turret: TurretFireSource,
    turretX: number,
    turretY: number,
    range: number,
    lineOfFireStartOffset: number,
    now: number,
    excluded?: { x: number; y: number },
  ): { x: number; y: number } | null {
    let bestTarget: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestKey = '';
    const focus = this.focusTargetProvider?.(turret.ownerId) ?? null;

    const consider = (candidate: { x: number; y: number }, priority: number, kind: 'player' | 'enemy' | 'base', id: string): void => {
      const distance = Phaser.Math.Distance.Between(turretX, turretY, candidate.x, candidate.y);
      if (distance > range) return;
      if (!this.hasLineOfFireFromMuzzle(turret, turretX, turretY, candidate.x, candidate.y, lineOfFireStartOffset)) return;
      const score = this.targetScore?.(turret, kind, id, now) ?? 0;
      const key = kind + ':' + id;
      if (priority > bestPriority || (priority === bestPriority && (score < bestScore
        || (score === bestScore && (distance > bestDistance || (distance === bestDistance && key >= bestKey)))))) return;
      bestPriority = priority;
      bestScore = score;
      bestKey = key;
      bestDistance = distance;
      bestTarget = candidate;
    };

    if (turret.targetMode !== 'enemies') for (const player of this.playerManager.getAllPlayers()) {
      if (excluded && player.x === excluded.x && player.y === excluded.y) continue;
      if (player.id === turret.ownerId) continue;
      if (!player.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, player.id)) continue;

      // Fokusziele werden nur priorisiert; Reichweite und Sichtlinie bleiben verbindlich.
      consider(
        { x: player.x, y: player.y },
        focus?.targetType === 'enemy' && focus.targetId === player.id ? 0 : 1,
        'player', player.id,
      );
    }

    if (turret.targetMode !== 'players') for (const enemy of this.enemyTargetProvider?.() ?? []) {
      if (excluded && enemy.x === excluded.x && enemy.y === excluded.y) continue;
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, enemy.id)) continue;

      consider(
        { x: enemy.x, y: enemy.y },
        focus?.targetType === 'enemy' && focus.targetId === enemy.id ? 0 : 1,
        'enemy', enemy.id,
      );
    }

    if (focus?.targetType === 'base') {
      const base = this.focusedBaseTargetProvider?.(focus.targetId, turretX, turretY) ?? null;
      if (base) consider({ x: base.x, y: base.y }, 0, 'base', base.id);
    }

    return bestTarget;
  }

  private hasLineOfFireFromMuzzle(
    turret: AutomatedTurret,
    turretX: number,
    turretY: number,
    targetX: number,
    targetY: number,
    muzzleOffset: number,
  ): boolean {
    if (!this.lineOfFireChecker) return true;
    const angle = Phaser.Math.Angle.Between(turretX, turretY, targetX, targetY);
    const startX = turretX + Math.cos(angle) * muzzleOffset;
    const startY = turretY + Math.sin(angle) * muzzleOffset;
    return this.lineOfFireChecker(
      startX,
      startY,
      targetX,
      targetY,
      turret.skipRockIndex,
      turret.sourceCarrierBaseId,
    );
  }
}
