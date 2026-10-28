import type { WorldHealthBarRenderer, HealthBarHandle } from '../effects/health/WorldHealthBarRenderer';
import { EMPTY_ENEMY_CLAW_STATE, isEnemyClawState, type EnemyClawState } from '../systems/EnemyClawAttack';
import { syncEnemyClawAnimation } from '../animations/EnemyClawAnimation';
import { stepTurnRateFacing } from './turnRateFacing';
import { syncEnemyShieldChargeAnimation } from '../animations/EnemyShieldChargeAnimation';
import { airborneLift } from '../animations/leapPresentation';
import { syncEnemyEnergyConeAnimation } from '../animations/EnemyEnergyConeAnimation';
import { EMPTY_SHIELD_CHARGE_STATE, isShieldChargeState, type ShieldChargeState } from '../systems/ShieldChargeState';
import { EMPTY_ENERGY_CONE_STATE, isEnergyConeState, type EnergyConeState } from '../systems/EnergyConeState';
import { EMPTY_ENEMY_HOP_STATE, enemyHopAirProgress, enemyHopPhaseAt, isEnemyHopState, type EnemyHopState } from '../systems/EnemyHopState';
import { syncEnemyHopAnimation } from '../animations/EnemyHopAnimation';
import { syncEnemyKaboomtulaAnimation } from '../animations/EnemyKaboomtulaAnimation';
import { syncEnemyPounceAnimation } from '../animations/EnemyPounceAnimation';
import { EMPTY_ENEMY_POUNCE_STATE, enemyPounceAirProgress, enemyPouncePhaseAt, isEnemyPounceState,
  type EnemyPounceState } from '../systems/EnemyPounceState';
import { EMPTY_KABOOMTULA_STATE, isKaboomtulaState, kaboomtulaLeapProgress, kaboomtulaPhaseProgress,
  type KaboomtulaState } from '../systems/KaboomtulaState';
import { EMPTY_ENEMY_HEAT_BURST_STATE, isEnemyHeatBurstState, type EnemyHeatBurstState } from '../systems/EnemyHeatBurstState';
import { heatSpeedFactorAt } from '../systems/enemyHeatBurstRules';
import { EnemyCastPlayback, syncEnemyCastAnimation } from '../animations/EnemyCastAnimation';
import { getEnemyFootprintVariant } from '../config/movementEffects';
import type { MovementVisualSample } from '../effects/MovementStepSampler';
import { alliedEnemyHealthBarStyle, enemyHealthBarStyle } from '../effects/health/healthBarStyles';
import { addPlayerGlow } from '../effects/PlayerGlow';
import { addExternalGlow, removeExternalFx, removeInternalFx, type GlowHandle } from '../utils/phaserFx';
import { resolveAlliedEnemyWeaponConfig } from '../systems/AlliedEnemyEffects';
import type { DawnEliteAffixId } from '../dawn/contracts/DawnContentIds';
import { dawnEliteSpeedMultiplier } from '../systems/DawnEliteRules';
import { ELITE_VISUAL_SCALE } from '../effects/dawn/EliteMarkerModel';
import * as Phaser from 'phaser';
import { GenericWeapon } from '../loadout/GenericWeapon';
import { WEAPON_CONFIGS, type WeaponConfig } from '../loadout/LoadoutConfig';
import { isVelocityMoving } from '../loadout/SpreadMath';
import type { BaseWeapon } from '../loadout/BaseWeapon';
import {
  ALLIED_COLOR,
  ALLIED_PALETTE,
  COLORS,
  DEPTH,
  HP_BAR_OFFSET_Y,
  HP_BAR_WIDTH,
  PLAYER_SIZE,
  VOID_FIRE_COLOR,
} from '../config';
import {
  DEFAULT_ENEMY_KNOCKBACK_FACTOR,
  type CoopDefenseEnemyKind,
  type CoopDefenseEnemyWeaponSalvoConfig,
  type CoopDefenseEnemyWeaponTargetMode,
  type ResolvedCoopDefenseEnemyConfig,
} from '../config/coopDefenseEnemies';
import type { GroundFireVisualStyle, SyncedEnemyState } from '../types';
import { EntityBurnRenderer, MAX_VISUAL_BURN_STACKS } from '../effects/EntityBurnRenderer';
import type { EntityStatusVisualTarget } from '../effects/SmokeBodyEffect';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import { PlasmaChargeRenderer, MAX_PLASMA_CHARGE_STACKS } from '../effects/PlasmaChargeRenderer';
import type { LightingSystem } from '../effects/LightingSystem';
import { fillRadialGradientTexture, makeAdditive, registerGraphicsObject } from '../effects/EffectUtils';
import { emissiveAlpha } from '../effects/EmissiveScale';
import { getEnemyName } from '../i18n/contentPresentation';
import { getLocale } from '../i18n';
import { DAWN_M3_ASSET_KEYS } from '../dawn/contracts/DawnContentIds';
import { DAWN_SCAVENGER_KIND } from '../dawn/runtime/DawnScavengerPort';
import {
  getWalkingSheetForStaticTexture,
  syncBadgerWalkingAnimation,
  WALKING_IDLE_FRAME,
  type WalkingSheet,
} from '../animations/BadgerAnimations';

const TEX_ENEMY_GLOW = '_enemy_glow';
/** Halo-Atmen: volle Periode (früher 900 ms Yoyo), Größen- und Dimmhub. */
const GLOW_BREATH_PERIOD_MS = 1800;
const GLOW_BREATH_SCALE = 0.12;
const GLOW_BREATH_DIM = 0.28;
/**
 * Restabstand der Client-Interpolation, ab dem ein Gegner als laufend gilt. Clients erhalten
 * keine Bewegungsflagge; der offene Weg zur Zielposition ist ihr einziges Bewegungssignal. Bei
 * 20 Hz Snapshots und `NET_SMOOTH_TIME_MS` liegt der Abstand einer laufenden Figur um
 * Groessenordnungen darueber, waehrend er im Stand gegen null faellt.
 */
const WALKING_INTERPOLATION_EPSILON_PX = 0.5;
/** Apex growth of a charger leap towards the camera. */
const LEAP_LIFT_AMPLITUDE = 0.32;
/** Apex growth of a toad hop: short, low hops read lighter than the brood's pounce. */
const HOP_LIFT_AMPLITUDE = 0.24;
/** Apex growth of a pounce: the long attack jump rises highest. */
const POUNCE_LIFT_AMPLITUDE = 0.36;

export type EnemyFaction = 'hostile' | 'allied';

export interface EnemyAttackWeapon {
  readonly weapon: BaseWeapon;
  readonly targetMode: CoopDefenseEnemyWeaponTargetMode;
  readonly minimumFireDurationMs: number;
  readonly meleeTiming?: import('../systems/EnemyClawAttack').EnemyMeleeTiming;
  /** 0 = Gegner bleibt waehrend der Angriffspause stehen, 1 = er laeuft ungebremst weiter. */
  readonly attackMovementSpeedFactor: number;
  readonly minTargetDistancePx: number;
  readonly salvo?: CoopDefenseEnemyWeaponSalvoConfig;
  /** Visual muzzle ahead of the centre along the aim (0 = the centre). */
  readonly muzzleForwardPx: number;
}

export class EnemyEntity {
  private krakenMovement: import('../systems/KrakenState').KrakenState['movement'] | null = null;
  private krakenDestination: { readonly x: number; readonly y: number } | null = null;
  private krakenTargetability: import('../systems/KrakenState').KrakenState['bodyTargetability'] | null = null;
  private areaClaw: import('../systems/EnemyClawAttack').EnemyAreaClawState = { revision: 0, attack: null };

