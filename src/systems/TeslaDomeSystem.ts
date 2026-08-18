import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type {
  HomingTargetType,
  LoadoutSlot,
  ProjectileHomingConfig,
  SyncedTeslaDome,
  SyncedTeslaDomeTarget,
  TeslaDomeTargetType,
} from '../types';
import type { CombatSystem } from './CombatSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { ResourceSystem } from './ResourceSystem';

/**
 * Ein gehaltener Primärstrahl.
 *
 * Der Lock überlebt Snapshot- und Kandidatenreihenfolgen: `targetKey` ist die logische Identität
 * des Ziels, `slotIndex` die feste Strahlnummer. Beides bleibt stabil, solange das Ziel gültig ist.
 */
interface TeslaTargetLock {
  targetKey: string;
  slotIndex: number;
  type: TeslaDomeTargetType;
  x: number;
  y: number;
  /** Host-seitige Entity-Identität innerhalb des Zieltyps (Spieler-/Gegner-/Basis-ID, Fels-/Turm-Index). */
  targetId: string;
}

interface ActiveTeslaDome {
  ownerId: string;
  sourceSlot: LoadoutSlot;
  damageMultiplier: number;
  x: number;
  y: number;
  skipRockIndex?: number;
  color: number;
  config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
  lastRefreshAt: number;
  lastDrainAt: number;
  lastTickAt: number;
  activatedAt: number;
  chargeStacks: number;
  /** Blickrichtung des Besitzers; die Gewitterentladung feuert in diesen Kegel. */
  aimAngle: number;
  /** Monoton steigend über die gesamte Aktivierung; nur ein Deaktivieren setzt zurück. */
  pulseSequence: number;
  /** Echter fortlaufender Pulszeitpunkt, nicht aus der Aktivierungsdauer abgeleitet. */
  nextPulseAt: number;
  locks: TeslaTargetLock[];
}

interface TeslaConstructionSource {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  color: number;
  /** Laufzeitboni des Besitzers und lokale Turmbuffs; globale Coop-Werte folgen im CombatSystem. */
  damageMultiplier?: number;
  config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
}

interface ActiveConstructionTeslaDome extends ActiveTeslaDome {
  sourceId: number;
}

interface TeslaRockTarget {
  index: number;
  x: number;
  y: number;
}

interface TeslaTurretTarget {
  id: number;
  x: number;
  y: number;
  ownerId: string;
}

interface TeslaEnemyTarget {
  id: string;
  x: number;
  y: number;
}

interface TeslaBaseTarget {
  id: string;
  faction: 'friendly' | 'hostile';
  isInert?(): boolean;
  getHp(): number;
  getNearestSurfacePoint(x: number, y: number): { x: number; y: number; distance: number } | null;
}

/** Ein aktuell gültiges Ziel im Kuppelradius. */
interface TeslaTargetCandidate {
  targetKey: string;
  targetId: string;
  type: TeslaDomeTargetType;
  x: number;
  y: number;
  distance: number;
}

/** Hostautoritative Gewitterentladung; der Aufrufer erzeugt daraus reguläre Projektile. */
export interface TeslaStormProjectileRequest {
  ownerId: string;
  sourceSlot: LoadoutSlot;
  weaponId: string;
  x: number;
  y: number;
  angle: number;
  damage: number;
  speed: number;
  size: number;
  color: number;
  rangePx: number;
  homing?: ProjectileHomingConfig;
}

/** Ein von der Blitznova erfasstes Ziel. Schadenfrei, wirkt nur über Slow und Rückstoß. */
export interface TeslaNovaHit {
  targetId: string;
  type: TeslaDomeTargetType;
  x: number;
  y: number;
  /** Bereits mit Charge- und Distanzfaktor aufgelöster Rückstoß. */
  knockback: number;
  slowFraction: number;
  slowDurationMs: number;
  ownerId: string;
}

type LineOfSightChecker = (sx: number, sy: number, ex: number, ey: number, skipRockIndex?: number) => boolean;
type RockTargetProvider = () => readonly TeslaRockTarget[];
type RockDamageHandler = (index: number, damage: number, ownerId: string) => void;
type TrainTargetProvider = () => readonly { x: number; y: number }[];
type TrainDamageHandler = (damage: number, ownerId: string) => void;
type TurretTargetProvider = () => readonly TeslaTurretTarget[];
type TurretDamageHandler = (id: number, damage: number, ownerId: string) => void;
type EnemyTargetProvider = () => readonly TeslaEnemyTarget[];
type BaseTargetProvider = () => readonly TeslaBaseTarget[];
type BaseDamageHandler = (baseId: string, damage: number, ownerId: string, sourceSlot?: LoadoutSlot) => void;
type TeslaConstructionSourceProvider = () => readonly TeslaConstructionSource[];
type StormProjectileSpawner = (request: TeslaStormProjectileRequest) => void;
type NovaHitHandler = (hit: TeslaNovaHit) => void;

