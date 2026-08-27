import * as Phaser from 'phaser';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { CombatSystem } from './CombatSystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from './CoopDefenseEnemyTrainAwarenessSystem';
import type { PlacementSystem } from './PlacementSystem';
import type { EnemyAiTargetCatalog, EnemyAiTargetRef } from './EnemyAiTargetCatalog';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { COLORS, PLAYER_SIZE } from '../config';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';

type EnemyAttackTargetKind = 'base' | 'player' | 'decoy' | 'ally' | 'train' | 'obstacle';

interface EnemyAttackCandidate {
  readonly kind: EnemyAttackTargetKind;
  readonly priority: 1 | 2 | 3 | 4;
  readonly distance: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetId?: string;
  readonly targetRef?: EnemyAiTargetRef;
  readonly obstacle?: RockPhysicsProxy;
}

interface SustainedEnemyAttackState {
  readonly weaponId: string;
  readonly targetRef: EnemyAiTargetRef | null;
  readonly targetId: string | null;
  targetX: number;
  targetY: number;
  readonly fireUntil: number;
  lastShotAt: number;
}

interface PlayerTargetLockState {
  readonly targetRef: EnemyAiTargetRef;
  readonly lockedUntil: number;
}

interface MeleeWindupState {
  readonly weaponId: string;
  readonly targetRef: EnemyAiTargetRef;
  readonly aimAngle: number;
  readonly executeAt: number;
}

interface EnemyMovementProgressState {
  anchorX: number;
  anchorY: number;
  /**
   * Aufsummierte Zeit ohne Ortsveränderung, in der der Gegner laufen wollte oder von der
   * Wegfindung keine Route bekam. Freiwilliges Stehenbleiben – Angriffspause, Gefechtsabstand –
   * zählt bewusst nicht mit, setzt den Zähler aber auch nicht zurück: Ein dauerfeuernder
   * Fernkämpfer würde sonst nie bemerken, dass er in einem Felsen klemmt.
   */
  blockedMs: number;
  clearingObstacle: RockPhysicsProxy | null;
}

interface EnemyObstacleContactState {
  readonly obstacle: RockPhysicsProxy;
  readonly lastContactAt: number;
}

/** Laufende Salve eines Gegners; pro Gegner kann nur eine Waffe gleichzeitig salvieren. */
interface EnemySalvoState {
  readonly weaponId: string;
  shotsFired: number;
  nextShotAt: number;
  /** Verfaellt die Salve ohne Nachschuss (Ziel weg, keine Sichtlinie), gilt sie als abgefeuert. */
  expiresAt: number;
}

export class CoopDefenseEnemyAttackSystem {
  private static readonly MOVEMENT_PROGRESS_DISTANCE_PX = 4;
  private static readonly OBSTACLE_CONTACT_FRESHNESS_MS = 150;
  /**
   * Hysterese der Mindest-Zieldistanz: eine bereits laufende Salve darf bis zu dieser Strecke
   * unterhalb ihrer Untergrenze weiterfeuern. Ohne den Puffer bricht ein Gegner seine Salve ab,
   * sobald sein Ziel einen Schritt zu nah kommt, und wechselt hektisch die Waffe.
   */
  private static readonly SALVO_MIN_DISTANCE_HYSTERESIS_PX = 60;
  /**
   * Verliert ein Gegner mitten in der Salve sein Ziel, laeuft sie nach diesem Vielfachen ihres
   * Schusstakts aus und startet ihre Pause – sonst bliebe ein halb verbrauchter Zaehler beliebig
   * lange stehen und die naechste Salve waere zu kurz.
   */
  private static readonly SALVO_GAP_TOLERANCE_FACTOR = 5;
  private static readonly MIN_SALVO_GAP_TOLERANCE_MS = 1_000;
  /** Prevents near-equal player distances from causing visible target oscillation. */
  private static readonly PLAYER_TARGET_LOCK_DURATION_MS = 2_000;