  isBodyTargetable(): boolean { return !this.krakenTargetability || this.krakenTargetability.mode === 'exposed'; }
  suppressBodyDotTicks(): boolean { return !!this.config.krakenBoss && !this.isBodyTargetable(); }
  countsForEncounter(): boolean { return !this.config.krakenEgg; }
  isKrakenEgg(): boolean { return !!this.config.krakenEgg; }
  retireKrakenEgg(now: number): void {
    if (this.config.krakenEgg) this.setKrakenBodyTargetability({ revision: (this.krakenTargetability?.revision ?? 0) + 1,
      effectiveAt: now, mode: 'protected' });
  }
  isOrdinaryMovementEnabled(): boolean { return !this.stationary && (!this.krakenMovement || this.krakenMovement === 'land'); }
  /** Water/exit positions are validated by the habitat owner; ordinary water separation must not move them. */
  usesLandWaterCollision(): boolean { return !this.config.amphibious && (!this.krakenMovement || this.krakenMovement === 'land'); }
  isAmphibious(): boolean { return !!this.config.amphibious; }
  isSubmerged(): boolean { return this.submerged; }
  /** Under water an amphibious enemy is hidden and untargetable like a burrowed one (no dirt). True on change. */
  setSubmerged(submerged: boolean): boolean {
    if (this.submerged === submerged) return false;
    this.submerged = submerged;
    this.applyHiddenState();
    return true;
  }
  isKrakenLandBody(): boolean { return !!this.config.krakenBoss && this.krakenMovement === 'land'; }
  setKrakenBodyTargetability(state: import('../systems/KrakenState').KrakenState['bodyTargetability']): void {
    if (this.krakenTargetability && state.revision <= this.krakenTargetability.revision) return;
    this.krakenTargetability = { ...state };
  }
  setKrakenMovement(mode: import('../systems/KrakenState').KrakenState['movement'], destination: { readonly x: number; readonly y: number } | null): void {
    this.krakenMovement = mode; this.krakenDestination = destination;
    this.setStationary(mode !== 'land');
  }
  /** Destination is the prevalidated next host position, never an unchecked teleport target. */
  applyKrakenMovement(): void {
    const point = this.krakenDestination; this.krakenDestination = null;
    if (point && (this.krakenMovement === 'water-approach' || this.krakenMovement === 'ashore')) {
      this.setStationary(false); this.setPosition(point.x, point.y); this.setStationary(true);
    }
  }
  getAreaClawState(): import('../systems/EnemyClawAttack').EnemyAreaClawState { return this.areaClaw; }
  applyAreaClawState(state: import('../systems/EnemyClawAttack').EnemyAreaClawState): void {
    if (state.revision > this.areaClaw.revision) this.areaClaw = structuredClone(state);
  }
  // Bild zeigt nach Norden – Offset um Aim-Angle (0 = rechts) korrekt darzustellen.
  private static readonly ROTATION_OFFSET = Math.PI / 2;

  readonly id: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly kind: CoopDefenseEnemyKind;
  readonly faction: EnemyFaction;
  readonly ownerId?: string;
  readonly ownerColor?: number;
  /** Host-only provenance used to keep encounter follow-up spawns in the same clear scope. */
  readonly originId?: string;

  private readonly authoritative: boolean;
  private stationary = false;
  private readonly config: ResolvedCoopDefenseEnemyConfig;
  private readonly attackWeapons: readonly EnemyAttackWeapon[];
  private healthBars: WorldHealthBarRenderer | null = null;
  private healthBar: HealthBarHandle | null = null;
  private glowHalo: Phaser.GameObjects.Image | null = null;
  private glowBreathOrigin = 0;
  private voidMolotovWindupRing: Phaser.GameObjects.Arc | null = null;
  private maxHp = 1;
  private currentHp = 0;
  private targetX: number;
  private targetY: number;
  private desiredVelocityX = 0;
  private desiredVelocityY = 0;
  private attackPauseUntil = 0;
  private attackPauseSpeedFactor = 0;
  /** Waffen-ID → Zeitpunkt, ab dem die Waffe zusaetzlich zu ihrem Cooldown wieder frei ist. */
  private readonly weaponLockouts = new Map<string, number>();
  private nextAttackScanAt = 0;
  private currentAimAngle = 0;
  private targetAimAngle = 0;
  /** Presentation only: ordinary host locomotion may turn more calmly than its gameplay aim. */
  private visualAimAngle = 0;
  private smoothMovementFacing = false;
  private burnRenderer: EntityBurnRenderer | null = null;
  private burnGpu: EntityBurnGpuController | null = null;
  private plasmaChargeRenderer: PlasmaChargeRenderer | null = null;
  private vulnerable = false;
  private ownerRing: Phaser.GameObjects.Arc | null = null;
  /** Leuchtumriss verbündeter Gegner – dieselbe Silhouetten-Glow-Sprache wie Spieler und eigene Türme. */
  private allyGlow: GlowHandle | null = null;
  /** Void silhouette glow of a hunting Kabummtula: its danger signal, there is no marker. */
  private kaboomtulaAura: GlowHandle | null = null;
  private burnStacks = 0;
  private plasmaChargeStacks = 0;
  private burnVisualStyle: GroundFireVisualStyle = 'normal';
  /** Für die an dieser Entity hängenden Lichtquellen (aktuell: Brand). */
  private lighting: LightingSystem | null = null;
  private moveSpeedMultiplier = 1;
  private abilitySpeedFactor = 1;
  private burrowed = false;
  private submerged = false;
  private dashPhase: 0 | 1 | 2 = 0;
  private pathBlocked = false;
  private specialAction: SyncedEnemyState['specialAction'] = 'none';
  private specialActionEndsAt = 0;
  private gaussChargeProgress = 0;
  private gaussAimAngle = 0;
  /** Walking-Sheet dieser Gegnerart, oder `null` fuer eine statische Darstellung. */
  private readonly walkingSheet: WalkingSheet | null;
  private walkingRequested = false;
  private clawState: EnemyClawState = EMPTY_ENEMY_CLAW_STATE;
  private clawAnimating = false;
  private shieldCharge: ShieldChargeState = EMPTY_SHIELD_CHARGE_STATE;
  private energyCone: EnergyConeState = EMPTY_ENERGY_CONE_STATE;
  private knockbackImmune = false;
  /** Host clock of the last rate-limited turn step; null until the first step. */
  private turnClockMs: number | null = null;
  /** Facing requested by other systems while the turn rate owns the body. */
  private requestedHeading: number | null = null;

  getShieldChargeState(): ShieldChargeState { return this.shieldCharge; }

  /** Host: publish a new charge state (revision must grow). Clients: apply a newer replicated state. */
  applyShieldChargeState(state: ShieldChargeState): void {
    if (!isShieldChargeState(state) || state.revision <= this.shieldCharge.revision) return;
    this.shieldCharge = state;
  }

  private hopState: EnemyHopState = EMPTY_ENEMY_HOP_STATE;

  getHopState(): EnemyHopState { return this.hopState; }

  /** Host: publish a new hop state (revision must grow). Clients: apply a newer replicated state. */
  applyHopState(state: EnemyHopState): void {
    if (!isEnemyHopState(state) || state.revision <= this.hopState.revision) return;
    this.hopState = state;
  }

  private hopAnimating = false;
  private hopAirborne = false;

  /**
   * Hop presentation from the replicated timeline: clients place the body on its flight line
   * (the network lerp would smear a fast hop), host and clients lift it and play the hop clips.
   */
  syncHopPresentation(now: number): void {
    if (!this.config.hop) return;
    const state = this.hopState, jump = state.jump;
    const airborne = !!jump && enemyHopPhaseAt(state, now) === 'air';
    const progress = airborne ? enemyHopAirProgress(jump, now) : 0;
    if (airborne) this.placeOnFlightLine(jump.originX, jump.originY, jump.targetX, jump.targetY, progress);
    this.hopAirborne = airborne;
    this.setAirLiftScale(1 + HOP_LIFT_AMPLITUDE * airborneLift(progress), false);
    const wasAnimating = this.hopAnimating;
    this.hopAnimating = syncEnemyHopAnimation(this.sprite, this.config.imageKey, state, now,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.hopAnimating) this.syncWalkingAnimation();
  }

  /** Clients place an airborne body on its replicated flight line; the network lerp would smear a fast flight. */
  private placeOnFlightLine(originX: number, originY: number, targetX: number, targetY: number, progress: number): void {
    if (this.authoritative) return;
    this.sprite.x = Phaser.Math.Linear(originX, targetX, progress);
    this.sprite.y = Phaser.Math.Linear(originY, targetY, progress);
  }

  private pounceState: EnemyPounceState = EMPTY_ENEMY_POUNCE_STATE;
  private pounceAnimating = false;
  private pounceAirborne = false;

  getPounceState(): EnemyPounceState { return this.pounceState; }

  /** Host: publish a new pounce state (revision must grow). Clients: apply a newer replicated state. */
  applyPounceState(state: EnemyPounceState): void {
    if (!isEnemyPounceState(state) || state.revision <= this.pounceState.revision) return;
    this.pounceState = state;
  }

  /**
   * Pounce presentation from the replicated timeline: clients place a flying body on its locked
   * flight line, host and clients lift it and play the windup and leap clips.
   */
  syncPouncePresentation(now: number): void {
    if (!this.config.pounce) return;
    const state = this.pounceState, pounce = state.pounce, landing = pounce?.landing;
    const airborne = !!landing && enemyPouncePhaseAt(state, now) === 'air';
    const progress = airborne ? enemyPounceAirProgress(landing, now) : 0;
    if (airborne) this.placeOnFlightLine(pounce!.originX, pounce!.originY, landing.x, landing.y, progress);
    this.pounceAirborne = airborne;
    this.setAirLiftScale(1 + POUNCE_LIFT_AMPLITUDE * airborneLift(progress), false);
    const wasAnimating = this.pounceAnimating;
    this.pounceAnimating = syncEnemyPounceAnimation(this.sprite, this.config.imageKey, state, now,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.pounceAnimating) this.syncWalkingAnimation();
  }

  private heatBurstState: EnemyHeatBurstState = EMPTY_ENEMY_HEAT_BURST_STATE;

