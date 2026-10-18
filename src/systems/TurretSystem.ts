import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { CombatActorStatePort, CombatRelationshipQueryPort } from '../combat/CombatCapabilities';
import type { TurretDamageBuff } from '../types';
import { DEFAULT_TURRET_AIM_TOLERANCE_DEG } from '../config/turretAim';
import { stepTurretAngle, turretAngleDifference } from '../utils/turretAngle';
import type { ManualTurretControl } from './TurretControlSystem';
import { canWeaponDamageBases, type TurretHitSegment } from './TurretBaseTargeting';
import {
  toLocalTurretFireSource, type AutomatedTurretId, type AutomatedTurret, type TurretFireSource, type TurretFireContext,
  type TurretPortalAssignment,
} from './TurretFireSource';
import { buildTurretPortalRoute, resolvePortalEntry } from './fireControl/FireControlPortalRoute';
import type { FireControlPortalFeedback } from './fireControl/FireControlRuntime';
import type { FireControlEntryMode } from './fireControl/FireControlSnapshot';

export {
  toLocalTurretFireSource, type AutomatedTurretId, type AutomatedTurretTargetMode,
  type AutomatedTurret, type TurretFireState, type TurretFireSource, type TurretFireContext,
} from './TurretFireSource';

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
type TurretProvider = () => readonly AutomatedTurret[];
type TurretFireSourceProvider = () => readonly TurretFireSource[];
type TurretAngleUpdater = (source: TurretFireSource, angle: number) => void;
type EnemyTargetProvider = () => readonly { id: string; x: number; y: number }[];
type FocusTargetProvider = (ownerId: string) => { targetType: 'enemy' | 'base'; targetId: string } | null;
type FocusedBaseTargetProvider = (targetId: string, turretX: number, turretY: number, range: number) => readonly TurretTargetPoint[];
/**
 * Erreichbare Außenflächen-Punkte feindlicher Basen, nach Distanz sortiert und begrenzt. Der
 * Provider entscheidet Besitz- und Modusberechtigung; Reichweite und Schusslinie prüft das TurretSystem.
 */
type BaseTargetCandidateProvider = (
  source: TurretFireSource, turretX: number, turretY: number, range: number,
) => readonly TurretTargetPoint[];
/**
 * Basisziele tragen ihren Trefferabschnitt: Drehbegrenzte Türme müssen ihn mit dem tatsächlichen
 * Rohrstrahl innerhalb ihrer Reichweite schneiden. Ziele ohne Abschnitt behalten die normale Toleranz.
 */