/** Der Zug ist eine segmentierte Entität und belegt deshalb genau einen logischen Slot. */
const TRAIN_TARGET_ID = 'train';

export class TeslaDomeSystem {
  private readonly activeDomes = new Map<string, ActiveTeslaDome>();
  private readonly activeConstructionDomes = new Map<number, ActiveConstructionTeslaDome>();

  private lineOfSightChecker: LineOfSightChecker | null = null;
  private rockTargetProvider: RockTargetProvider | null = null;
  private rockDamageHandler: RockDamageHandler | null = null;
  private trainTargetProvider: TrainTargetProvider | null = null;
  private trainDamageHandler: TrainDamageHandler | null = null;
  private turretTargetProvider: TurretTargetProvider | null = null;
  private turretDamageHandler: TurretDamageHandler | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private baseTargetProvider: BaseTargetProvider | null = null;
  private baseDamageHandler: BaseDamageHandler | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private constructionSourceProvider: TeslaConstructionSourceProvider | null = null;
  private stormProjectileSpawner: StormProjectileSpawner | null = null;
  private novaHitHandler: NovaHitHandler | null = null;
  private randomSource: () => number = Math.random;

  private static readonly HOLD_GRACE_MS = 500;
  /** Obergrenze für nachgeholte Pulse nach einem Frame-Stall; verhindert Puls-Bursts. */
  private static readonly MAX_PULSES_PER_UPDATE = 4;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly resourceSystem: ResourceSystem,
  ) {}

  setLineOfSightChecker(checker: LineOfSightChecker | null): void {
    this.lineOfSightChecker = checker;
  }

  setRockCallbacks(provider: RockTargetProvider | null, damageHandler: RockDamageHandler | null): void {
    this.rockTargetProvider = provider;
    this.rockDamageHandler = damageHandler;
  }

  setTrainCallbacks(provider: TrainTargetProvider | null, damageHandler: TrainDamageHandler | null): void {
    this.trainTargetProvider = provider;
    this.trainDamageHandler = damageHandler;
  }

  setTurretCallbacks(provider: TurretTargetProvider | null, damageHandler: TurretDamageHandler | null): void {
    this.turretTargetProvider = provider;
    this.turretDamageHandler = damageHandler;
  }

  setEnemyTargetProvider(provider: EnemyTargetProvider | null): void {
    this.enemyTargetProvider = provider;
  }

  setBaseCallbacks(provider: BaseTargetProvider | null, damageHandler: BaseDamageHandler | null): void {
    this.baseTargetProvider = provider;
    this.baseDamageHandler = damageHandler;
  }

  setEnergyShieldSystem(system: EnergyShieldSystem | null): void {
    this.energyShieldSystem = system;
  }

  setConstructionSourceProvider(provider: TeslaConstructionSourceProvider | null): void {
    this.constructionSourceProvider = provider;
    if (!provider) this.activeConstructionDomes.clear();
  }

  /** Gewitterprojektile entstehen ausschließlich hostseitig über diesen Spawner. */
  setStormProjectileSpawner(spawner: StormProjectileSpawner | null): void {
    this.stormProjectileSpawner = spawner;
  }

  /** Blitznova-Treffer: Slow und Rückstoß werden vom Aufrufer auf die passenden Systeme verteilt. */
  setNovaHitHandler(handler: NovaHitHandler | null): void {
    this.novaHitHandler = handler;
  }

  /** Nur für deterministische Tests; im Spiel bleibt der Zufall der Host-RNG. */
  setRandomSource(random: (() => number) | null): void {
    this.randomSource = random ?? Math.random;
  }

  hostRefresh(
    ownerId: string,
    x: number,
    y: number,
    now: number,
    config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
    color: number,
    aimAngle = 0,
  ): void {
    const existing = this.activeDomes.get(ownerId);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.color = color;
      existing.config = config;
      existing.aimAngle = aimAngle;
      existing.lastRefreshAt = now;
      return;
    }

    this.activeDomes.set(ownerId, {
      ownerId,
      sourceSlot: 'weapon2',
      damageMultiplier: 1,
      x,
      y,
      color,
      config,
      lastRefreshAt: now,
      lastDrainAt: now,
      lastTickAt: now,
      activatedAt: now,
      chargeStacks: 0,
      aimAngle,
      pulseSequence: 0,
      // Aktivierung startet auf Charge 0 ohne Puls; der erste Puls folgt ein volles Intervall später.
      nextPulseAt: now + getPulseIntervalMs(config.fire),
      locks: [],
    });
  }

  hostDeactivateForPlayer(playerId: string): void {
    this.activeDomes.delete(playerId);
  }

  isActive(playerId: string): boolean {
    return this.activeDomes.has(playerId);
  }

  /** Aktuelle Ladestufe der Spielerkuppel; außerhalb einer Aktivierung 0. */
  getChargeStacks(playerId: string): number {
    return this.activeDomes.get(playerId)?.chargeStacks ?? 0;
  }

  /**
   * Chargeabhängiger Bewegungsfaktor der aktiven Spielerkuppel.
   *
   * Ohne Feldstabilisierung bleibt es exakt der statische `movementSlowFactor`; erst
   * `movementRecoveryPerCharge` hebt ihn je Ladestufe an, gedeckelt auf 1.
   */
  getMovementSlowFactor(playerId: string): number | null {
    const dome = this.activeDomes.get(playerId);
    if (!dome) return null;
    return resolveMovementSlowFactor(dome.config.fire, dome.chargeStacks);
  }

  hostUpdate(now: number): SyncedTeslaDome[] {
    const synced: SyncedTeslaDome[] = [];

    for (const [ownerId, dome] of this.activeDomes) {
      if (now - dome.lastRefreshAt > TeslaDomeSystem.HOLD_GRACE_MS) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || !owner.sprite.active || !this.combatSystem.isAlive(ownerId) || this.combatSystem.isBurrowed(ownerId)) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      dome.x = owner.sprite.x;
      dome.y = owner.sprite.y;

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      const elapsedDrainMs = Math.max(0, now - dome.lastDrainAt);
      if (elapsedDrainMs > 0) {
        const drainAmount = dome.config.fire.adrenalineDrainPerSecond * (elapsedDrainMs / 1000);
        if (drainAmount > 0) {
          this.resourceSystem.drainAdrenaline(ownerId, drainAmount);
        }
        dome.lastDrainAt = now;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      // Nachbesetzung läuft kontinuierlich und nicht nur beim Puls.
      this.refreshLocks(dome);

      const tickInterval = Math.max(1, dome.config.fire.tickInterval);
      while (now - dome.lastTickAt >= tickInterval) {
        dome.lastTickAt += tickInterval;
        this.applyTickDamage(dome, dome.locks, 1);
      }

      this.advanceFieldPulse(dome, now);

      synced.push(this.buildSnapshot(dome, ownerId));
    }

    synced.push(...this.hostUpdateConstructionDomes(now));
    return synced;
  }

  private hostUpdateConstructionDomes(now: number): SyncedTeslaDome[] {
    const synced: SyncedTeslaDome[] = [];
    const activeSourceIds = new Set<number>();

    for (const source of this.constructionSourceProvider?.() ?? []) {
      activeSourceIds.add(source.id);

      let dome = this.activeConstructionDomes.get(source.id);
      if (!dome) {
        dome = {
          ownerId: source.ownerId,
          sourceSlot: 'utility',
          damageMultiplier: Math.max(0, source.damageMultiplier ?? 1),
          x: source.x,
          y: source.y,
          skipRockIndex: source.id,
          color: source.color,
          config: source.config,
          lastRefreshAt: now,
          lastDrainAt: now,
          lastTickAt: now,
          activatedAt: now,
          chargeStacks: 0,
          aimAngle: 0,
          pulseSequence: 0,
          nextPulseAt: Number.POSITIVE_INFINITY,
          locks: [],
          sourceId: source.id,
        };
      } else {
        dome.ownerId = source.ownerId;
        dome.x = source.x;
        dome.y = source.y;
        dome.color = source.color;
        dome.config = source.config;
        dome.damageMultiplier = Math.max(0, source.damageMultiplier ?? 1);
      }

      this.refreshLocks(dome);

      // Ein Tesla-Turm ist nur bei einem erreichbaren Gegner aktiv. Dadurch bleiben
      // Kuppelvisual und Netzwerk-Snapshot im Ruhezustand vollständig aus.
      if (dome.locks.length === 0) {
        this.activeConstructionDomes.delete(source.id);
        continue;
      }
      this.activeConstructionDomes.set(source.id, dome);

      const tickInterval = Math.max(1, dome.config.fire.tickInterval);
      while (now - dome.lastTickAt >= tickInterval) {
        dome.lastTickAt += tickInterval;
        this.applyTickDamage(dome, dome.locks, 1);
      }

      synced.push({
        ...this.buildSnapshot(dome, constructionVisualId(source.id)),
        x: Math.round(source.x),
        y: Math.round(source.y),
        color: source.color,
        alpha: 1,
        weaponId: source.config.id,
      });
    }

    for (const sourceId of [...this.activeConstructionDomes.keys()]) {
      if (!activeSourceIds.has(sourceId)) this.activeConstructionDomes.delete(sourceId);
    }

    return synced;
  }

  private buildSnapshot(dome: ActiveTeslaDome, ownerId: string): SyncedTeslaDome {
    const fire = dome.config.fire;
    return {
      ownerId,
      x: Math.round(dome.x),
      y: Math.round(dome.y),
      radius: this.getEffectiveRadius(dome),
      color: dome.color,
      // Die Ladeintensität transportiert `chargeStacks`; Alpha bleibt der reine Sichtbarkeitswert.
      alpha: 1,
      chargeStacks: dome.chargeStacks,
      pulseSequence: dome.pulseSequence,
      overchargePulseEnabled: (fire.overchargePulseEnabled ?? 0) > 0 ? true : undefined,
      stormEnabled: (fire.stormEnabled ?? 0) > 0 ? true : undefined,
      targets: dome.locks.map<SyncedTeslaDomeTarget>(lock => ({
        x: Math.round(lock.x),
        y: Math.round(lock.y),
        type: lock.type,
        targetKey: lock.targetKey,
        slotIndex: lock.slotIndex,
      })),
    };
  }

  // ── Feldpuls ──────────────────────────────────────────────────────────────

  /**
   * Führt alle fälligen Feldpulse aus.
   *
   * Reihenfolge je Puls: Pulsfolge, Charge, Radius/Mobilität, Target-Pflege mit dem neuen
   * Radius und erst danach Überladungsimpuls und Gewittersturm.
   */
  private advanceFieldPulse(dome: ActiveTeslaDome, now: number): void {
    const interval = getPulseIntervalMs(dome.config.fire);
    if (interval <= 0) {
      dome.chargeStacks = 0;
      dome.nextPulseAt = Number.POSITIVE_INFINITY;
      return;
    }

    // Ein frisch freigeschaltetes Feldaufladungs-Upgrade darf nicht sofort pulsen.
    if (!Number.isFinite(dome.nextPulseAt)) dome.nextPulseAt = now + interval;

    const maxCharge = Math.max(0, Math.floor(dome.config.fire.maxChargeStacks ?? 0));
    let pulses = 0;
    while (now >= dome.nextPulseAt && pulses < TeslaDomeSystem.MAX_PULSES_PER_UPDATE) {
      dome.nextPulseAt += interval;
      pulses += 1;

      dome.pulseSequence += 1;
      if (dome.chargeStacks < maxCharge) dome.chargeStacks += 1;

      // Radius und Mobilität folgen direkt aus der neuen Charge; die Target-Pflege sieht
      // den gewachsenen Radius deshalb bereits vor den Boss-Effekten.
      this.refreshLocks(dome);

      this.applyOverchargePulse(dome);
      this.applyThunderstorm(dome);
    }

    // Nach einem Stall nicht endlos nachholen: Timer auf den nächsten regulären Puls setzen.
    if (now >= dome.nextPulseAt) dome.nextPulseAt = now + interval;
  }

  private applyOverchargePulse(dome: ActiveTeslaDome): void {
    if ((dome.config.fire.overchargePulseEnabled ?? 0) <= 0) return;
    if (dome.locks.length === 0) return;
    // "5 + Charge)/2, also 3× beim ersten Impuls auf Charge 1.
    this.applyTickDamage(dome, dome.locks, ( 5 + dome.chargeStacks)/2);
  }

  // ── Gewittersturm ─────────────────────────────────────────────────────────

  private applyThunderstorm(dome: ActiveTeslaDome): void {
    if ((dome.config.fire.stormEnabled ?? 0) <= 0) return;
    if (dome.chargeStacks < 1) return;
    this.spawnStormDischarge(dome);
    this.applyLightningNova(dome);
  }

  private spawnStormDischarge(dome: ActiveTeslaDome): void {
    const spawner = this.stormProjectileSpawner;
    if (!spawner) return;
    const fire = dome.config.fire;
    const count = Math.max(0, Math.floor(fire.stormProjectileBaseCount ?? 0)) + dome.chargeStacks;
    if (count <= 0) return;

    const damage = (fire.stormProjectileDamage ?? 0) * dome.damageMultiplier;
    if (damage <= 0) return;

    // Die Homing-Ziele folgen den konfigurierten Zieltypen der Kuppel; Felsen fallen dabei raus.
    const homing = fire.stormProjectileHoming
      ? { ...fire.stormProjectileHoming, targetTypes: toHomingTargetTypes(fire.targetTypes) }
      : undefined;
    const jitter = Phaser.Math.DegToRad(Math.max(0, fire.stormProjectileAngleJitterDegrees ?? 0));
    const rangePx = this.getEffectiveRadius(dome) * (fire.stormProjectileRangeFactor ?? 1);

    // Gerichtete Salve statt Rundumschlag: die Bolzen verteilen sich gleichmäßig über einen
    // schmalen Kegel um die Blickrichtung und rotieren als Ganzes leicht, damit
    // aufeinanderfolgende Pulse nicht identisch aussehen.
    const spread = Phaser.Math.DegToRad(Math.max(0, fire.stormProjectileSpreadDegrees ?? 0));
    const salvoRotation = (this.randomSource() - 0.5) * jitter;
    const offsetPx = Math.max(0, fire.stormProjectileLateralOffsetPx ?? 0);
    const normalX = -Math.sin(dome.aimAngle);
    const normalY = Math.cos(dome.aimAngle);

    for (let index = 0; index < count; index++) {
      const offsetFromCenter = count > 1 ? index / (count - 1) - 0.5 : 0;
      const angle = dome.aimAngle + salvoRotation + offsetFromCenter * spread
        + (this.randomSource() - 0.5) * jitter;
      // Kurzer seitlicher Versatz: die Bolzen starten nebeneinander statt aus einem Punkt.
      const lateral = offsetFromCenter * 2 * offsetPx;
      spawner({
        ownerId: dome.ownerId,
        sourceSlot: dome.sourceSlot,
        weaponId: dome.config.id,
        x: dome.x + normalX * lateral,
        y: dome.y + normalY * lateral,
        angle,
        damage,
        speed: fire.stormProjectileSpeed ?? 0,
        size: fire.stormProjectileSize ?? 10,
        color: dome.color,
        rangePx,
        homing,
      });
    }
  }

  private applyLightningNova(dome: ActiveTeslaDome): void {
    const handler = this.novaHitHandler;
    if (!handler) return;
    const fire = dome.config.fire;
    const baseKnockback = fire.stormNovaKnockback ?? 0;
    const slowFraction = fire.stormNovaSlowFraction ?? 0;
    const slowDurationMs = fire.stormNovaSlowDurationMs ?? 0;
    if (baseKnockback <= 0 && slowFraction <= 0) return;

    const novaRadius = Math.max(1, this.getEffectiveRadius(dome));
    // Die Charge-Skalierung des Rückstoßes entspricht exakt der Radius-Skalierung.
    const chargeFactor = 1 + dome.chargeStacks * (fire.radiusBonusPerCharge ?? 0);

    // Die Nova erfasst jedes Ziel höchstens einmal; die Kandidatenliste ist bereits
    // radius- und sichtliniengeprüft und je logischem Ziel eindeutig.
    for (const candidate of this.collectCandidates(dome, novaRadius)) {
      const distanceFactor = (1 - Phaser.Math.Clamp(candidate.distance / novaRadius, 0, 1)) ** 2;
      handler({
        targetId: candidate.targetId,
        type: candidate.type,
        x: candidate.x,
        y: candidate.y,
        knockback: baseKnockback * chargeFactor * distanceFactor,
        slowFraction,
        slowDurationMs,
        ownerId: dome.ownerId,
      });
    }
  }

  // ── Zielverwaltung ────────────────────────────────────────────────────────

  /**
   * Hält bestehende Locks und besetzt freie Slots mit den nächstgelegenen gültigen Zielen.
   *
   * Ohne konfiguriertes Target-Limit bleibt das Verhalten unbegrenzt: Mini-Tesla und Tesla-Turm
   * bekommen weiterhin jedes erreichbare Ziel, nur mit stabiler Identität im Snapshot.
   */
  private refreshLocks(dome: ActiveTeslaDome): void {
    const radius = Math.max(1, this.getEffectiveRadius(dome));
    const candidates = this.collectCandidates(dome, radius);
    const maxTargets = Math.max(0, Math.floor(dome.config.fire.maxTargets ?? 0));

    if (maxTargets <= 0) {
      dome.locks = candidates.map((candidate, index) => ({
        targetKey: candidate.targetKey,
        slotIndex: index,
        type: candidate.type,
        x: candidate.x,
        y: candidate.y,
        targetId: candidate.targetId,
      }));
      return;
    }

    const byKey = new Map(candidates.map(candidate => [candidate.targetKey, candidate]));
    const kept: TeslaTargetLock[] = [];
    const occupiedSlots = new Set<number>();

    // Bestehende Locks überleben, solange ihr Ziel gültig ist. Näherkommende Ziele
    // verdrängen sie ausdrücklich nicht.
    for (const lock of dome.locks) {
      if (lock.slotIndex >= maxTargets) continue;
      const candidate = byKey.get(lock.targetKey);
      if (!candidate) continue;
      lock.x = candidate.x;
      lock.y = candidate.y;
      lock.type = candidate.type;
      lock.targetId = candidate.targetId;
      kept.push(lock);
      occupiedSlots.add(lock.slotIndex);
      byKey.delete(lock.targetKey);
    }

    const freeSlots: number[] = [];
    for (let slot = 0; slot < maxTargets; slot++) {
      if (!occupiedSlots.has(slot)) freeSlots.push(slot);
    }

    if (freeSlots.length > 0) {
      const available = candidates
        .filter(candidate => byKey.has(candidate.targetKey))
        .sort((left, right) => left.distance - right.distance);
      for (let index = 0; index < freeSlots.length && index < available.length; index++) {
        const candidate = available[index];
        kept.push({
          targetKey: candidate.targetKey,
          slotIndex: freeSlots[index],
          type: candidate.type,
          x: candidate.x,
          y: candidate.y,
          targetId: candidate.targetId,
        });
      }
    }

    kept.sort((left, right) => left.slotIndex - right.slotIndex);
    dome.locks = kept;
  }

  private collectCandidates(dome: ActiveTeslaDome, radius: number): TeslaTargetCandidate[] {
    const candidates: TeslaTargetCandidate[] = [];
    const fire = dome.config.fire;

    const push = (type: TeslaDomeTargetType, targetId: string, x: number, y: number, distance: number): void => {
      candidates.push({ targetKey: `${type}:${targetId}`, targetId, type, x, y, distance });
    };

    if (fire.targetTypes.includes('players')) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (player.id === dome.ownerId) continue;
        if (!player.sprite.active) continue;
        if (!this.combatSystem.isAlive(player.id)) continue;
        if (this.combatSystem.isBurrowed(player.id)) continue;
        if (!this.combatSystem.canDamageTarget(dome.ownerId, player.id)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, player.sprite.x, player.sprite.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, player.sprite.x, player.sprite.y, dome.skipRockIndex)) continue;
        push('players', player.id, player.sprite.x, player.sprite.y, dist);
      }
    }

    if (fire.targetTypes.includes('rocks') && this.rockTargetProvider) {
      for (const rock of this.rockTargetProvider()) {
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, rock.x, rock.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, rock.x, rock.y, rock.index)) continue;
        push('rocks', String(rock.index), rock.x, rock.y, dist);
      }
    }

    if (fire.targetTypes.includes('turrets') && this.turretTargetProvider) {
      for (const turret of this.turretTargetProvider()) {
        if (!this.combatSystem.canDamageTarget(dome.ownerId, turret.ownerId)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, turret.x, turret.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, turret.x, turret.y, turret.id)) continue;
        push('turrets', String(turret.id), turret.x, turret.y, dist);
      }
    }

    if (fire.targetTypes.includes('enemies') && this.enemyTargetProvider) {
      for (const enemy of this.enemyTargetProvider()) {
        if (!this.combatSystem.canDamageTarget(dome.ownerId, enemy.id)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, enemy.x, enemy.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, enemy.x, enemy.y, dome.skipRockIndex)) continue;
        push('enemies', enemy.id, enemy.x, enemy.y, dist);
      }
    }

    if (fire.targetTypes.includes('bases') && this.baseTargetProvider) {
      for (const base of this.baseTargetProvider()) {
        // The provider is intentionally filtered again here: a future caller must not be able
        // to make a Tesla dome damage friendly bases by accidentally returning all structures.
        if (base.faction !== 'hostile' || (base.isInert?.() ?? false) || base.getHp() <= 0) continue;
        const surface = base.getNearestSurfacePoint(dome.x, dome.y);
        if (!surface || surface.distance > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, surface.x, surface.y, dome.skipRockIndex)) continue;
        push('bases', base.id, surface.x, surface.y, surface.distance);
      }
    }

    if (fire.targetTypes.includes('train') && this.trainTargetProvider) {
      // Der Zug bleibt ein logisches Ziel; der Strahl-Endpunkt folgt dem nächsten Segment.
      let best: { x: number; y: number; distance: number } | null = null;
      for (const segment of this.trainTargetProvider()) {
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, segment.x, segment.y);
        if (dist > radius) continue;
        if (best && dist >= best.distance) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, segment.x, segment.y, dome.skipRockIndex)) continue;
        best = { x: segment.x, y: segment.y, distance: dist };
      }
      if (best) push('train', TRAIN_TARGET_ID, best.x, best.y, best.distance);
    }

    return candidates;
  }

  // ── Schaden ───────────────────────────────────────────────────────────────

  /**
   * Wendet einen Tesla-Tick auf die übergebenen Locks an.
   *
   * `impulseMultiplier` unterscheidet den normalen Tick (1) vom Überladungsimpuls; beide laufen
   * über denselben Schadenspfad und damit über dieselben allgemeinen Schadenssysteme.
   */
  private applyTickDamage(dome: ActiveTeslaDome, locks: readonly TeslaTargetLock[], impulseMultiplier: number): void {
    if (locks.length === 0) return;

    const focusBonus = this.resolveFocusedConductivityBonus(dome, locks.length);
    const damage = dome.config.fire.damagePerTick * focusBonus * impulseMultiplier;
    const resolvedDamage = damage * dome.damageMultiplier;
    const usesPrecomputedRuntimeMultiplier = 'sourceId' in dome;
    const targetDamage = usesPrecomputedRuntimeMultiplier
      ? resolvedDamage
      : resolvedDamage * (this.combatSystem.getPlayerRuntimeDamageMultiplier?.(dome.ownerId, dome.sourceSlot) ?? 1);

    const lockedIds = new Map<TeslaDomeTargetType, Set<string>>();
    for (const lock of locks) {
      let set = lockedIds.get(lock.type);
      if (!set) {
        set = new Set<string>();
        lockedIds.set(lock.type, set);
      }
      set.add(lock.targetId);
    }

    const playerTargets = lockedIds.get('players');
    if (playerTargets) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (!playerTargets.has(player.id)) continue;
        if (!player.sprite.active) continue;
        if (!this.combatSystem.isAlive(player.id)) continue;
        if (this.combatSystem.isBurrowed(player.id)) continue;
        if (!this.combatSystem.canDamageTarget(dome.ownerId, player.id)) continue;
        if (this.energyShieldSystem?.tryBlockDamage({
          targetId: player.id,
          category: 'tesla',
          damage: targetDamage,
          sourceX: dome.x,
          sourceY: dome.y,
          now: Date.now(),
        })) {
          continue;
        }
        this.combatSystem.applyDamage(player.id, targetDamage, false, dome.ownerId, dome.config.id, {
          sourceX: dome.x,
          sourceY: dome.y,
        }, { damageKind: 'chain', sourceSlot: dome.sourceSlot, allowCritical: true });
      }
    }

    const enemyTargets = lockedIds.get('enemies');
    if (enemyTargets && this.enemyTargetProvider) {
      for (const enemy of this.enemyTargetProvider()) {
        if (!enemyTargets.has(enemy.id)) continue;
        this.combatSystem.applyDamage(enemy.id, targetDamage, false, dome.ownerId, dome.config.id, {
          sourceX: dome.x,
          sourceY: dome.y,
        }, { damageKind: 'chain', sourceSlot: dome.sourceSlot, allowCritical: true });
      }
    }

    const baseTargets = lockedIds.get('bases');
    if (baseTargets && this.baseTargetProvider && this.baseDamageHandler) {
      for (const base of this.baseTargetProvider()) {
        if (base.faction !== 'hostile' || (base.isInert?.() ?? false) || base.getHp() <= 0) continue;
        if (!baseTargets.has(base.id)) continue;
        // Bases use the ordinary Tesla tick. In particular, rockDamageMult must not bleed
        // into this target class; the central base path applies Coop modifiers afterwards.
        this.baseDamageHandler(base.id, resolvedDamage, dome.ownerId, dome.sourceSlot);
      }
    }

    const rockTargets = lockedIds.get('rocks');
    const rockDamage = resolvedDamage * (dome.config.rockDamageMult ?? 1);
    if (rockDamage > 0 && rockTargets && this.rockTargetProvider && this.rockDamageHandler) {
      for (const rock of this.rockTargetProvider()) {
        if (!rockTargets.has(String(rock.index))) continue;
        this.rockDamageHandler(rock.index, rockDamage, dome.ownerId);
      }
    }

    const turretTargets = lockedIds.get('turrets');
    const turretDamage = resolvedDamage * (dome.config.rockDamageMult ?? 1);
    if (turretDamage > 0 && turretTargets && this.turretTargetProvider && this.turretDamageHandler) {
      for (const turret of this.turretTargetProvider()) {
        if (!this.combatSystem.canDamageTarget(dome.ownerId, turret.ownerId)) continue;
        if (!turretTargets.has(String(turret.id))) continue;
        this.turretDamageHandler(turret.id, turretDamage, dome.ownerId);
      }
    }

    const trainDamage = resolvedDamage * (dome.config.trainDamageMult ?? 1);
    if (trainDamage > 0 && lockedIds.has('train') && this.trainDamageHandler) {
      this.trainDamageHandler(trainDamage, dome.ownerId);
    }
  }

  /**
   * Fokussierte Leitfähigkeit: jeder freie Strahl verstärkt die verbleibenden Primärstrahlen.
   *
   * Ohne konfiguriertes Target-Limit gibt es keine freien Strahlen und damit keinen Bonus –
   * Mini-Tesla und Tesla-Turm bleiben unberührt.
   */
  private resolveFocusedConductivityBonus(dome: ActiveTeslaDome, activeTargets: number): number {
    const maxTargets = Math.max(0, Math.floor(dome.config.fire.maxTargets ?? 0));
    const bonusPerFreeTarget = dome.config.fire.focusedDamageBonusPerFreeTarget ?? 0;
    if (maxTargets <= 0 || bonusPerFreeTarget <= 0) return 1;
    const freeTargets = Math.max(0, maxTargets - activeTargets);
    return 1 + freeTargets * bonusPerFreeTarget;
  }

  private hasLineOfSight(
    fire: TeslaDomeWeaponFireConfig,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    skipRockIndex?: number,
  ): boolean {
    if (!fire.requireLineOfSight) return true;
    if (!this.lineOfSightChecker) return true;
    return this.lineOfSightChecker(sx, sy, ex, ey, skipRockIndex);
  }

  private getEffectiveRadius(dome: ActiveTeslaDome): number {
    return dome.config.fire.radius
      * (1 + dome.chargeStacks * (dome.config.fire.radiusBonusPerCharge ?? 0));
  }
}