  getHeatBurstState(): EnemyHeatBurstState { return this.heatBurstState; }

  /** Host: publish a new heat cycle (revision must grow). Clients: apply a newer replicated state. */
  applyHeatBurstState(state: EnemyHeatBurstState): void {
    if (!isEnemyHeatBurstState(state) || state.revision <= this.heatBurstState.revision) return;
    this.heatBurstState = state;
  }

  /**
   * Host and clients: the gait keeps pace with the heat ramp, so faster bodies also step faster. Only
   * this sprite's move-loop frame duration changes; no clock is scaled.
   */
  syncHeatBurstPresentation(now: number): void {
    const config = this.config.heatBurst, sheet = this.walkingSheet;
    if (!config || !sheet || this.sprite.anims.currentAnim?.key !== sheet.animationKey) return;
    this.sprite.anims.msPerFrame = 1000 / (sheet.frameRate * heatSpeedFactorAt(this.heatBurstState, config, now));
  }

  private kaboomtulaState: KaboomtulaState = EMPTY_KABOOMTULA_STATE;
  private kaboomtulaAnimating = false;
  private kaboomtulaAirborne = false;

  getKaboomtulaState(): KaboomtulaState { return this.kaboomtulaState; }

  /** Host: publish a new spider state (revision must grow). Clients: apply a newer replicated state. */
  applyKaboomtulaState(state: KaboomtulaState): void {
    if (!isKaboomtulaState(state) || state.revision <= this.kaboomtulaState.revision) return;
    this.kaboomtulaState = state;
  }

  /**
   * Spider presentation from the replicated timeline: clients place a leaping body on its locked
   * flight line (the network lerp would smear the short flight), host and clients lift it and play
   * the alert, leap and spit clips.
   */
  syncKaboomtulaPresentation(now: number): void {
    if (!this.config.kaboomtula) return;
    const state = this.kaboomtulaState, leap = state.phase === 'leap' ? state.leap : null;
    const airborne = !!leap && now >= leap.takeoffAt && now < leap.landAt;
    const progress = airborne ? kaboomtulaLeapProgress(leap, now) : 0;
    if (airborne && !this.authoritative) {
      this.sprite.x = Phaser.Math.Linear(leap.originX, leap.endX, progress);
      this.sprite.y = Phaser.Math.Linear(leap.originY, leap.endY, progress);
    }
    this.kaboomtulaAirborne = airborne;
    this.setAirLiftScale(1 + LEAP_LIFT_AMPLITUDE * airborneLift(progress), false);
    const wasAnimating = this.kaboomtulaAnimating;
    this.kaboomtulaAnimating = syncEnemyKaboomtulaAnimation(this.sprite, this.config.imageKey, state, now,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.kaboomtulaAnimating) this.syncWalkingAnimation();
  }

  getEnergyConeState(): EnergyConeState { return this.energyCone; }

  /** Host: publish a new cone state (revision must grow). Clients: apply a newer replicated state. */
  applyEnergyConeState(state: EnergyConeState): void {
    if (!isEnergyConeState(state) || state.revision <= this.energyCone.revision) return;
    this.energyCone = state;
  }

  /** While set, external impulses (knockback, recoil, stagger scaling) do not move this enemy. */
  setKnockbackImmune(immune: boolean): void { this.knockbackImmune = immune; }

  /** Authoritative turn rate in rad/ms, or null for ordinary instant facing. */
  private turnRateRadPerMs(): number | null {
    const rate = this.config.turnRateDegPerSec;
    return rate !== undefined && rate > 0 ? rate * Math.PI / 180 / 1000 : null;
  }

  /**
   * Rate-limited facing: turn toward `heading` by at most rate × elapsed host time and return the
   * locomotion factor for moving along `heading` with the current facing (slow while turned away).
   */
  private stepLimitedTurn(heading: number | null, now: number, rate: number): number {
    const elapsed = this.turnClockMs === null ? 0 : Phaser.Math.Clamp(now - this.turnClockMs, 0, 100);
    this.turnClockMs = now;
    const turn = stepTurnRateFacing(this.currentAimAngle, heading, rate, elapsed);
    if (heading !== null) this.setBodyFacing(turn.angle);
    return turn.locomotion;
  }

  private setBodyFacing(angle: number): void {
    const wrapped = Phaser.Math.Angle.Wrap(angle);
    this.currentAimAngle = this.targetAimAngle = this.visualAimAngle = wrapped;
    this.smoothMovementFacing = false;
    this.sprite.setRotation(wrapped + this.getSpriteRotationOffset());
  }
  private readonly castPlayback = new EnemyCastPlayback();
  private castAnimating = false;

  /** New orb presentation, from host spawn or a new replicated projectile ID. */
  playFirestarterCast(now: number): void {
    if (!this.config.firestarter) return;
    this.castPlayback.orb(now);
    this.syncCastAnimation(now);
  }

  private shieldChargeAnimating = false;

  /** A leaping body rises towards the camera mid-run (pure presentation of the replicated lane). */
  private syncLeapLift(now: number): void {
    const lane = this.shieldCharge.lane;
    const lift = this.config.shieldCharger?.style === 'leap' && this.shieldCharge.phase === 'run' && lane
      ? airborneLift((now - lane.runAt) / Math.max(1, lane.runEndsAt - lane.runAt)) : 0;
    this.setAirLiftScale(1 + LEAP_LIFT_AMPLITUDE * lift);
  }

  /** Charge clips follow the replicated host-fixed charge timeline (windup, run, recover). */
  syncShieldChargeAnimation(now: number): void {
    if (!this.config.shieldCharger) return;
    this.syncLeapLift(now);
    const wasAnimating = this.shieldChargeAnimating;
    this.shieldChargeAnimating = syncEnemyShieldChargeAnimation(this.sprite, this.config.imageKey, this.shieldCharge, now,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.shieldChargeAnimating) this.syncWalkingAnimation();
  }

  private energyConeAnimating = false;

  /** Cone pose follows the replicated host-fixed cone timeline (wind-up, strike at the impulse). */
  syncEnergyConeAnimation(now: number): void {
    if (!this.config.energyCone) return;
    const wasAnimating = this.energyConeAnimating;
    this.energyConeAnimating = syncEnemyEnergyConeAnimation(this.sprite, this.config.imageKey, this.energyCone, now,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.energyConeAnimating) this.syncWalkingAnimation();
  }

  syncCastAnimation(now = this.sprite.scene.time.now): void {
    const firestarter = this.config.firestarter;
    if (!firestarter) return;
    const wasAnimating = this.castAnimating;
    this.castAnimating = syncEnemyCastAnimation(this.sprite, this.config.imageKey, this.castPlayback,
      this.specialAction, this.gaussChargeProgress, now, firestarter.lance.telegraphMs, firestarter.lance.commitMs,
      this.clawAnimating || !this.sprite.visible || this.burrowed || this.currentHp <= 0);
    if (wasAnimating && !this.castAnimating) this.syncWalkingAnimation();
  }

  getClawAttackState(): EnemyClawState { return this.clawState; }

  applyClawAttackState(state: EnemyClawState): void {
    if (!isEnemyClawState(state) || state.revision <= this.clawState.revision) return;
    this.clawState = state;
    this.clawAnimating = state.attack !== null;
    if (!this.clawAnimating) this.syncWalkingAnimation();
  }