interface TurretAimTarget { readonly x: number; readonly y: number; readonly hitSegment?: TurretHitSegment }
interface TurretTargetPoint extends TurretAimTarget {
  readonly id: string;
  /** Live eligibility and geometry generation, without rebuilding/ranking surfaces. */
  readonly isValid?: () => boolean;
}
/** Distance along the ray (origin, unit direction) to the hit segment, or `null` if it misses. */
function rayDistanceToSegment(ox: number, oy: number, dx: number, dy: number, segment: TurretHitSegment): number | null {
  const sx = segment.x2 - segment.x1, sy = segment.y2 - segment.y1;
  const qx = segment.x1 - ox, qy = segment.y1 - oy;
  const cross = dx * sy - dy * sx;
  const epsilon = 1e-8;
  if (Math.abs(cross) <= epsilon) {
    // Parallel: Nur ein kollinearer Abschnitt (auch ein einzelner Punkt) kann getroffen werden.
    if (Math.abs(qx * dy - qy * dx) > epsilon) return null;
    const start = qx * dx + qy * dy, end = start + sx * dx + sy * dy;
    if (Math.max(start, end) < -epsilon) return null;
    return Math.max(0, Math.min(start, end));
  }
  const rayDistance = (qx * sy - qy * sx) / cross;
  const segmentFraction = (qx * dy - qy * dx) / cross;
  if (rayDistance < -epsilon || segmentFraction < -epsilon || segmentFraction > 1 + epsilon) return null;
  return Math.max(0, rayDistance);
}
const BASE_SEARCH_INTERVAL_MS = 225;
function baseSearchPhase(id: AutomatedTurretId): number {
  if (typeof id === 'number') return ((id - 1) * 97 % BASE_SEARCH_INTERVAL_MS + BASE_SEARCH_INTERVAL_MS) % BASE_SEARCH_INTERVAL_MS;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % BASE_SEARCH_INTERVAL_MS;
}
interface BaseSearchState {
  sequenceKey: AutomatedTurretId;
  nextSearchAt: number;
  searchDue: boolean;
  target: TurretTargetPoint | null;
  candidates: readonly TurretTargetPoint[];
}
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
  hitSegment?: TurretHitSegment;
  /** D35: a burst begun through a portal stays bound to its deployment, exit and bonus. */
  portal?: TurretPortalAssignment;
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
) => boolean | void; // false = no shot left the weapon; only confirmed shots count as transports

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
  private baseTargetCandidateProvider: BaseTargetCandidateProvider | null = null;
  private readonly baseDamageByWeapon = new Map<string, boolean>();
  /** A shared firing sequence can move between entries, but each pose owns its aim. */
  private readonly baseSearches = new Map<AutomatedTurretId, BaseSearchState>();
  private fireHandler: TurretFireHandler | null = null;
  private turretDamageBuffProvider: ((x: number, y: number) => TurretDamageBuff | null) | null = null;
  private turretDamageMultiplierProvider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null = null;
  /** Nach `sequenceKey`; überlebt Pausen und Wechsel zwischen Original und Kopie. */
  private nextFireAt = new Map<AutomatedTurretId, number>();
  /** Nach `sequenceKey`; `ownerEntryId` bindet die Salve an ihren Eintrag. */
  private pendingBursts = new Map<AutomatedTurretId, PendingTurretBurst>();
  private targetScore: ((turret: TurretFireSource, kind: 'player' | 'enemy' | 'base', id: string, now: number) => number) | null = null;
  private portalFeedback: FireControlPortalFeedback | null = null;
  /** Exit target search per source; separate from the local search state of the same pose. */
  private readonly portalBaseSearches = new Map<AutomatedTurretId, BaseSearchState>();
  /** GDD §4.3: line of fire exit → target, per deployment and tick, shared between sources. */
  private readonly exitLineOfFire = new Map<string, boolean>();

  /** Portal owner: receives mode/entry pose per participant and confirmed transports. */
  setPortalFeedback(feedback: FireControlPortalFeedback | null): void { this.portalFeedback = feedback; }

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

  /** Dritte Zielstufe: feindliche Basen, nur ohne Fokus- und Figurenziel. */
  setBaseTargetCandidateProvider(provider: BaseTargetCandidateProvider | null): void {
    this.baseTargetCandidateProvider = provider;
    this.baseSearches.clear();
  }

  setFireHandler(handler: TurretFireHandler | null): void {
    this.fireHandler = handler;
    if (!handler) {
      this.nextFireAt.clear();
      this.pendingBursts.clear();
      this.controlRevisions.clear();
      this.baseSearches.clear();
      this.portalBaseSearches.clear();
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

  /** Zusätzlicher Schadensmultiplikator; erhält die Identität und nur Originale aus der Quellenliste. */
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
    sources?: readonly TurretFireSource[],
  ): void {
    const turrets = sources ?? this.fireSourceProvider?.() ?? (this.turretProvider?.() ?? []).map(toLocalTurretFireSource);
    this.exitLineOfFire.clear();
    const entrySequences = new Map<AutomatedTurretId, AutomatedTurretId>();
    const activeSequences = new Set<AutomatedTurretId>();
    const activeIdentities = new Set<AutomatedTurretId>();
    const identities = new Map(turrets.filter(source => source.id === source.identityId).map(source => [source.id, source]));
    const constructions = [...identities.values()].filter(source => !source.projection);
    const identityOf = (source: TurretFireSource): AutomatedTurret | null => identities.get(source.identityId) ?? null;
    // Neue eigene Folgen übernehmen den Stand ihres Seeds vom Tick-Beginn, unabhängig davon, ob der
    // Seed in diesem Tick vor ihnen feuert. Eine laufende Seed-Salve muss erst ihren Cooldown
    // buchen (auch beim Abbruch); bis zum nächsten Tick bleibt die neue Folge vollständig inaktiv.
    for (const source of turrets) {
      if (source.sequenceSeedKey === undefined || this.nextFireAt.has(source.sequenceKey)) continue;
      if (this.pendingBursts.has(source.sequenceSeedKey)) continue;
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
      let baseSearch = this.baseSearches.get(turret.id);
      if (!baseSearch || baseSearch.sequenceKey !== sequenceKey) {
        baseSearch = { sequenceKey, nextSearchAt: now + baseSearchPhase(turret.id), searchDue: false, target: null, candidates: [] };
        this.baseSearches.set(turret.id, baseSearch);
      }
      baseSearch.searchDue = now >= baseSearch.nextSearchAt;
      if (baseSearch.searchDue) baseSearch.nextSearchAt = now + BASE_SEARCH_INTERVAL_MS;
      let portalSearch = turret.portal ? this.portalBaseSearches.get(turret.id) : undefined;
      if (turret.portal && (!portalSearch || portalSearch.sequenceKey !== sequenceKey)) {
        portalSearch = { sequenceKey, nextSearchAt: now, searchDue: true, target: null, candidates: [] };
        this.portalBaseSearches.set(turret.id, portalSearch);
      } else if (portalSearch) portalSearch.searchDue = baseSearch.searchDue;
      if (turret.sequenceSeedKey !== undefined && !this.nextFireAt.has(sequenceKey)) continue;

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
      const construction = !turret.projection && turret.id === turret.identityId;
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
      // Ein eingesponnener Turm ruht ganz: die eigene Salve endet, er zielt und feuert nicht, auch bemannt nicht.
      if (turret.fireState === 'disabled') {
        if (this.deleteOwnedBurst(turret)) {
          this.nextFireAt.set(sequenceKey, Math.max(this.nextFireAt.get(sequenceKey) ?? 0, now + cooldownMs));
        }
        continue;
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

      if (pendingBurst?.portal) {
        this.continuePortalBurst(turret, pendingBurst, pendingBurst.portal, now, deltaMs, paused, muzzleOffset, targetRange,
          turretWeaponId, turretWeaponConfig);
        continue;
      }
      const portal = manual ? undefined : turret.portal;
      if (pendingBurst) {
        // A burst begun locally stays local (§4.6), also when an exit target appears meanwhile.
        if (portal) this.reportPortalEntry(turret, portal, 'local', turret.angle ?? 0, muzzleOffset);
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
        if ((turret.rotationSpeedDegPerSec === undefined
          && !this.hasLineOfFireFromMuzzle(turret, turretX, turretY, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset))
          || !this.canFireAtAngle(turret, burstAngle, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset, targetRange, pendingBurst.hitSegment)) {
          // Aktive Einträge warten wie bisher; eine pausierte Restsalve darf die geteilte Folge
          // nicht festhalten. Ohne fälligen Schuss oder Fire-Handler erreichen wir diesen Pfad nicht.
          if (paused && this.deleteOwnedBurst(turret)) {
            this.nextFireAt.set(sequenceKey, Math.max(this.nextFireAt.get(sequenceKey) ?? 0, now + pendingBurst.cooldownMs));
          }
          continue;
        }
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

      if (portal) {
        // §4.6: the mode depends only on a target at the exit, never on readiness or rotation.
        const exitTarget = this.findNearestTarget(turret, portal.exitX, portal.exitY, targetRange, 0, now, undefined,
          { deploymentId: portal.deploymentId, state: portalSearch! });
        if (exitTarget) {
          this.firePortalShot(turret, identity, constructions, portal, exitTarget, now, deltaMs, muzzleOffset, targetRange,
            rangeFactor, cooldownMs, turretWeaponId, turretWeaponConfig, portalSearch!);
          continue;
        }
        this.reportPortalEntry(turret, portal, portal.localFireRelease ? 'local' : 'waiting', turret.angle ?? 0, muzzleOffset);
        if (!portal.localFireRelease) continue;
      }

      const target: TurretAimTarget | null = manualTarget ?? this.findNearestTarget(
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
      if (!this.canFireAtAngle(turret, angle, target.x, target.y, muzzleOffset, targetRange, target.hitSegment)) continue;
      // Relais übernehmen identitätsgebundene Boni des Originals; Holo-Projektionen nur ihren
      // eingefrorenen Injektoreffekt, unabhängig von Standort und Fernsteuerung.
      const buff = turret.projection
        ? turret.projection.injectorEffect?.type === 'damage_turret' ? turret.projection.injectorEffect : null
        : this.turretDamageBuffProvider?.(identity.x, identity.y) ?? null;
      const damageMultiplier = (buff?.damageMultiplier ?? 1)
        * (turret.damage === undefined ? 1 : turret.damage / turretWeaponConfig.damage)
        * (turret.projection ? 1 : Math.max(0, this.turretDamageMultiplierProvider?.(identity, constructions) ?? 1));

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
          hitSegment: target.hitSegment,
        });
      } else {
        this.nextFireAt.set(sequenceKey, now + cooldownMs);
      }
      if (burstCount <= 1 && (turret.secondProjectileDamageFactor ?? 0) > 0) {
        const secondTarget: TurretAimTarget | null = manualTarget ?? this.findNearestTarget(
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
          if (!this.canFireAtAngle(turret, secondAngle, secondTarget.x, secondTarget.y, muzzleOffset, targetRange, secondTarget.hitSegment)) continue;
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
    for (const id of this.baseSearches.keys()) {
      if (!entrySequences.has(id)) this.baseSearches.delete(id);
    }
    const participants = new Set(turrets.flatMap(source => source.portal ? [source.id] : []));
    for (const id of this.portalBaseSearches.keys()) {
      if (!participants.has(id)) this.portalBaseSearches.delete(id);
    }
  }

  /**
   * Portal shot (GDD V2 §4.4): target from the fixed exit, normal barrel rotation towards the exit
   * direction, entry in front of the real muzzle. The host fires only with a validly built route (E14).
   */
  private firePortalShot(
    turret: TurretFireSource, identity: AutomatedTurret, constructions: readonly AutomatedTurret[],
    portal: TurretPortalAssignment, target: TurretAimTarget, now: number, deltaMs: number,
    muzzleOffset: number, targetRange: number, rangeFactor: number, cooldownMs: number,
    weaponId: keyof typeof WEAPON_CONFIGS, weapon: WeaponConfig, search: BaseSearchState,
  ): void {
    const angle = this.updateAim(turret, Math.atan2(target.y - portal.exitY, target.x - portal.exitX), deltaMs);
    this.reportPortalEntry(turret, portal, 'portal', angle, muzzleOffset);
    const sequenceKey = turret.sequenceKey;
    if (now < (this.nextFireAt.get(sequenceKey) ?? 0) || !this.fireHandler) return;
    if (!this.canFireThroughPortal(turret, angle, portal, target, muzzleOffset, targetRange)) return;
    const route = this.buildRoute(turret, portal, angle, muzzleOffset, target, weapon, rangeFactor);
    if (!route) return;
    const buff = turret.projection
      ? turret.projection.injectorEffect?.type === 'damage_turret' ? turret.projection.injectorEffect : null
      : this.turretDamageBuffProvider?.(identity.x, identity.y) ?? null;
    const damageMultiplier = (buff?.damageMultiplier ?? 1)
      * (turret.damage === undefined ? 1 : turret.damage / weapon.damage)
      * (turret.projection ? 1 : Math.max(0, this.turretDamageMultiplierProvider?.(identity, constructions) ?? 1));
    this.firePortalRoute(turret, portal, weaponId, angle, muzzleOffset, route, damageMultiplier, rangeFactor, now);
    const burstCount = weapon.turretBurst ? Math.max(1, Math.floor(weapon.turretBurst.count)) : 1;
    if (burstCount > 1) {
      this.pendingBursts.set(sequenceKey, { ownerEntryId: turret.id, cooldownMs, shotsRemaining: burstCount - 1,
        nextShotAt: now + Math.max(1, weapon.turretBurst?.intervalMs ?? 1), targetX: target.x, targetY: target.y,
        damageMultiplier, rangeFactor, hitSegment: target.hitSegment, portal });
      return;
    }
    this.nextFireAt.set(sequenceKey, now + cooldownMs);
    if ((turret.secondProjectileDamageFactor ?? 0) <= 0) return;
    // §4.5: the second projectile uses the same route; its target is searched from the exit too.
    const second = this.findNearestTarget(turret, portal.exitX, portal.exitY, targetRange, 0, now, target,
      { deploymentId: portal.deploymentId, state: search });
    if (!second) return;
    const secondAngle = turret.rotationSpeedDegPerSec === undefined
      ? Math.atan2(second.y - portal.exitY, second.x - portal.exitX) : angle;
    if (!this.canFireThroughPortal(turret, secondAngle, portal, second, muzzleOffset, targetRange)) return;
    const secondRoute = this.buildRoute(turret, portal, secondAngle, muzzleOffset, second, weapon, rangeFactor);
    if (secondRoute) this.firePortalRoute(turret, portal, weaponId, secondAngle, muzzleOffset, secondRoute,
      (turret.secondProjectileDamageFactor ?? 0) * damageMultiplier, rangeFactor, now);
  }

  /** D35/D36/D12: bound portal bursts keep exit and bonus, follow the barrel and end with the deployment. */
  private continuePortalBurst(
    turret: TurretFireSource, burst: PendingTurretBurst, portal: TurretPortalAssignment, now: number, deltaMs: number,
    paused: boolean, muzzleOffset: number, targetRange: number,
    weaponId: keyof typeof WEAPON_CONFIGS, weapon: WeaponConfig,
  ): void {
    const live = now < portal.expiresAt && (this.portalFeedback?.isDeploymentActive(portal.deploymentId) ?? true)
      && (paused || turret.portal?.deploymentId === portal.deploymentId);
    const abort = () => {
      this.pendingBursts.delete(turret.sequenceKey);
      this.nextFireAt.set(turret.sequenceKey, Math.max(this.nextFireAt.get(turret.sequenceKey) ?? 0, now + burst.cooldownMs));
    };
    if (!live) { abort(); return; }
    const due = now >= burst.nextShotAt && !!this.fireHandler;
    const angle = turret.rotationSpeedDegPerSec === undefined && !due ? turret.angle ?? 0
      : this.updateAim(turret, Math.atan2(burst.targetY - portal.exitY, burst.targetX - portal.exitX), deltaMs);
    this.reportPortalEntry(turret, portal, 'portal', angle, muzzleOffset);
    if (!due) return;
    const target = { x: burst.targetX, y: burst.targetY, hitSegment: burst.hitSegment };
    const route = this.canFireThroughPortal(turret, angle, portal, target, muzzleOffset, targetRange)
      ? this.buildRoute(turret, portal, angle, muzzleOffset, target, weapon, burst.rangeFactor) : null;
    if (!route) {
      // As for local bursts: active entries wait, a paused remainder must not hold the shared sequence.
      if (paused) abort();
      return;
    }
    this.firePortalRoute(turret, portal, weaponId, angle, muzzleOffset, route, burst.damageMultiplier, burst.rangeFactor, now);
    burst.shotsRemaining -= 1;
    if (burst.shotsRemaining > 0) {
      burst.nextShotAt = now + Math.max(1, weapon.turretBurst?.intervalMs ?? 1);
    } else {
      this.pendingBursts.delete(turret.sequenceKey);
      this.nextFireAt.set(turret.sequenceKey, now + burst.cooldownMs);
    }
  }

  private buildRoute(
    turret: TurretFireSource, portal: TurretPortalAssignment, angle: number, muzzleOffset: number,
    target: TurretAimTarget, weapon: WeaponConfig, rangeFactor: number,
  ) {
    return buildTurretPortalRoute({ deploymentId: portal.deploymentId, sourceX: turret.x, sourceY: turret.y, angle,
      muzzleOffset, exitX: portal.exitX, exitY: portal.exitY, targetX: target.x, targetY: target.y,
      damageBonus: portal.damageBonus, effectiveRangePx: weapon.range * rangeFactor });
  }

  private firePortalRoute(
    turret: TurretFireSource, portal: TurretPortalAssignment, weaponId: keyof typeof WEAPON_CONFIGS, angle: number,
    muzzleOffset: number, route: NonNullable<TurretFireContext['route']>, damageFactor: number, rangeFactor: number, now: number,
  ): void {
    const pose = resolvePortalEntry(turret.x, turret.y, angle, muzzleOffset);
    const fired = this.fireHandler?.(turret.ownerId, turret.ownerColor, weaponId, pose.muzzleX, pose.muzzleY, angle,
      route.rangeTargetX, route.rangeTargetY, damageFactor, rangeFactor, turret.identityId, turret.skipRockIndex,
      turret.sourceCarrierBaseId, { source: turret, route });
    if (fired !== false) this.portalFeedback?.noteTransport(portal.deploymentId, turret.id, now);
  }

  private reportPortalEntry(
    turret: TurretFireSource, portal: TurretPortalAssignment, mode: FireControlEntryMode, angle: number, muzzleOffset: number,
  ): void {
    const pose = resolvePortalEntry(turret.x, turret.y, angle, muzzleOffset);
    this.portalFeedback?.reportEntry(portal.deploymentId, turret.id, turret.identityId, mode, pose.entryX, pose.entryY, angle);
  }

  /**
   * Both real sections must be free (§4.3): muzzle → entry with the source's own exceptions,
   * exit → target without any. Base faces require the actual exit ray to cross their hit segment
   * within the source range measured from the exit. Applies to legacy sources without rotation limit too.
   */
  private canFireThroughPortal(
    turret: AutomatedTurret, angle: number, portal: TurretPortalAssignment, target: TurretAimTarget,
    muzzleOffset: number, targetRange: number,
  ): boolean {
    const desired = Math.atan2(target.y - portal.exitY, target.x - portal.exitX);
    if (turret.rotationSpeedDegPerSec !== undefined) {
      const tolerance = (turret.aimToleranceDeg ?? DEFAULT_TURRET_AIM_TOLERANCE_DEG) * Math.PI / 180;
      if (Math.abs(turretAngleDifference(angle, desired)) > tolerance + 1e-10) return false;
    }
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let distance = Math.hypot(target.x - portal.exitX, target.y - portal.exitY);
    if (target.hitSegment) {
      const ray = rayDistanceToSegment(portal.exitX, portal.exitY, dx, dy, target.hitSegment);
      if (ray === null || ray > targetRange + 1e-8) return false;
      distance = ray;
    }
    if (!this.lineOfFireChecker) return true;
    const pose = resolvePortalEntry(turret.x, turret.y, angle, muzzleOffset);
    if (!this.lineOfFireChecker(pose.muzzleX, pose.muzzleY, pose.entryX, pose.entryY,
      turret.skipRockIndex, turret.sourceCarrierBaseId)) return false;
    return this.hasExitLineOfFire(portal.deploymentId, portal.exitX, portal.exitY,
      portal.exitX + dx * distance, portal.exitY + dy * distance);
  }

  private hasExitLineOfFire(deploymentId: number, exitX: number, exitY: number, x: number, y: number): boolean {
    if (!this.lineOfFireChecker) return true;
    const key = `${deploymentId}:${Math.round(x)}:${Math.round(y)}`;
    let free = this.exitLineOfFire.get(key);
    if (free === undefined) {
      free = this.lineOfFireChecker(exitX, exitY, x, y);
      this.exitLineOfFire.set(key, free);
    }
    return free;
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

  private canFireAtAngle(
    turret: AutomatedTurret, angle: number, targetX: number, targetY: number, muzzleOffset: number,
    targetRange: number, hitSegment?: TurretHitSegment,
  ): boolean {
    if (turret.rotationSpeedDegPerSec === undefined) return true;
    const desiredAngle = Math.atan2(targetY - turret.y, targetX - turret.x);
    const tolerance = (turret.aimToleranceDeg ?? DEFAULT_TURRET_AIM_TOLERANCE_DEG) * Math.PI / 180;
    if (Math.abs(turretAngleDifference(angle, desiredAngle)) > tolerance + 1e-10) return false;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const muzzleX = turret.x + dx * muzzleOffset, muzzleY = turret.y + dy * muzzleOffset;
    let distance = Math.max(muzzleOffset, Math.hypot(targetX - turret.x, targetY - turret.y));
    if (hitSegment) {
      const rayDistance = rayDistanceToSegment(muzzleX, muzzleY, dx, dy, hitSegment);
      if (rayDistance === null) return false;
      // Zielreichweite wird wie bei der Zielwahl ab Turmmitte gemessen, nicht erneut ab Mündung.
      distance = muzzleOffset + rayDistance;
      if (distance > targetRange + 1e-8) return false;
    }
    if (!this.lineOfFireChecker) return true;
    return this.lineOfFireChecker(
      muzzleX, muzzleY,
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
    /** Search from a portal exit: own line-of-fire context without the source's exceptions (§4.3). */
    exit?: { readonly deploymentId: number; readonly state: BaseSearchState },
  ): TurretAimTarget | null {
    let bestTarget: TurretAimTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestKey = '';
    const focus = this.focusTargetProvider?.(turret.ownerId) ?? null;

    const consider = (candidate: TurretAimTarget & { readonly isValid?: () => boolean }, priority: number, kind: 'player' | 'enemy' | 'base', id: string): boolean => {
      if (candidate.isValid?.() === false) return false;
      const distance = Phaser.Math.Distance.Between(turretX, turretY, candidate.x, candidate.y);
      if (distance > range) return false;
      const score = this.targetScore?.(turret, kind, id, now) ?? 0;
      const key = kind + ':' + id;
      if (priority > bestPriority || (priority === bestPriority && (score < bestScore
        || (score === bestScore && (distance > bestDistance || (distance === bestDistance && key >= bestKey)))))) return false;
      // Only a candidate that would win pays for the sight-line raycast; the selection is unchanged.
      if (exit ? !this.hasExitLineOfFire(exit.deploymentId, turretX, turretY, candidate.x, candidate.y)
        : !this.hasLineOfFireFromMuzzle(turret, turretX, turretY, candidate.x, candidate.y, lineOfFireStartOffset)) return false;
      bestPriority = priority;
      bestScore = score;
      bestKey = key;
      bestDistance = distance;
      bestTarget = candidate;
      return true;
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

    const rangeSq = range * range;
    if (turret.targetMode !== 'players') for (const enemy of this.enemyTargetProvider?.() ?? []) {
      if (excluded && enemy.x === excluded.x && enemy.y === excluded.y) continue;
      // Cheap range rejection before the combat queries; `consider` keeps the exact check.
      const dx = enemy.x - turretX, dy = enemy.y - turretY;
      if (dx * dx + dy * dy > rangeSq * 1.0001 + 1) continue;
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, enemy.id)) continue;

      consider(
        { x: enemy.x, y: enemy.y },
        focus?.targetType === 'enemy' && focus.targetId === enemy.id ? 0 : 1,
        'enemy', enemy.id,
      );
    }

    // Türme ohne Wirkung gegen Basen (Kontrolltürme) schießen nie auf Basen, auch nicht im Fokus.
    const canDamageBases = this.canDamageBases(turret);
    if (focus?.targetType === 'base' && canDamageBases) {
      for (const base of this.focusedBaseTargetProvider?.(focus.targetId, turretX, turretY, range) ?? []) {
        if (excluded && base.x === excluded.x && base.y === excluded.y) continue;
        if (consider(base, 0, 'base', base.id)) break;
      }
    }

    const state = exit?.state ?? this.baseSearches.get(turret.id)!;
    if (bestTarget !== null || !canDamageBases) {
      if (!excluded) state.target = null;
      return bestTarget;
    }
    if (this.baseTargetCandidateProvider) {
      if (state.target) {
        const held = state.target;
        if (!excluded || held.x !== excluded.x || held.y !== excluded.y) {
          if (consider(held, 2, 'base', held.id)) return held;
          state.target = null;
        }
      }
      if (state.searchDue) {
        state.searchDue = false;
        state.candidates = this.baseTargetCandidateProvider(turret, turretX, turretY, range);
      } else if (!excluded) return null;
      // Kandidaten kommen nach Distanz sortiert: Die erste frei beschießbare Fläche ist die nächste.
      for (const base of state.candidates) {
        if (excluded && base.x === excluded.x && base.y === excluded.y) continue;
        if (consider(base, 2, 'base', base.id)) {
          if (!excluded) state.target = base;
          break;
        }
      }
    }

    return bestTarget;
  }

  private canDamageBases(turret: AutomatedTurret): boolean {
    const weaponId = turret.weaponId ?? 'SPORES';
    let result = this.baseDamageByWeapon.get(weaponId);
    if (result === undefined) {
      const weapon = WEAPON_CONFIGS[weaponId];
      result = !!weapon && canWeaponDamageBases(weapon);
      this.baseDamageByWeapon.set(weaponId, result);
    }
    return result;
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