/**
 * Puls- und Charge-Fortschritt teilen sich denselben Timer.
 *
 * Das Intervall ist Basiswert der Waffe; erst eine MaxCharge > 0 schaltet die Feldladung
 * überhaupt frei. Mini-Tesla und Tesla-Turm bleiben damit ohne Puls.
 */
function getPulseIntervalMs(fire: TeslaDomeWeaponFireConfig): number {
  if (Math.floor(fire.maxChargeStacks ?? 0) <= 0) return 0;
  return Math.max(0, fire.chargeIntervalMs ?? 0);
}

export function resolveMovementSlowFactor(fire: TeslaDomeWeaponFireConfig, chargeStacks: number): number {
  const recovery = fire.movementRecoveryPerCharge ?? 0;
  if (recovery <= 0) return fire.movementSlowFactor;
  return Math.min(1, fire.movementSlowFactor + recovery * chargeStacks);
}

/** Zieltypen der Kuppel auf die Homing-Zieltypen abbilden; Felsen sind kein Homing-Ziel. */
export function toHomingTargetTypes(
  targetTypes: readonly TeslaDomeTargetType[],
): readonly HomingTargetType[] {
  return targetTypes.filter((type): type is Exclude<TeslaDomeTargetType, 'rocks'> => type !== 'rocks');
}

function constructionVisualId(sourceId: number): string {
  return `tesla-turret:${sourceId}`;
}