  syncClawAnimation(now: number): void {
    const attack = this.clawState.attack;
    const wasAnimating = this.clawAnimating;
    this.clawAnimating = !!attack && now < attack.endsAt && this.sprite.visible && !this.burrowed && this.currentHp > 0;
    if (this.clawAnimating && attack) {
      this.faceAngle(attack.angle);
      syncEnemyClawAnimation(this.sprite, this.config.imageKey, attack, now);
    } else if (wasAnimating) this.syncWalkingAnimation();
  }
  private movementRevision = 0;
  /** Decaying teleport offset, separate from the normal interpolation lag while walking. */
  private movementCorrectionRemaining = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    x: number,
    y: number,
    authoritative: boolean,
    kind: CoopDefenseEnemyKind,
    config: ResolvedCoopDefenseEnemyConfig,
    faction: EnemyFaction = 'hostile',
    ownerId?: string,
    ownerColor?: number,
    originId?: string,
    readonly eliteAffixId?: DawnEliteAffixId,
  ) {
    this.id = id;
    this.kind = kind;
    this.faction = faction;
    this.ownerId = ownerId;
    this.ownerColor = ownerColor;
    this.originId = originId;
    this.authoritative = authoritative;
    this.config = config;
    this.attackWeapons = authoritative ? this.createWeapons() : [];
    this.maxHp = this.config.maxHp;
    this.currentHp = this.maxHp;
    this.targetX = x;
    this.targetY = y;

    // Animierte Gegnerarten zeigen im Stand Frame 0 ihres Walking-Sheets; er ist deckungsgleich
    // mit der statischen Einzeltextur, die Darstellung aendert sich dadurch nicht.
    const authoredSheet = getWalkingSheetForStaticTexture(DAWN_M3_ASSET_KEYS.scavenger);
    const scavengerArtLoaded = kind === DAWN_SCAVENGER_KIND
      && scene.textures.exists(authoredSheet?.textureKey ?? DAWN_M3_ASSET_KEYS.scavenger);
    const scavengerFallback = kind === DAWN_SCAVENGER_KIND && !scavengerArtLoaded;
    const imageKey = scavengerArtLoaded ? DAWN_M3_ASSET_KEYS.scavenger : this.config.imageKey;
    this.walkingSheet = getWalkingSheetForStaticTexture(imageKey);
    this.sprite = this.walkingSheet
      ? scene.add.sprite(x, y, this.walkingSheet.textureKey, WALKING_IDLE_FRAME)
      : scene.add.sprite(x, y, imageKey);
    this.sprite.setDisplaySize(this.getVisualSize(), this.getVisualSize());
    this.sprite.setDepth(DEPTH.PLAYERS - 0.05);
    if (faction === 'allied') {
      // Verbündete lesen sich über drei Signale: Jade-Tönung, Jade-Leuchtumriss und einen
      // Ring in der Farbe des Besitzers. Gegner-Grüns sind pastellig – erst der Umriss trennt.
      this.sprite.setTint(ALLIED_PALETTE.tint);
      this.allyGlow = addPlayerGlow(this.sprite, ALLIED_COLOR, Phaser.Math.Clamp(this.config.size / PLAYER_SIZE, 0.75, 1.4));
      // Draufsicht: zentrierter Kreis statt perspektivischer Ellipse. Der Snapshot dekodiert eine
      // fehlende Besitzerfarbe als 0, deshalb `||` statt `??`.
      this.ownerRing = scene.add.circle(x, y, this.config.size * 0.62, 0x000000, 0)
        .setStrokeStyle(3, ownerColor || ALLIED_PALETTE.bright, 1)
        .setDepth(DEPTH.PLAYERS - 0.075); // Above figure shadows (9.92), below the contour/body.
      registerGraphicsObject(scene, 'enemyStatus', this.ownerRing);
    } else if (this.config.color !== undefined) {
      this.sprite.setTint(this.config.color);
    } else if (scavengerFallback) {
      this.sprite.setTint(0xffbd59);
    }
    if (faction === 'hostile') {
      this.createGlowHalo(scene);
    }

    if (authoritative) {
      scene.physics.add.existing(this.sprite);
      const body = this.body;
      this.syncCollisionCircle();
      body.setCollideWorldBounds(true);
      body.setBounce(0, 0);
      body.allowGravity = false;
    }

    this.faceAngle(0);
    if (authoritative && (config.krakenEgg || config.krakenBoss)) this.setStationary(true);
    this.syncBar();
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  /** Host navigation only; clients render the ordinary enemy position snapshots. */
  escapeTarget: { readonly x: number; readonly y: number } | null = null;

  setPosition(x: number, y: number): void {
    if (this.stationary) return;
    this.movementRevision++;
    this.movementCorrectionRemaining = 0;
    this.targetX = x;
    this.targetY = y;
    this.sprite.setPosition(x, y);
    if (this.authoritative) {
      this.body.reset(x, y);
    }
    this.visualAimAngle = this.currentAimAngle;
    this.smoothMovementFacing = false;
    this.sprite.setRotation(this.visualAimAngle + this.getSpriteRotationOffset());
    if (this.authoritative && this.config.krakenBoss) this.syncKrakenPhysicsPose();
    this.syncBar();
  }

  get positionRevision(): number { return this.movementRevision; }

  isStationary(): boolean { return this.stationary; }

  /** A host-owned fixed target keeps its position even through portals and external impulses. */
  setStationary(stationary: boolean): void {
    const resumingKraken = this.stationary && !stationary && !!this.config.krakenBoss;
    this.stationary = stationary;
    if (this.authoritative) {
      if (resumingKraken) this.syncKrakenPhysicsPose();
      this.body.moves = !stationary;
      this.body.setImmovable(stationary);
      if (stationary) this.stopMovement();
    }
  }

  /** Arcade reset uses the rotated sprite corner, while its circle uses an unrotated offset.
   * Locked preUpdates correct the circle but retain prevFrame. Rebase both at an explicit pose
   * and before unlocking, otherwise postUpdate replays that stale displacement into the sprite. */
  private syncKrakenPhysicsPose(): void {
    const body = this.body;
    body.updateFromGameObject();
    body.prev.copy(body.position);
    body.prevFrame.copy(body.position);
  }

  private remotePositionRevision = -1;
  setTargetPosition(x: number, y: number, revision?: number): void {
    if (revision !== undefined) {
      if (!Number.isSafeInteger(revision) || revision < this.remotePositionRevision) return;
      if (revision !== this.remotePositionRevision) {
        this.remotePositionRevision = revision;
        this.setPosition(x, y);
        return;
      }
    }
    const correction = Math.hypot(x - this.targetX, y - this.targetY);
    if (correction > this.config.size * 4) {
      this.movementRevision++;
      this.movementCorrectionRemaining = correction;
    }
    this.targetX = x;
    this.targetY = y;
  }

  setDesiredVelocity(vx: number, vy: number, now?: number, aimAngle?: number,
    facing: 'immediate' | 'locomotion' = 'immediate'): void {
    if (!this.authoritative) return;
    if (this.stationary) { vx = 0; vy = 0; }
    this.desiredVelocityX = vx;
    this.desiredVelocityY = vy;
    // The Kraken host owns body facing in both phases, including its turn-rate limit.
    if (this.krakenMovement) return;
    const turnRate = this.turnRateRadPerMs();
    if (turnRate !== null) {
      const moving = vx !== 0 || vy !== 0;
      const heading = aimAngle ?? (moving ? Math.atan2(vy, vx) : this.requestedHeading);
      this.requestedHeading = null;
      const factor = this.stepLimitedTurn(heading, now ?? this.sprite.scene.time.now, turnRate);
      // Moving along the current facing is unaffected; turned away, the body shuffles.
      if (moving && aimAngle === undefined) { this.desiredVelocityX = vx * factor; this.desiredVelocityY = vy * factor; }
      return;
    }
    this.smoothMovementFacing = false;
    if (aimAngle !== undefined) {
      this.faceAngle(aimAngle);
    } else if ((vx !== 0 || vy !== 0) && (now === undefined || !this.isAttackMovementPaused(now))) {
      const ordinary = facing === 'locomotion' && this.dashPhase === 0 && this.specialAction === 'none' && !this.burrowed;
      if (ordinary) {
        // Near standstill a tiny avoidance velocity has no meaningful facing.
        if (this.wantsToMove()) {
          this.currentAimAngle = this.targetAimAngle = Math.atan2(vy, vx);
          this.smoothMovementFacing = true;
        }
      } else this.faceAngle(Math.atan2(vy, vx));
    }
  }

  /** Once per host presentation frame. Clients already have one network-angle filter. */
  syncMovementFacing(deltaMs: number): void {
    if (!this.authoritative) return;
    if (this.dashPhase !== 0 || this.specialAction !== 'none' || this.burrowed) {
      this.faceAngle(this.currentAimAngle);
      return;
    }
    if (!this.smoothMovementFacing) return;
    const diff = Phaser.Math.Angle.Wrap(this.currentAimAngle - this.visualAimAngle);
    const timeConstant = Math.abs(diff) <= Math.PI / 6 ? 120 : 45;
    this.visualAimAngle += diff * (1 - Math.exp(-Math.max(0, deltaMs) / timeConstant));
    this.sprite.setRotation(this.visualAimAngle + this.getSpriteRotationOffset());
  }

  getDesiredVelocity(): { vx: number; vy: number } {
    return { vx: this.desiredVelocityX, vy: this.desiredVelocityY };
  }

  /** Last physical velocity, after status factors, dash, stun and external impulses. */
  getAppliedVelocity(): { vx: number; vy: number } {
    const body = this.authoritative ? this.sprite.body as Phaser.Physics.Arcade.Body | null : null;
    return { vx: body?.velocity.x ?? 0, vy: body?.velocity.y ?? 0 };
  }

  /**
   * True, wenn die Wegfindung dem Gegner in diesem Frame keine Route liefern konnte – er steht
   * also nicht freiwillig still, sondern hängt fest. Wird vom EnemyManager gesetzt und vom
   * Angriffssystem ausgewertet, um Felsen freizubeissen.
   */
  isPathBlocked(): boolean {
    return this.pathBlocked;
  }

  setPathBlocked(blocked: boolean): void {
    this.pathBlocked = blocked;
  }

  /** True, wenn der Gegner sich in diesem Frame ueberhaupt bewegen will. */
  wantsToMove(): boolean {
    return Math.abs(this.desiredVelocityX) > 0.5 || Math.abs(this.desiredVelocityY) > 0.5;
  }

  stopMovement(): void {
    this.setDesiredVelocity(0, 0);
    if (this.authoritative && this.sprite.body) {
      (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
  }

  /**
   * Laufanimation anfordern. Die Darstellung wird zusaetzlich gesperrt, solange der Gegner
   * eingebuddelt, unsichtbar oder tot ist; statische Gegnerarten ignorieren den Aufruf.
   */
  setWalking(walking: boolean): void {
    // Hoppers never walk: flights are drawn from the hop timeline, knockback slides in the idle pose.
    if (this.stationary || this.config.hop) walking = false;
    if (this.walkingRequested === walking) return;
    this.walkingRequested = walking;
    this.syncWalkingAnimation();
  }

  readMovementVisualSample(out: MovementVisualSample): void {
    out.id = this.id;
    out.x = this.sprite.x; out.y = this.sprite.y;
    out.facing = this.sprite.rotation - this.getSpriteRotationOffset();
    out.size = this.config.size; out.pawCount = this.config.pawCount;
    out.footprint = getEnemyFootprintVariant(this.kind);
    out.player = false;
    out.visible = this.sprite.visible && this.currentHp > 0 && !this.burrowed
      && this.movementCorrectionRemaining < this.config.size * 0.3;
    out.mode = this.hopAirborne || this.kaboomtulaAirborne || this.pounceAirborne ? 'airborne' : this.dashPhase === 1 ? 'dash' : this.dashPhase === 2 ? 'recovery'
      : this.walkingRequested ? 'walk' : 'idle';
    out.isBurrowDash = false;
    out.revision = this.movementRevision;
    out.footprintGlow = this.faction === 'hostile' ? this.config.bossPresence?.footprintGlowColor ?? 0 : 0;
  }

  /**
   * Client-Ableitung der Laufanimation: Der Gegner laeuft, solange die Interpolation noch
   * spuerbar hinter der replizierten Zielposition liegt. Der Host setzt stattdessen direkt
   * `setWalking()` aus der Koerpergeschwindigkeit.
   */
  syncWalkingFromInterpolation(): void {
    const gap = Math.hypot(this.targetX - this.sprite.x, this.targetY - this.sprite.y);
    this.setWalking(gap > WALKING_INTERPOLATION_EPSILON_PX);
  }

  private syncWalkingAnimation(): void {
    if (this.clawAnimating || this.castAnimating || this.shieldChargeAnimating || this.energyConeAnimating || this.hopAnimating
      || this.pounceAnimating) return;
    if (!this.walkingSheet) return;
    syncBadgerWalkingAnimation(
      this.sprite,
      this.walkingRequested && !this.burrowed && this.sprite.visible && this.currentHp > 0,
    );
  }

  lerpStep(factor: number): void {
    if (this.authoritative) return;
    this.movementCorrectionRemaining *= Math.max(0, 1 - factor);
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
    const diff = Phaser.Math.Angle.Wrap(this.targetAimAngle - this.currentAimAngle);
    this.currentAimAngle = this.currentAimAngle + diff * factor;
    this.visualAimAngle = this.currentAimAngle;
    this.sprite.setRotation(this.visualAimAngle + this.getSpriteRotationOffset());
    this.syncBar();
  }

  setTargetRotation(aimAngle: number): void {
    this.targetAimAngle = aimAngle;
  }

  setHealthBarRenderer(renderer: WorldHealthBarRenderer | null): void {
    if (renderer === this.healthBars) return;
    this.healthBars?.release(this.healthBar);
    this.healthBar = null;
    this.healthBars = renderer;
    this.bindHealthBar();
  }

  private bindHealthBar(): void {
    if (!this.sprite.active || !this.healthBars || this.healthBars.isValid(this.healthBar)) return;
    this.healthBar = this.healthBars.bind(
      this.faction === 'allied'
        ? alliedEnemyHealthBarStyle(this.getHpBarWidth())
        : enemyHealthBarStyle(this.config.isBoss === true, this.getHpBarWidth()),
      this.currentHp, this.maxHp, this.sprite.x, this.sprite.y + this.getHpBarOffsetY(),
      this.burrowed || !this.sprite.visible,
    );
  }

  setHp(hp: number, maxHp: number = this.maxHp, baseline = false): void {
    this.maxHp = Math.max(1, maxHp);
    this.currentHp = Phaser.Math.Clamp(hp, 0, this.maxHp);
    this.bindHealthBar();
    if (baseline) this.healthBars?.baseline(this.healthBar, this.currentHp, this.maxHp);
    else this.healthBars?.observe(this.healthBar, this.currentHp, this.maxHp);
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  updateBurnStacks(stacks: number, visualStyle: GroundFireVisualStyle = 'normal'): void {
    const nextStacks = Math.max(0, Math.floor(stacks));
    this.burnStacks = nextStacks;
    this.burnVisualStyle = visualStyle;
    if (nextStacks <= 0) {
      this.burnRenderer?.destroy();
      this.burnRenderer = null;
      return;
    }
    if (!this.burnRenderer) {
      this.burnRenderer = new EntityBurnRenderer(this.sprite.scene, this.burnGpu);
      this.burnRenderer.setLightingSystem(this.lighting, this.burnLightKey());
    }
    this.syncBurnEffect();
  }

  updatePlasmaChargeStacks(stacks: number): void {
    this.plasmaChargeStacks = Phaser.Math.Clamp(Math.floor(stacks), 0, MAX_PLASMA_CHARGE_STACKS);
    if (this.plasmaChargeStacks <= 0) {
      this.plasmaChargeRenderer?.destroy();
      this.plasmaChargeRenderer = null;
      return;
    }
    this.plasmaChargeRenderer ??= new PlasmaChargeRenderer(this.sprite.scene);
    this.syncPlasmaChargeEffect();
  }

  getPlasmaChargeStacks(): number {
    return this.plasmaChargeStacks;
  }

  /**
   * Die Beleuchtung ist scene-lifetime, die Entity nicht. Der `EnemyManager` reicht die
   * Referenz direkt nach dem Anlegen durch.
   */
  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    this.burnRenderer?.setLightingSystem(lighting, this.burnLightKey());
  }

  /**
   * Der Brand-Partikelcontroller ist ebenfalls scene-lifetime. Ein bereits bestehender
   * Brand-Renderer haelt sein Handle; er bekommt den Controller beim Anlegen mit.
   */
  setEntityBurnGpuController(controller: EntityBurnGpuController | null): void {
    this.burnGpu = controller;
  }

  private burnLightKey(): string {
    return `entityburn:enemy:${this.id}`;
  }

  /**
   * Presented vulnerability from every gameplay source. The scene-owned, GPU-batched
   * `EnemyVulnerabilityRenderer` draws it for all enemies at once.
   */
  setVulnerable(active: boolean): void {
    this.vulnerable = active;
  }

  isVulnerable(): boolean {
    return this.vulnerable;
  }

  getStatusVisualTarget(): EntityStatusVisualTarget {
    return { sprite: this.sprite, bodySize: this.config.size,
      visible: !this.burrowed && this.currentHp > 0 && this.sprite.visible };
  }

  getMoveSpeed(): number {
    return (this.config.krakenBoss?.landMoveSpeedPxPerSec ?? this.config.moveSpeed) * this.moveSpeedMultiplier
      * this.abilitySpeedFactor * dawnEliteSpeedMultiplier(this.eliteAffixId);
  }

  setMoveSpeedMultiplier(multiplier: number): void {
    this.moveSpeedMultiplier = Math.max(0, multiplier);
  }

  /** Host: speed factor of the body's own ability cycle (heat), set each frame; composes with the multiplier. */
  setAbilitySpeedFactor(factor: number): void {
    this.abilitySpeedFactor = Number.isFinite(factor) ? Math.max(0, Math.min(3, factor)) : 1;
  }

  /** Faktor, mit dem Wegstoss-Impulse auf diesen Gegner skaliert werden (1 = normal). */
  getKnockbackFactor(): number {
    if (this.stationary || this.knockbackImmune) return 0;
    return this.config.knockbackFactor ?? DEFAULT_ENEMY_KNOCKBACK_FACTOR;
  }

  getCollisionRadius(): number {
    if (this.config.krakenBoss) return this.config.krakenBoss.bodyRadiusPx;
    // Der Arcade-Body ist waehrend eines Dashes temporaer kleiner. Sonderbewegungen muessen
    // deshalb den tatsaechlichen Radius verwenden; auf Clients ohne autoritativen Body gilt die
    // registrierte Koerpergroesse ohne den transparenten Bewegungsrand.
    if (this.authoritative && this.sprite.body) {
      return this.body.halfWidth;
    }
    return this.config.size * 0.5;
  }

  /** Physischer Grunddurchmesser des Gegners vor der Ausweich-Skalierung. */
  getSize(): number {
    return this.config.krakenBoss ? this.config.krakenBoss.bodyRadiusPx * 2 : this.config.size;
  }

  /** Canvas includes the pounce's transparent margin; the physical size stays authored. */
  getVisualSize(): number {
    return this.config.size * (this.walkingSheet?.displayScale ?? 1) * (this.eliteAffixId ? ELITE_VISUAL_SCALE : 1);
  }

  private syncCollisionCircle(): void {
    // The Arcade circle scales with the sprite; a presentation-only lift is divided back out.
    const lift = this.airLiftMovesBody ? 1 : this.airLiftScale;
    const diameter = this.sprite.frame.realWidth * this.getSize() / this.getVisualSize() / lift;
    const offset = (this.sprite.frame.realWidth - diameter) * 0.5;
    this.body.setCircle(diameter * 0.5, offset, offset);
  }

  getImageKey(): string {
    return this.config.imageKey;
  }

  /** Farbe für Trail-Geister; ohne eigene Einfärbung bleibt das Sprite unverfälscht. */
  getTintColor(): number {
    return this.config.color ?? 0xffffff;
  }

  /**
   * Farbe des Spawn-Effekts. Verbündete tragen die Farbe ihres Beschwörers, Gegner ihr
   * Eigenleuchten oder ihre Einfärbung – ohne beides ein neutrales Feindrot, damit der Effekt
   * nicht mit einem Spielerspawn verwechselt wird.
   */
  getSpawnEffectColor(): number {
    if (this.faction === 'allied') return ALLIED_COLOR;
    return this.config.glow?.color ?? this.config.color ?? 0xd8483c;
  }

  getDashPhase(): 0 | 1 | 2 {
    return this.dashPhase;
  }

  private dashScale = 1;
  private airLiftScale = 1;
  /** A hop lift is pure presentation; the charger leap keeps its historical body growth. */
  private airLiftMovesBody = true;

  /** Presentation-only display growth of a hopping body (1 on the ground); shadows divide it back out. */
  getHopLiftScale(): number { return this.airLiftMovesBody ? 1 : this.airLiftScale; }

  private setAirLiftScale(scale: number, movesBody = true): void {
    if (scale === this.airLiftScale && movesBody === this.airLiftMovesBody) return;
    this.airLiftScale = scale;
    this.airLiftMovesBody = movesBody;
    this.applyDisplayScale();
    if (!movesBody && this.authoritative && this.sprite.body) this.syncCollisionCircle();
  }

  /** Single writer of the sprite display size: dodge shrink and airborne lift combine here. */
  private applyDisplayScale(): void {
    const size = this.getVisualSize() * this.dashScale * this.airLiftScale;
    this.sprite.setDisplaySize(size, size);
  }

  setDashPhase(phase: 0 | 1 | 2): void {
    this.dashPhase = phase;
  }

  /**
   * Skaliert Darstellung und – auf dem Host – die Trefferkugel des Gegners. Wird für den
   * Ausweichschritt genutzt und entspricht der Hitbox-Verkleinerung des Spieler-Dashs.
   */
  setDashScale(scale: number): void {
    this.dashScale = Phaser.Math.Clamp(scale, 0.1, 1);
    this.applyDisplayScale();
    if (this.authoritative && this.sprite.body) {
      this.syncCollisionCircle();
    }
  }

  /** Hidden from combat and targeting: burrowed underground or submerged in water. */
  isBurrowed(): boolean {
    return this.burrowed || this.submerged;
  }

  /**
   * Setzt den Einbuddel-Zustand. Unter der Erde ist der Gegner – genau wie ein eingebuddelter
   * Spieler – komplett unsichtbar; nur die Buddel-Partikel verraten seine Position.
   * Liefert true, wenn sich der Zustand geaendert hat (Trigger fuer die Buddel-Visuals).
   */
  setBurrowed(burrowed: boolean): boolean {
    if (this.burrowed === burrowed) return false;
    this.burrowed = burrowed;
    this.applyHiddenState();
    return true;
  }

  private applyHiddenState(): void {
    const hidden = this.burrowed || this.submerged;
    this.sprite.setVisible(!hidden);
    this.ownerRing?.setVisible(!hidden);
    this.glowHalo?.setVisible(!hidden);
    this.healthBars?.suppress(this.healthBar, hidden);
    this.syncWalkingAnimation();
    this.syncBar();
  }

  isBoss(): boolean {
    return this.config.isBoss === true;
  }

  /** Authored Präsenz-Effekte eines feindlichen Bosses (Glühwürmchen, Fußspuren), sonst `undefined`. */
  getBossPresence(): ResolvedCoopDefenseEnemyConfig['bossPresence'] {
    return this.faction === 'hostile' && this.config.isBoss ? this.config.bossPresence : undefined;
  }

  getAttackWeapons(): readonly EnemyAttackWeapon[] {
    return this.attackWeapons;
  }

  getObstacleAttackDelayMs(): number {
    return this.config.obstacleAttackDelayMs;
  }

  isWeaponReady(weapon: BaseWeapon, now: number): boolean {
    if (weapon.isOnCooldown(now)) return false;
    return now >= (this.weaponLockouts.get(weapon.config.id) ?? 0);
  }

  /**
   * Zusaetzliche Sperre oberhalb des Waffen-Cooldowns. Damit koennen Angriffsmuster wie eine
   * Salve ihren eigenen, laengeren Takt vorgeben, ohne den Schusstakt der Waffe zu veraendern.
   */
  lockWeaponUntil(weapon: BaseWeapon, readyAt: number): void {
    this.weaponLockouts.set(weapon.config.id, Math.max(this.weaponLockouts.get(weapon.config.id) ?? 0, readyAt));
  }

  recordWeaponUse(weapon: BaseWeapon, now: number): void {
    weapon.recordUse(now);
    weapon.addSpread();
  }

  decayWeaponSpread(delta: number, now: number): void {
    for (const attackWeapon of this.attackWeapons) {
      attackWeapon.weapon.decaySpread(delta, now);
    }
  }

  /**
   * Zufälliger Zielversatz in Radiant nach demselben Modell wie beim Spieler: Grundstreuung je
   * nachdem, ob der Gegner steht oder läuft, plus dem Bloom aus den bisherigen Schüssen.
   * Waffen ohne Streuwerte liefern 0 und zielen damit weiterhin exakt.
   */
  rollWeaponSpreadOffset(weapon: BaseWeapon): number {
    const config = weapon.config;
    const body = this.authoritative ? (this.sprite.body as Phaser.Physics.Arcade.Body | null) : null;
    const moving = isVelocityMoving(body?.velocity.x ?? 0, body?.velocity.y ?? 0);
    const totalSpreadDeg = Math.max(0, (moving ? config.spreadMoving : config.spreadStanding) + weapon.getDynamicSpread());
    if (totalSpreadDeg <= 0) return 0;

    const halfSpreadRad = (totalSpreadDeg * Math.PI / 180) / 2;
    return Phaser.Math.FloatBetween(-halfSpreadRad, halfSpreadRad);
  }

  getAttackScanIntervalMs(): number {
    return this.config.attackScanIntervalMs;
  }

  canScanForAttack(now: number): boolean {
    return this.authoritative && now >= this.nextAttackScanAt;
  }

  scheduleNextAttackScan(now: number): void {
    this.nextAttackScanAt = now + this.config.attackScanIntervalMs;
  }

  /**
   * Angriffspause nach einer Aktion. `movementSpeedFactor` = 0 haelt den Gegner an (Standard und
   * bisheriges Verhalten); ein Wert darueber laesst ihn mit diesem Anteil seiner Laufgeschwindigkeit
   * weiterlaufen, ohne seine Blickrichtung vom Ziel zu loesen. `durationMs` erlaubt Aktionen mit
   * eigener Standzeit (Wurf-Windup) statt der Gegner-Pauschale.
   */
  pauseAttackMovement(
    now: number,
    movementSpeedFactor = 0,
    durationMs = this.config.attackStopDurationMs,
  ): void {
    this.attackPauseUntil = Math.max(this.attackPauseUntil, now + Math.max(0, durationMs));
    // Der zuletzt ausgeloeste Angriff bestimmt das Tempo: Waffen wechseln haeufiger als die
    // kurze Pause laeuft, und die juengste Aktion beschreibt den aktuellen Zustand am besten.
    this.attackPauseSpeedFactor = Phaser.Math.Clamp(movementSpeedFactor, 0, 1);
    if (this.attackPauseSpeedFactor <= 0) this.stopMovement();
  }

  /** True, solange eine Angriffspause laeuft – auch wenn der Gegner dabei weiterlaufen darf. */
  isAttackMovementPaused(now: number): boolean {
    return this.authoritative && now < this.attackPauseUntil;
  }

  /**
   * Anteil der Laufgeschwindigkeit fuer diesen Frame: 1 ausserhalb einer Angriffspause, sonst der
   * von der ausloesenden Aktion vorgegebene Faktor (0 = vollstaendiger Halt).
   */
  getAttackMovementSpeedFactor(now: number): number {
    return this.isAttackMovementPaused(now) ? this.attackPauseSpeedFactor : 1;
  }

  faceAngle(angle: number): void {
    // A turn-limited body only records the wish; setDesiredVelocity turns it at the authored rate.
    if (this.authoritative && this.turnRateRadPerMs() !== null) { this.requestedHeading = angle; return; }
    this.currentAimAngle = angle;
    this.targetAimAngle = angle;
    this.visualAimAngle = angle;
    this.smoothMovementFacing = false;
    this.sprite.setRotation(angle + this.getSpriteRotationOffset());
  }

  private getSpriteRotationOffset(): number {
    const configuredOffset = (this.config.spriteRotationOffsetDegrees ?? 0) * Math.PI / 180;
    return EnemyEntity.ROTATION_OFFSET + configuredOffset;
  }

  getAimAngle(): number {
    return this.currentAimAngle;
  }

  getSpecialAction(): SyncedEnemyState['specialAction'] {
    return this.specialAction;
  }

  setSpecialAction(
    action: SyncedEnemyState['specialAction'],
    endsAt = 0,
    gaussChargeProgress = 0,
    gaussAimAngle = this.currentAimAngle,
  ): void {
    this.specialAction = action;
    this.specialActionEndsAt = endsAt;
    this.gaussChargeProgress = Phaser.Math.Clamp(gaussChargeProgress, 0, 1);
    this.gaussAimAngle = gaussAimAngle;
  }

  syncBar(): void {
    this.ownerRing?.setPosition(this.sprite.x, this.sprite.y);
    this.syncGlow();
    this.syncVoidMolotovWindupVisuals();
    this.syncBurnEffect();
    this.syncPlasmaChargeEffect();
    this.bindHealthBar();
    this.healthBars?.suppress(this.healthBar, this.burrowed || !this.sprite.visible);
    this.healthBars?.position(this.healthBar, this.sprite.x, this.sprite.y + this.getHpBarOffsetY());
  }

  getNetSnapshot(): SyncedEnemyState {
    // Conditional assignment instead of object spreads: built per enemy and net tick, and read
    // per frame by a few presentation owners.
    const snapshot: { -readonly [K in keyof SyncedEnemyState]: SyncedEnemyState[K] } = {
      claw: this.clawState,
      positionRevision: this.movementRevision,
      id: this.id,
      kind: this.kind,
      x: this.sprite.x,
      y: this.sprite.y,
      rot: this.currentAimAngle,
      hp: this.currentHp,
      maxHp: this.getMaxHp(),
      burnStacks: Math.min(this.burnStacks, MAX_VISUAL_BURN_STACKS),
      burnVisualStyle: this.burnVisualStyle,
      plasmaChargeStacks: this.plasmaChargeStacks > 0 ? this.plasmaChargeStacks : undefined,
      faction: this.faction,
      burrowed: this.burrowed,
      dashPhase: this.dashPhase,
      specialAction: this.specialAction,
      specialActionEndsAt: this.specialActionEndsAt,
      gaussChargeProgress: this.gaussChargeProgress,
      gaussAimAngle: this.gaussAimAngle,
      ownerId: this.ownerId,
      ownerColor: this.ownerColor,
    };
    if (this.shieldCharge.revision > 0) snapshot.shieldCharge = this.shieldCharge;
    if (this.hopState.revision > 0) snapshot.hop = this.hopState;
    if (this.kaboomtulaState.revision > 0) snapshot.kaboomtula = this.kaboomtulaState;
    if (this.pounceState.revision > 0) snapshot.pounce = this.pounceState;
    if (this.heatBurstState.revision > 0) snapshot.heatBurst = this.heatBurstState;
    if (this.energyCone.revision > 0) snapshot.energyCone = this.energyCone;
    if (this.eliteAffixId) snapshot.eliteAffixId = this.eliteAffixId;
    if (this.areaClaw.revision > 0) snapshot.areaClaw = this.areaClaw;
    if (this.submerged) snapshot.submerged = true;
    return snapshot;
  }

  destroy(): void {
    this.healthBars?.release(this.healthBar);
    this.healthBar = null;
    this.burnRenderer?.destroy();
    this.burnRenderer = null;
    this.plasmaChargeRenderer?.destroy();
    this.plasmaChargeRenderer = null;
    this.ownerRing?.destroy();
    this.ownerRing = null;
    removeInternalFx(this.sprite, this.allyGlow);
    this.allyGlow = null;
    removeExternalFx(this.sprite, this.kaboomtulaAura);
    this.kaboomtulaAura = null;
    if (this.glowHalo) {
      this.sprite.scene.tweens.killTweensOf(this.glowHalo);
      this.glowHalo.destroy();
      this.glowHalo = null;
    }
    this.destroyVoidMolotovWindupVisuals();
    this.lighting?.releaseLight(this.glowLightKey());
    this.sprite.destroy();
  }

  private syncBurnEffect(): void {
    this.burnRenderer?.sync(
      this.sprite.x,
      this.sprite.y,
      this.config.size,
      this.burnStacks,
      this.sprite.visible && this.currentHp > 0,
      this.burnVisualStyle,
    );
  }

  private syncPlasmaChargeEffect(): void {
    this.plasmaChargeRenderer?.sync(
      this.sprite.x,
      this.sprite.y,
      this.config.size,
      this.plasmaChargeStacks,
      this.sprite.visible && this.currentHp > 0 && !this.burrowed,
    );
  }

  private getHpBarWidth(): number {
    return this.faction === 'hostile' && this.config.isBoss ? Math.max(76, this.config.size * 1.55) : HP_BAR_WIDTH;
  }

  private getHpBarOffsetY(): number {
    return this.faction === 'hostile' && this.config.isBoss ? this.config.size * 0.5 + 12 : HP_BAR_OFFSET_Y;
  }

  /**
   * Additiver Halo aus der `glow`-Konfiguration. Bewusst rund und ohne Perspektive: die Arena
   * wird orthografisch von oben gesehen, ein gestauchter Kreis würde eine Schrägsicht andeuten,
   * die es nicht gibt.
   */
  private createGlowHalo(scene: Phaser.Scene): void {
    const glow = this.config.glow;
    if (!glow) return;

    fillRadialGradientTexture(scene.textures, TEX_ENEMY_GLOW, 96, [
      [0,    'rgba(255,255,255,1)'],
      [0.32, 'rgba(255,255,255,0.55)'],
      [0.68, 'rgba(255,255,255,0.16)'],
      [1,    'rgba(255,255,255,0)'],
    ]);

    const diameter = this.config.size * glow.sizeFactor;
    this.glowHalo = scene.add.image(this.sprite.x, this.sprite.y, TEX_ENEMY_GLOW);
    this.glowHalo.setDisplaySize(diameter, diameter);
    this.glowHalo.setDepth(DEPTH.PLAYERS - 0.09);
    makeAdditive(this.glowHalo);
    this.glowHalo.setTint(glow.color);
    this.glowHalo.setAlpha(emissiveAlpha(glow.alpha));

    // Leichtes Atmen (siehe syncGlow), damit der Halo nicht als aufgeklebte Scheibe liest. Es wird
    // pro Frame aus der Uhr berechnet: ein Endlos-Tween je Gegner kostete bei Horden spürbar CPU.
    this.glowBreathOrigin = scene.time.now;
  }

  /** 0..1..0 über GLOW_BREATH_PERIOD_MS, wie der frühere Sine.easeInOut-Yoyo-Tween. */
  private glowBreath(): number {
    const elapsed = (this.sprite.scene?.time.now ?? 0) - this.glowBreathOrigin;
    return 0.5 - 0.5 * Math.cos(elapsed / GLOW_BREATH_PERIOD_MS * Math.PI * 2);
  }

  /** Folgt dem Sprite und meldet die zugehörige Lichtquelle für dieses Frame an. */
  private syncGlow(): void {
    const phaseTwo = this.config.phaseTwoGlow !== undefined
      && this.currentHp / this.maxHp <= (this.config.voidHunterBoss?.phaseTwoHpRatio ?? 0.5);
    const glow = phaseTwo ? this.config.phaseTwoGlow : this.config.glow;
    if (!glow) return;

    const visible = !this.burrowed && this.currentHp > 0;
    const spider = this.config.kaboomtula ? this.kaboomtulaGlow(glow.alpha) : null;
    // Die Kabummtula wird phasengebunden gepulst; das Atmen würde Drohen und Sturmlauf überlagern.
    const breath = spider || phaseTwo ? 0 : this.glowBreath();
    const sizeMultiplier = spider?.size ?? 1;
    const haloSize = this.config.size * glow.sizeFactor * sizeMultiplier * (1 + GLOW_BREATH_SCALE * breath);
    this.glowHalo?.setVisible(visible);
    this.glowHalo?.setPosition(this.sprite.x, this.sprite.y);
    this.glowHalo?.setDisplaySize(haloSize, haloSize);
    this.glowHalo?.setTint(glow.color);
    this.glowHalo?.setAlpha(emissiveAlpha(spider?.alpha ?? glow.alpha * (1 - GLOW_BREATH_DIM * breath)));
    if (spider) this.syncKaboomtulaAura(glow.color, spider.aura, visible && this.sprite.visible);

    if (!this.lighting) return;
    if (!visible) {
      this.lighting.releaseLight(this.glowLightKey());
      return;
    }
    this.lighting.setLight(this.glowLightKey(), 'entityGlow', this.sprite.x, this.sprite.y, {
      color:     glow.color,
      radiusPx:  glow.lightRadiusPx * sizeMultiplier,
      intensity: glow.lightIntensity * (spider?.light ?? 1),
    });
  }

  /** The silhouette glow follows the spider's menace; it is the only danger signal besides the leap telegraph. */
  private syncKaboomtulaAura(color: number, strength: number, visible: boolean): void {
    this.kaboomtulaAura ??= addExternalGlow(this.sprite, color, 0, 0, false, 0.2, 12, 'critical');
    const aura = this.kaboomtulaAura;
    if (!aura) return;
    const on = visible && strength > 0.05;
    aura.color = color;
    aura.outerStrength = on ? strength : 0;
    aura.setActive?.(on);
  }

  /**
   * Void-violet menace of the spider by replicated phase: a dim breath while approaching, a swell
   * during the alert pose, a strong fast pulse while rushing and pouncing, fading while it recovers.
   * Red stays reserved for the leap telegraph.
   */
  private kaboomtulaGlow(baseAlpha: number): { size: number; alpha: number; light: number; aura: number } {
    const now = this.sprite.scene.time.now, state = this.kaboomtulaState;
    const progress = kaboomtulaPhaseProgress(state, now);
    const pulseAt = (periodMs: number) => 0.5 + 0.5 * Math.sin(now * Math.PI * 2 / periodMs);
    // Shared glow alpha is 0.18 per strength unit: a hunting spider wears an opaque void rim.
    // Calm stays a quiet breath (smaller halo) so the hunting swell reads as the danger signal.
    const calm = (pulse: number) => ({ size: 0.82 + pulse * 0.06, alpha: baseAlpha * (0.78 + pulse * 0.22), light: 1,
      aura: 0.8 + pulse * 0.3 });
    const hunting = (pulse: number, heat: number) => ({ size: 1.22 + heat * 0.1 + pulse * 0.18,
      alpha: 0.56 + heat * 0.14 + pulse * 0.3, light: 3.2 + heat * 1.4, aura: 4.2 + heat * 1.3 + pulse * 1.1 });
    switch (state.phase) {
      case 'alert': {
        const pulse = pulseAt(520), from = calm(pulse), to = hunting(pulse, 0);
        return { size: Phaser.Math.Linear(from.size, to.size, progress), alpha: Phaser.Math.Linear(from.alpha, to.alpha, progress),
          light: Phaser.Math.Linear(from.light, to.light, progress), aura: Phaser.Math.Linear(from.aura, to.aura, progress) };
      }
      case 'rush': return hunting(pulseAt(340), 0);
      case 'pounce': return hunting(pulseAt(Phaser.Math.Linear(300, 140, progress)), progress);
      case 'leap': return hunting(pulseAt(140), 1);
      case 'recover': {
        const pulse = pulseAt(700), from = hunting(pulse, 0), to = calm(pulse);
        return { size: Phaser.Math.Linear(from.size, to.size, progress), alpha: Phaser.Math.Linear(from.alpha, to.alpha, progress),
          light: Phaser.Math.Linear(from.light, to.light, progress), aura: Phaser.Math.Linear(from.aura, to.aura, progress) };
      }
      case 'spit': {
        const pulse = pulseAt(420);
        return { size: 1.08 + pulse * 0.1, alpha: baseAlpha + (0.36 - baseAlpha) * progress + pulse * 0.12, light: 1 + progress,
          aura: 1.2 + progress };
      }
      default: return calm(pulseAt(1100));
    }
  }

  private glowLightKey(): string {
    return `enemyglow:${this.id}`;
  }


  /**
   * Telegraph des Void-Brandsatzes: ein heller lila Ring, der sich waehrend der Ausholzeit
   * zusammenzieht, aber ausserhalb der Koerpersilhouette sichtbar bleibt. Er liegt vor dem
   * Sprite, damit auch ein bereits stehender Boss seinen bevorstehenden Wurf ankuendigt.
   * Der Fortschritt kommt aus dem replizierten Ladekanal und gilt deshalb auf Host und Clients.
   */
  private syncVoidMolotovWindupVisuals(): void {
    if (this.specialAction !== 'void-molotov-windup' || this.burrowed || this.currentHp <= 0 || !this.sprite.visible) {
      this.destroyVoidMolotovWindupVisuals();
      return;
    }

    if (!this.voidMolotovWindupRing) {
      this.voidMolotovWindupRing = this.sprite.scene.add.circle(this.sprite.x, this.sprite.y, this.config.size * 0.5);
      this.voidMolotovWindupRing.setStrokeStyle(3, this.faction === 'allied' ? ALLIED_COLOR : VOID_FIRE_COLOR, 1);
      registerGraphicsObject(this.sprite.scene, 'enemyStatus', this.voidMolotovWindupRing);
    }
    const progress = this.gaussChargeProgress;
    this.voidMolotovWindupRing.setPosition(this.sprite.x, this.sprite.y);
    this.voidMolotovWindupRing.setDepth(this.sprite.depth + 0.01);
    this.voidMolotovWindupRing.setScale(Phaser.Math.Linear(2.4, 1.6, progress));
    this.voidMolotovWindupRing.setAlpha(emissiveAlpha(0.8 + progress * 0.2));
  }

  private destroyVoidMolotovWindupVisuals(): void {
    this.voidMolotovWindupRing?.destroy();
    this.voidMolotovWindupRing = null;
  }

  /**
   * Bossphase für die Bildkomposition: 0 = kein Boss, 1 = Boss aktiv, 2 = zweite Phase.
   * Dieselbe Schwelle wie die Bossregeln, damit Farbstimmung und Gegnerdarstellung
   * gleichzeitig umschlagen.
   */
  getBossPhase(): number {
    if (!this.config.isBoss || this.currentHp <= 0) return 0;
    const ratio = this.config.voidHunterBoss?.phaseTwoHpRatio;
    if (ratio === undefined) return 1;
    return this.currentHp / this.maxHp <= ratio ? 2 : 1;
  }

  private createWeapons(): readonly EnemyAttackWeapon[] {
    if (this.config.krakenBoss || this.config.krakenEgg) return [];
    return this.config.weapons.map((configuredWeapon) => {
      const baseConfig = WEAPON_CONFIGS[configuredWeapon.weaponId as keyof typeof WEAPON_CONFIGS];
      if (!baseConfig) {
        throw new Error(`Missing weapon config for coop-defense enemy weapon: ${configuredWeapon.weaponId}`);
      }

      return {
        weapon: new GenericWeapon(this.resolveEnemyWeaponConfig(baseConfig, configuredWeapon.targetMode)),
        targetMode: configuredWeapon.targetMode,
        minimumFireDurationMs: configuredWeapon.minimumFireDurationMs ?? 0,
        meleeTiming: configuredWeapon.meleeTiming,
        attackMovementSpeedFactor: configuredWeapon.attackMovementSpeedFactor ?? 0,
        minTargetDistancePx: configuredWeapon.minTargetDistancePx ?? 0,
        salvo: configuredWeapon.salvo,
        muzzleForwardPx: configuredWeapon.muzzleForwardPx ?? 0,
      };
    });
  }

  private resolveEnemyWeaponConfig(
    config: WeaponConfig,
    targetMode: CoopDefenseEnemyWeaponTargetMode,
  ): WeaponConfig {
    const gameplayConfig = this.resolveEnemyWeaponGameplay(config, targetMode);
    // Verbündete tragen die Effekte ihrer Gattung in der Verbündeten-Palette.
    return this.faction === 'allied' ? resolveAlliedEnemyWeaponConfig(gameplayConfig) : gameplayConfig;
  }

  private resolveEnemyWeaponGameplay(
    config: WeaponConfig,
    targetMode: CoopDefenseEnemyWeaponTargetMode,
  ): WeaponConfig {
    if (targetMode !== 'players' || config.fire.type !== 'projectile') return config;

    return {
      ...config,
      rockDamageMult: 0,
      trainDamageMult: 0,
      fire: {
        ...config.fire,
        impactCloud: config.fire.impactCloud
          ? { ...config.fire.impactCloud, rockDamageMult: 0, trainDamageMult: 0 }
          : undefined,
          homing: config.fire.homing
          ? { ...config.fire.homing, targetTypes: this.faction === 'allied' ? ['enemies'] : ['players', 'decoys'] }
          : undefined,
      },
    };
  }
}