  private readonly sustainedAttacks = new Map<string, SustainedEnemyAttackState>();
  private readonly salvoStates = new Map<string, EnemySalvoState>();
  private readonly playerTargetLocks = new Map<string, PlayerTargetLockState>();
  private readonly meleeWindups = new Map<string, MeleeWindupState>();
  private readonly movementProgress = new Map<string, EnemyMovementProgressState>();
  private readonly obstacleContacts = new Map<string, EnemyObstacleContactState>();
  private actionBlockedChecker: ((enemyId: string) => boolean) | null = null;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly baseManager: BaseManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly getRockObjects: () => readonly (RockPhysicsProxy | null)[] | null,
    private readonly trainAwarenessSystem: CoopDefenseEnemyTrainAwarenessSystem | null = null,
    private readonly placementSystem: PlacementSystem | null = null,
    private readonly targetCatalog: EnemyAiTargetCatalog | null = null,
  ) {}

  setActionBlockedChecker(checker: ((enemyId: string) => boolean) | null): void {
    this.actionBlockedChecker = checker;
  }

  recordObstacleContact(enemyId: string, obstacle: RockPhysicsProxy, now: number): void {
    if (!obstacle.active || !this.enemyManager.hasEnemy(enemyId)) return;
    this.obstacleContacts.set(enemyId, { obstacle, lastContactAt: now });
  }

  hostUpdate(delta: number, now: number): void {
    const activeEnemyIds = new Set<string>();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active) continue;
      if (enemy.faction !== 'hostile') continue;
      activeEnemyIds.add(enemy.id);
      enemy.decayWeaponSpread(delta, now);
      this.expireStaleSalvo(enemy, now);

      if (this.actionBlockedChecker?.(enemy.id)) {
        this.abortCombat(enemy, now);
        // Die Sperre gehoert ausschliesslich dem Angriffssystem. Exklusive Spezialbewegungen
        // (etwa die Jagd des Zeitbombendachses) wurden bereits vom EnemyManager gesetzt und
        // duerfen hier im spaeteren Host-Update nicht wieder auf null geschrieben werden.
        continue;
      }

      // Eingebuddelt gilt dieselbe Waffensperre wie beim Spieler.
      if (enemy.isBurrowed()) {
        this.abortCombat(enemy, now);
        continue;
      }

      if (this.enemyManager.isEnemyPanicking(enemy.id)) {
        this.abortCombat(enemy, now);
        continue;
      }

      if (this.trainAwarenessSystem?.blocksRegularAttacks(enemy.id)) {
        this.abortCombat(enemy, now);
        continue;
      }

      if (this.meleeWindups.has(enemy.id)) {
        this.resetMovementProgress(enemy);
        this.updateMeleeWindup(enemy, now);
        continue;
      }

      this.updateMovementProgress(enemy, delta, now);

      // Eine laufende Salve haelt ihren eigenen Takt. Ohne diesen Vorrang wuerde sie auf das
      // Zielscan-Raster des Gegners einrasten und langsamer feuern als konfiguriert.
      if (this.continueSalvo(enemy, now)) continue;

      if (!enemy.canScanForAttack(now)) continue;

      enemy.scheduleNextAttackScan(now);
      const sustained = this.getSustainedAttack(enemy, now);
      const attack = sustained.active ? sustained.attack : this.selectAttack(enemy, now);
      if (!attack) continue;

      if (this.shouldStartMeleeWindup(attack)) {
        this.startMeleeWindup(enemy, attack, now);
        continue;
      }

      this.fireAttack(enemy, attack, now);
    }

    this.cleanupInactiveEnemies(activeEnemyIds);
  }

  /**
   * Setzt den Gefechtszustand eines Gegners zurueck, der in diesem Frame nicht angreifen darf.
   * Eine unterbrochene Salve zaehlt dabei als verbraucht: ihre Pause wird sofort gestartet,
   * damit ein wiederholt blockierter Gegner nicht beliebig viele Salven ohne Cooldown feuert.
   */
  private abortCombat(enemy: EnemyEntity, now: number): void {
    this.finishSalvo(enemy, now);
    this.sustainedAttacks.delete(enemy.id);
    this.playerTargetLocks.delete(enemy.id);
    this.meleeWindups.delete(enemy.id);
    this.obstacleContacts.delete(enemy.id);
    this.resetMovementProgress(enemy);
  }

  /** Beendet eine laufende Salve und sperrt ihre Waffe fuer die konfigurierte Pause. */
  private finishSalvo(enemy: EnemyEntity, now: number): void {
    const state = this.salvoStates.get(enemy.id);
    if (!state) return;
    this.salvoStates.delete(enemy.id);
    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    if (attackWeapon?.salvo) enemy.lockWeaponUntil(attackWeapon.weapon, now + attackWeapon.salvo.cooldownMs);
  }

  /**
   * Feuert den naechsten Schuss einer laufenden Salve, sobald ihr Takt es zulaesst. Der Rueckgabe-
   * wert meldet, dass die Salve den Gegner in diesem Frame beansprucht – waehrenddessen waehlt er
   * keine andere Waffe. Verliert er sein Ziel, laeuft die Salve ueber ihre Verfallszeit aus.
   */
  private continueSalvo(enemy: EnemyEntity, now: number): boolean {
    const state = this.salvoStates.get(enemy.id);
    if (!state) return false;

    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    if (!attackWeapon?.salvo) {
      this.salvoStates.delete(enemy.id);
      return false;
    }
    if (now < state.nextShotAt || !enemy.isWeaponReady(attackWeapon.weapon, now)) return true;

    // Ohne gueltiges Ziel gibt die Salve den Gegner frei, statt ihn zu blockieren: kommt ihm ein
    // Spieler unter die Mindestdistanz, soll er sofort auf den Hoellenwerfer wechseln duerfen.
    // Der Zaehler bleibt bis zur Verfallszeit stehen, damit sie nach kurzem Sichtverlust weiterlaeuft.
    const target = this.resolveWeaponTarget(enemy, attackWeapon, now, state.shotsFired);
    if (!target) return false;

    this.fireAttack(enemy, { attackWeapon, target }, now);
    return true;
  }

  private expireStaleSalvo(enemy: EnemyEntity, now: number): void {
    const state = this.salvoStates.get(enemy.id);
    if (state && now >= state.expiresAt) this.finishSalvo(enemy, now);
  }

  private isSalvoInProgress(enemyId: string, weaponId: string): boolean {
    return this.salvoStates.get(enemyId)?.weaponId === weaponId;
  }

  private shouldStartMeleeWindup(attack: SelectedEnemyAttack): boolean {
    return (attack.target.kind === 'player' || attack.target.kind === 'decoy')
      && attack.attackWeapon.weapon.config.fire.type === 'melee'
      && attack.attackWeapon.playerMeleeWindupMs > 0
      && attack.target.targetRef !== undefined;
  }

  private startMeleeWindup(enemy: EnemyEntity, attack: SelectedEnemyAttack, now: number): void {
    const targetRef = attack.target.targetRef;
    if (!targetRef) return;

    const aimAngle = Phaser.Math.Angle.Between(
      enemy.sprite.x,
      enemy.sprite.y,
      attack.target.targetX,
      attack.target.targetY,
    );
    this.meleeWindups.set(enemy.id, {
      weaponId: attack.attackWeapon.weapon.config.id,
      targetRef,
      aimAngle,
      executeAt: now + attack.attackWeapon.playerMeleeWindupMs,
    });
    this.resetMovementProgress(enemy);
    enemy.stopMovement();
    enemy.faceAngle(aimAngle);
  }

  private updateMeleeWindup(enemy: EnemyEntity, now: number): void {
    const state = this.meleeWindups.get(enemy.id);
    if (!state) return;

    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    const target = this.buildPlayerLikeTargetCandidate(enemy, state.targetRef, attackWeapon?.weapon.config.range ?? 0);
    if (
      !attackWeapon
      || attackWeapon.weapon.config.fire.type !== 'melee'
      || !target
    ) {
      this.meleeWindups.delete(enemy.id);
      return;
    }

    enemy.stopMovement();
    enemy.faceAngle(state.aimAngle);
    if (now < state.executeAt) return;

    this.meleeWindups.delete(enemy.id);
    if (!enemy.isWeaponReady(attackWeapon.weapon, now)) return;

    this.fireAttack(
      enemy,
      {
        attackWeapon,
        target: {
          kind: target.kind,
          priority: 2,
          distance: target.distance,
          targetX: target.targetX,
          targetY: target.targetY,
          targetId: target.targetId,
          targetRef: target.targetRef,
        },
      },
      now,
      state.aimAngle,
    );
  }

  private fireAttack(
    enemy: EnemyEntity,
    attack: SelectedEnemyAttack,
    now: number,
    forcedAngle?: number,
  ): void {
    const { attackWeapon, target } = attack;
    const weapon = attackWeapon.weapon;
    const angle = forcedAngle ?? Phaser.Math.Angle.Between(
      enemy.sprite.x,
      enemy.sprite.y,
      target.targetX,
      target.targetY,
    );
    enemy.faceAngle(angle);

    const didFire = this.loadoutManager.fireAutomatedWeapon(
      weapon.config,
      enemy.sprite.x,
      enemy.sprite.y,
      angle + enemy.rollWeaponSpreadOffset(weapon),
      target.targetX,
      target.targetY,
      enemy.id,
      COLORS.RED_2,
    );
    if (!didFire) return;

    enemy.pauseAttackMovement(now, attackWeapon.attackMovementSpeedFactor);
    enemy.recordWeaponUse(weapon, now);
    this.advanceSalvo(enemy, attackWeapon, now);
    this.updateObstacleClearingState(enemy, target);

    const existingSustainedAttack = this.sustainedAttacks.get(enemy.id);
    if (existingSustainedAttack) {
      existingSustainedAttack.lastShotAt = now;
    } else if (attackWeapon.minimumFireDurationMs > 0 && (target.targetRef || target.targetId)) {
      this.sustainedAttacks.set(enemy.id, {
        weaponId: weapon.config.id,
        targetRef: target.targetRef ?? null,
        targetId: target.targetId ?? null,
        targetX: target.targetX,
        targetY: target.targetY,
        fireUntil: now + attackWeapon.minimumFireDurationMs,
        lastShotAt: now,
      });
    }
  }

  /**
   * Zaehlt einen Salvenschuss. Der Waffen-Cooldown taktet die Einzelschuesse; erst nach dem
   * letzten Schuss uebernimmt die Salvenpause.
   */
  private advanceSalvo(enemy: EnemyEntity, attackWeapon: EnemyAttackWeapon, now: number): void {
    const salvo = attackWeapon.salvo;
    if (!salvo) return;

    const weaponId = attackWeapon.weapon.config.id;
    const current = this.salvoStates.get(enemy.id);
    const shotsFired = (current?.weaponId === weaponId ? current.shotsFired : 0) + 1;
    this.salvoStates.set(enemy.id, {
      weaponId,
      shotsFired,
      nextShotAt: now + salvo.intervalMs,
      expiresAt: now + Math.max(
        CoopDefenseEnemyAttackSystem.MIN_SALVO_GAP_TOLERANCE_MS,
        salvo.intervalMs * CoopDefenseEnemyAttackSystem.SALVO_GAP_TOLERANCE_FACTOR,
      ),
    });
    if (shotsFired >= salvo.count) this.finishSalvo(enemy, now);
  }

  /**
   * Merkt sich den Felsen, an dem der Gegner gerade arbeitet. Bewusst ohne Reset des
   * Blockier-Zählers: ein festhängender Fernkämpfer schießt weiter auf Spieler und würde sich
   * sonst mit jedem Schuss selbst wieder als „nicht blockiert" einstufen.
   */
  private updateObstacleClearingState(enemy: EnemyEntity, target: EnemyAttackCandidate): void {
    const progress = this.ensureMovementProgress(enemy);
    progress.clearingObstacle = target.kind === 'obstacle' && target.obstacle?.active
      ? target.obstacle
      : null;
  }

  /** Bestes Ziel einer einzelnen Waffe nach ihrem Zielmodus, inklusive Zug und Mindestdistanz. */
  private resolveWeaponTarget(
    enemy: EnemyEntity,
    attackWeapon: EnemyAttackWeapon,
    now: number,
    salvoShotIndex?: number,
  ): EnemyAttackCandidate | null {
    const weapon = attackWeapon.weapon;
    const distributesTargets = attackWeapon.targetMode === 'players'
      && attackWeapon.salvo?.targetDistribution === 'round_robin';
    let target = distributesTargets
      ? this.findDistributedPlayerTarget(
        enemy,
        weapon.config.range,
        attackWeapon.minTargetDistancePx,
        salvoShotIndex ?? 0,
      )
      : attackWeapon.targetMode === 'players'
        ? this.findLivingTargetWithLock(enemy, weapon.config.range, now)
      : attackWeapon.targetMode === 'rocks'
        ? this.findNearestObstacleTarget(enemy, weapon.config.range, now)
        : attackWeapon.targetMode === 'structures'
          ? this.selectStructureTarget(enemy, weapon.config.range, now)
          : this.selectTarget(enemy, weapon.config.range, now);
    const trainTarget = (weapon.config.trainDamageMult ?? 1) > 0
      ? this.findTrainTarget(enemy, weapon.config.range)
      : null;
    if (this.isBetterCandidate(trainTarget, target)) target = trainTarget;
    if (!target || !this.isWithinWeaponMinDistance(enemy, attackWeapon, target)) return null;
    return target;
  }

  private selectAttack(enemy: EnemyEntity, now: number): SelectedEnemyAttack | null {
    // Die Konfigurationsreihenfolge ist zugleich die Waffenpriorität:
    // Die erste Waffe mit einem gültigen Ziel gewinnt.
    let higherPriorityWeaponBusy = false;
    for (const attackWeapon of enemy.getAttackWeapons()) {
      const weapon = attackWeapon.weapon;
      if (weapon.config.fire.type === 'healing_aura' || weapon.config.fire.type === 'tesla_dome') continue;
      const target = this.resolveWeaponTarget(enemy, attackWeapon, now);
      if (!target) continue;
      // Existiert ein Ziel fuer eine hoeher priorisierte Waffe, wartet der
      // Gegner deren Cooldown ab, statt im Nahkampf auf Fernkampf zu wechseln.
      if (!enemy.isWeaponReady(weapon, now)) {
        higherPriorityWeaponBusy = true;
        continue;
      }
      // Ausnahme: Felsen freibeissen und Basen angreifen. Ein blockierter Gegner muss sich
      // befreien bzw. weiter an seiner strategischen Basis arbeiten duerfen.
      if (
        higherPriorityWeaponBusy
        && target.kind !== 'obstacle'
        && target.kind !== 'base'
      ) return null;
      return { attackWeapon, target };
    }

    return null;
  }

  /**
   * Mindest-Zieldistanz einer Waffe. Eine laufende Salve darf mit Hysterese unter die Grenze
   * feuern, damit ein herankommendes Ziel sie nicht mitten im Takt abbricht.
   */
  private isWithinWeaponMinDistance(
    enemy: EnemyEntity,
    attackWeapon: EnemyAttackWeapon,
    target: EnemyAttackCandidate,
  ): boolean {
    if (attackWeapon.minTargetDistancePx <= 0) return true;
    const hysteresis = attackWeapon.salvo?.targetDistribution === 'round_robin'
      ? 0
      : this.isSalvoInProgress(enemy.id, attackWeapon.weapon.config.id)
      ? CoopDefenseEnemyAttackSystem.SALVO_MIN_DISTANCE_HYSTERESIS_PX
      : 0;
    return target.distance >= attackWeapon.minTargetDistancePx - hysteresis;
  }

  /**
   * Zielauswahl fuer breit gestreute Salven. Die Kandidaten werden nach Distanz und ID sortiert,
   * damit Host-Wiederholungen stabil bleiben; der Schussindex rotiert anschliessend ueber die
   * verbleibenden, ausserhalb der Mindestdistanz liegenden Spieler.
   */
  private findDistributedPlayerTarget(
    enemy: EnemyEntity,
    range: number,
    minTargetDistancePx: number,
    salvoShotIndex: number,
  ): EnemyAttackCandidate | null {
    const candidates: EnemyAttackCandidate[] = [];
    if (this.targetCatalog) {
      this.targetCatalog.forEachTarget('player-like', (target) => {
        const candidate = this.buildPlayerLikeTargetCandidate(enemy, { kind: target.kind, id: target.id }, range);
        if (!candidate || candidate.distance < minTargetDistancePx) return;
        candidates.push(candidate);
      });
    } else {
      for (const player of this.playerManager.getAllPlayers()) {
        const candidate = this.buildPlayerTargetCandidate(enemy, player.id, range);
        if (!candidate || candidate.distance < minTargetDistancePx) continue;
        candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => left.distance - right.distance || this.targetKey(left).localeCompare(this.targetKey(right)));
    return candidates.length > 0 ? candidates[salvoShotIndex % candidates.length] : null;
  }

  private getSustainedAttack(
    enemy: EnemyEntity,
    now: number,
  ): { active: boolean; attack: SelectedEnemyAttack | null } {
    const state = this.sustainedAttacks.get(enemy.id);
    if (!state) return { active: false, attack: null };
    if (now >= state.fireUntil && state.lastShotAt >= state.fireUntil) {
      this.sustainedAttacks.delete(enemy.id);
      return { active: false, attack: null };
    }

    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    if (!attackWeapon) {
      this.sustainedAttacks.delete(enemy.id);
      return { active: false, attack: null };
    }
    if (!enemy.isWeaponReady(attackWeapon.weapon, now)) {
      return { active: true, attack: null };
    }

    const playerTarget = state.targetRef
      ? this.buildPlayerLikeTargetCandidate(enemy, state.targetRef, attackWeapon.weapon.config.range)
      : null;
    const ally = state.targetId ? this.enemyManager.getEnemy(state.targetId) : null;
    const allyTarget = !playerTarget && ally?.faction === 'allied'
      ? this.buildAllyTargetCandidate(enemy, ally, attackWeapon.weapon.config.range)
      : null;
    const sustainedTarget = playerTarget ?? allyTarget;
    if (!sustainedTarget) {
      this.sustainedAttacks.delete(enemy.id);
      this.playerTargetLocks.delete(enemy.id);
      return { active: false, attack: null };
    }

    state.targetX = sustainedTarget.targetX;
    state.targetY = sustainedTarget.targetY;

    return {
      active: true,
      attack: {
        attackWeapon,
        target: sustainedTarget,
      },
    };
  }

  private selectTarget(enemy: EnemyEntity, range: number, now: number): EnemyAttackCandidate | null {
    let best = this.findNearestBaseTarget(enemy, range);

    const armedConstruct = this.findNearestArmedConstructTarget(enemy, range);
    if (this.isBetterCandidate(armedConstruct, best)) best = armedConstruct;

    const obstacle = this.findNearestObstacleTarget(enemy, range, now);
    if (this.isBetterCandidate(obstacle, best)) {
      best = obstacle;
    }

    const livingTarget = this.findLivingTargetWithLock(enemy, range, now);
    if (this.isBetterCandidate(livingTarget, best)) {
      best = livingTarget;
    }

    return best;
  }

  /** Wie {@link selectTarget}, aber ohne Spieler und Verbuendete – reine Belagerungsziele. */
  private selectStructureTarget(enemy: EnemyEntity, range: number, now: number): EnemyAttackCandidate | null {
    const best = this.findNearestBaseTarget(enemy, range);
    const obstacle = this.findNearestObstacleTarget(enemy, range, now);
    return this.isBetterCandidate(obstacle, best) ? obstacle : best;
  }

  private findNearestBaseTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;
    const strategicTarget = getCoopDefenseEnemyConfig(enemy.kind).movementTarget;

    // Gegnerbasen sind fuer Zombies kein Ziel; sie gehoeren derselben Fraktion.
    for (const base of this.baseManager.getBasesByFaction('friendly')) {
      if ((base.isInert?.() ?? false) || base.getHp() <= 0) continue;
      if (
        strategicTarget === 'players-and-armed-constructs'
        && (base.role !== 'outpost' || base.getTurrets().length === 0)
      ) continue;

      const surface = base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y);
      if (!surface) continue;
      const targetX = surface.x;
      const targetY = surface.y;
      const distance = surface.distance;
      if (distance > range) continue;
      if (!this.combatSystem.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, targetX, targetY)) continue;

      const candidate: EnemyAttackCandidate = {
        kind: 'base',
        priority: strategicTarget === 'players-and-armed-constructs' ? 2 : 1,
        distance,
        targetX,
        targetY,
      };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private findNearestArmedConstructTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    if (getCoopDefenseEnemyConfig(enemy.kind).movementTarget !== 'players-and-armed-constructs') return null;
    const rockObjects = this.getRockObjects() ?? [];
    let best: EnemyAttackCandidate | null = null;
    for (const construction of this.placementSystem?.getAllRuntimeRocks() ?? []) {
      if (construction.hp <= 0 || construction.kind !== 'turret') continue;
      const obstacle = rockObjects[construction.id];
      if (!obstacle?.active) continue;
      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, obstacle.x, obstacle.y);
      if (distance > range) continue;
      if (!this.combatSystem.hasClearLineOfFire(
        enemy.sprite.x,
        enemy.sprite.y,
        obstacle.x,
        obstacle.y,
        { skipRockIndex: construction.id },
      )) continue;
      const candidate: EnemyAttackCandidate = {
        kind: 'obstacle',
        priority: 2,
        distance,
        targetX: obstacle.x,
        targetY: obstacle.y,
        obstacle,
      };
      if (this.isBetterCandidate(candidate, best)) best = candidate;
    }
    return best;
  }

  private findNearestObstacleTarget(enemy: EnemyEntity, range: number, now: number): EnemyAttackCandidate | null {
    if (!this.isObstacleAttackUnlocked(enemy)) return null;

    const rockObjects = this.getRockObjects() ?? [];
    const progress = this.movementProgress.get(enemy.id);
    const clearingCandidate = progress?.clearingObstacle
      ? this.buildObstacleCandidate(enemy, progress.clearingObstacle, rockObjects, range)
      : null;
    if (clearingCandidate) return clearingCandidate;

    const contact = this.obstacleContacts.get(enemy.id);
    if (contact && now - contact.lastContactAt <= CoopDefenseEnemyAttackSystem.OBSTACLE_CONTACT_FRESHNESS_MS) {
      const contactCandidate = this.buildObstacleCandidate(enemy, contact.obstacle, rockObjects, range);
      if (contactCandidate) return contactCandidate;
    } else if (contact) {
      this.obstacleContacts.delete(enemy.id);
    }

    let best: EnemyAttackCandidate | null = null;
    for (let index = 0; index < rockObjects.length; index += 1) {
      const rock = rockObjects[index];
      if (!rock?.active) continue;

      const candidate = this.buildObstacleCandidate(enemy, rock, rockObjects, range, index);
      if (candidate && this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private buildObstacleCandidate(
    enemy: EnemyEntity,
    obstacle: RockPhysicsProxy,
    rockObjects: readonly (RockPhysicsProxy | null)[],
    range: number,
    knownIndex?: number,
  ): EnemyAttackCandidate | null {
    if (!obstacle.active) return null;
    const index = knownIndex ?? rockObjects.indexOf(obstacle);
    if (index < 0) return null;

    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, obstacle.x, obstacle.y);
    if (distance > range) return null;
    if (!this.combatSystem.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, obstacle.x, obstacle.y, { skipRockIndex: index })) return null;

    return {
      kind: 'obstacle',
      priority: 4,
      distance,
      targetX: obstacle.x,
      targetY: obstacle.y,
      obstacle,
    };
  }

  private findNearestPlayerTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;

    if (this.targetCatalog) {
      this.targetCatalog.forEachTarget('player-like', (target) => {
        const candidate = this.buildPlayerLikeTargetCandidate(enemy, {
          kind: target.kind,
          id: target.id,
        }, range);
        if (candidate && this.isBetterCandidate(candidate, best)) best = candidate;
      });
      return best;
    }

    for (const player of this.playerManager.getAllPlayers()) {
      const candidate = this.buildPlayerTargetCandidate(enemy, player.id, range);
      if (candidate && this.isBetterCandidate(candidate, best)) best = candidate;
    }

    return best;
  }

  private findNearestLivingTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best = this.findNearestPlayerTarget(enemy, range);
    for (const ally of this.enemyManager.getAlliedEnemies()) {
      const candidate = this.buildAllyTargetCandidate(enemy, ally, range);
      if (!candidate) continue;
      if (this.isBetterCandidate(candidate, best)) best = candidate;
    }
    return best;
  }

  private findLivingTargetWithLock(
    enemy: EnemyEntity,
    range: number,
    now: number,
  ): EnemyAttackCandidate | null {
    const lockedTarget = this.getLockedPlayerTarget(enemy, range, now);
    if (lockedTarget) return lockedTarget;

    const target = this.findNearestLivingTarget(enemy, range);
    if ((target?.kind === 'player' || target?.kind === 'decoy') && target.targetRef) {
      this.playerTargetLocks.set(enemy.id, {
        targetRef: target.targetRef,
        lockedUntil: now + CoopDefenseEnemyAttackSystem.PLAYER_TARGET_LOCK_DURATION_MS,
      });
    }
    return target;
  }

  private getLockedPlayerTarget(
    enemy: EnemyEntity,
    range: number,
    now: number,
  ): EnemyAttackCandidate | null {
    const lock = this.playerTargetLocks.get(enemy.id);
    if (!lock) return null;
    if (now >= lock.lockedUntil) {
      this.playerTargetLocks.delete(enemy.id);
      return null;
    }

    const target = this.buildPlayerLikeTargetCandidate(enemy, lock.targetRef, range);
    if (!target) this.playerTargetLocks.delete(enemy.id);
    return target;
  }

  private buildPlayerTargetCandidate(
    enemy: EnemyEntity,
    playerId: string,
    range: number,
  ): EnemyAttackCandidate | null {
    return this.buildPlayerLikeTargetCandidate(enemy, { kind: 'player', id: playerId }, range);
  }

  private buildPlayerLikeTargetCandidate(
    enemy: EnemyEntity,
    targetRef: EnemyAiTargetRef,
    range: number,
  ): EnemyAttackCandidate | null {
    if (targetRef.kind === 'player' && !this.targetCatalog) {
      const player = this.playerManager.getPlayer(targetRef.id);
      if (!player || !this.isValidPlayerTarget(enemy, targetRef.id, range)) return null;
      return {
        kind: 'player',
        priority: 2,
        distance: Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.x, player.y),
        targetX: player.x,
        targetY: player.y,
        targetId: player.id,
        targetRef,
      };
    }

    const target = this.targetCatalog?.resolve(targetRef);
    if (!target || (target.kind !== 'player' && target.kind !== 'decoy')) return null;
    const position = target.resolvePosition?.(enemy.sprite.x, enemy.sprite.y) ?? { x: target.x, y: target.y };
    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, position.x, position.y);
    if (distance > range + (target.radius ?? PLAYER_SIZE * 0.5)) return null;
    if (!this.combatSystem.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, position.x, position.y)) return null;
    return {
      kind: target.kind,
      priority: 2,
      distance,
      targetX: position.x,
      targetY: position.y,
      targetId: target.kind === 'player' ? target.id : undefined,
      targetRef,
    };
  }

  private buildAllyTargetCandidate(
    enemy: EnemyEntity,
    ally: EnemyEntity,
    range: number,
  ): EnemyAttackCandidate | null {
    if (!ally.sprite.active || !this.combatSystem.isAlive(ally.id)) return null;
    if (!this.combatSystem.canDamageTarget(enemy.id, ally.id)) return null;

    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, ally.sprite.x, ally.sprite.y);
    if (distance > range || !this.combatSystem.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, ally.sprite.x, ally.sprite.y)) {
      return null;
    }

    return {
      kind: 'ally',
      priority: 2,
      distance,
      targetX: ally.sprite.x,
      targetY: ally.sprite.y,
      targetId: ally.id,
    };
  }

  private isValidPlayerTarget(enemy: EnemyEntity, playerId: string, range: number): boolean {
    const player = this.playerManager.getPlayer(playerId);
    if (!player?.active) return false;
    if (!this.combatSystem.isAlive(player.id)) return false;
    if (this.combatSystem.isBurrowed(player.id)) return false;
    if (this.targetCatalog?.isTargetValid({ kind: 'player', id: playerId }) === false) return false;
    if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) return false;

    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.x, player.y);
    if (distance > range + PLAYER_SIZE * 0.5) return false;
    return this.combatSystem.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, player.x, player.y);
  }

  private findTrainTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    const target = this.trainAwarenessSystem?.getTrainAttackTarget(enemy);
    if (!target || target.distance > range) return null;
    // Bewusst die Sichtlinie: der Zug ist hier das Ziel und würde sich in der Schusslinie
    // selbst verdecken.
    if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, target.x, target.y)) return null;
    return {
      kind: 'train',
      priority: 3,
      distance: target.distance,
      targetX: target.x,
      targetY: target.y,
    };
  }

  private updateMovementProgress(enemy: EnemyEntity, delta: number, now: number): void {
    const progress = this.ensureMovementProgress(enemy);
    if (progress.clearingObstacle && !progress.clearingObstacle.active) {
      this.resetMovementProgress(enemy);
      return;
    }

    const movedDistance = Phaser.Math.Distance.Between(
      progress.anchorX,
      progress.anchorY,
      enemy.sprite.x,
      enemy.sprite.y,
    );
    if (movedDistance >= CoopDefenseEnemyAttackSystem.MOVEMENT_PROGRESS_DISTANCE_PX) {
      this.resetMovementProgress(enemy);
      return;
    }

    // Ein Gegner ohne Route steht auch dann fest, wenn seine Wunschgeschwindigkeit auf 0
    // gesetzt wurde – genau das ist der Fall, wenn ihn die Kollisionsauflösung mit dem
    // Mittelpunkt in eine Felszelle geschoben hat.
    if (enemy.wantsToMove() || enemy.isPathBlocked()) {
      progress.blockedMs += Math.max(0, delta);
    }
  }

  private isObstacleAttackUnlocked(enemy: EnemyEntity): boolean {
    const progress = this.movementProgress.get(enemy.id);
    if (!progress) return false;
    if (progress.clearingObstacle?.active) return true;
    return progress.blockedMs >= enemy.getObstacleAttackDelayMs();
  }

  private ensureMovementProgress(enemy: EnemyEntity): EnemyMovementProgressState {
    let progress = this.movementProgress.get(enemy.id);
    if (!progress) {
      progress = {
        anchorX: enemy.sprite.x,
        anchorY: enemy.sprite.y,
        blockedMs: 0,
        clearingObstacle: null,
      };
      this.movementProgress.set(enemy.id, progress);
    }
    return progress;
  }

  private resetMovementProgress(enemy: EnemyEntity): void {
    this.movementProgress.set(enemy.id, {
      anchorX: enemy.sprite.x,
      anchorY: enemy.sprite.y,
      blockedMs: 0,
      clearingObstacle: null,
    });
  }

  private cleanupInactiveEnemies(activeEnemyIds: ReadonlySet<string>): void {
    this.deleteInactiveEntries(this.sustainedAttacks, activeEnemyIds);
    this.deleteInactiveEntries(this.salvoStates, activeEnemyIds);
    this.deleteInactiveEntries(this.playerTargetLocks, activeEnemyIds);
    this.deleteInactiveEntries(this.meleeWindups, activeEnemyIds);
    this.deleteInactiveEntries(this.movementProgress, activeEnemyIds);
    this.deleteInactiveEntries(this.obstacleContacts, activeEnemyIds);
  }

  private deleteInactiveEntries<T>(entries: Map<string, T>, activeEnemyIds: ReadonlySet<string>): void {
    for (const enemyId of entries.keys()) {
      if (!activeEnemyIds.has(enemyId)) entries.delete(enemyId);
    }
  }

  private isBetterCandidate(candidate: EnemyAttackCandidate | null, current: EnemyAttackCandidate | null): boolean {
    if (!candidate) return false;
    if (!current) return true;
    if (candidate.priority !== current.priority) {
      return candidate.priority < current.priority;
    }
    return candidate.distance < current.distance;
  }

  private targetKey(candidate: EnemyAttackCandidate): string {
    return candidate.targetRef
      ? `${candidate.targetRef.kind}:${candidate.targetRef.id}`
      : (candidate.targetId ?? candidate.kind);
  }
}

interface SelectedEnemyAttack {
  readonly attackWeapon: EnemyAttackWeapon;
  readonly target: EnemyAttackCandidate;
}
