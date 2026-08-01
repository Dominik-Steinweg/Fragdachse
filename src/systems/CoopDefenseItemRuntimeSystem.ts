import { COOP_DEFENSE_AFFIX_RULES } from '../config/coopDefenseItems';
import type { LoadoutSlot } from '../types';
import type { CombatDamageKind } from './CombatSystem';

/**
 * Host-only: lebender Zustand der bedingten und ereignisbasierten Item-Affixe.
 *
 * Die gewuerfelten Affixwerte selbst liegen im `CoopDefensePlayerModifierSystem` – das ist eine
 * reine Projektion des committeten Loadouts und soll das bleiben. Alles, was sich waehrend einer
 * Runde aendert (Stapel, Timer, Wegstrecke, Debuffs), gehoert hierher, damit weder
 * `CombatSystem` noch `ResourceSystem` weiter anwachsen und die Regeln an einer Stelle stehen.
 *
 * Round-Lifetime: die Instanz wird in `buildArena()` erzeugt und in `tearDownArena()` verworfen.
 * Keine Spieler- oder Gegner-ID darf eine Runde ueberleben.
 */

/** Sichere Obergrenze fuer die je Frame anrechenbare Wegstrecke. */
const MAX_TRACKED_STEP_PX = 64;

export interface CoopDefenseItemRuntimeDeps {
  /** Gewuerfelter Gesamtwert eines Affixes; 0, wenn der Spieler es nicht traegt. */
  getAffixValue(playerId: string, affixId: string): number;
  /** Aktuelle HP und Maximum eines Spielers; `null` fuer alles, was kein Spieler ist. */
  getPlayerHp(playerId: string): { hp: number; maxHp: number } | null;
  /** Position des Spielers fuer ortsbezogene Konstrukt-Affixe. */
  getPlayerPosition?(playerId: string): { x: number; y: number } | null;
  /** Klassen-ID fuer klassenexklusive Laufzeit-Affixe. */
  getPlayerClassId?(playerId: string): string | null;
}

export interface RemoteControlSource {
  readonly id: number | string;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
}

interface KillChargeState {
  stacks: number;
  expiresAt: number;
}

interface MovementChargeState {
  travelledPx: number;
  glutwandererTravelledPx: number;
  charged: boolean;
  lastX: number;
  lastY: number;
  hasPosition: boolean;
}

interface SurroundedState {
  lingerUntil: number;
}

export class CoopDefenseItemRuntimeSystem {
  private readonly killCharges = new Map<string, KillChargeState>();
  private readonly movementCharges = new Map<string, MovementChargeState>();
  private readonly surroundedStates = new Map<string, SurroundedState>();
  private readonly afterburnerUntil = new Map<string, number>();
  private readonly crossfireUntil = new Map<string, number>();
  private readonly lastRealDamageAt = new Map<string, number>();
  private readonly vulnerableUntil = new Map<string, number>();

  constructor(
    private readonly deps: CoopDefenseItemRuntimeDeps,
    private readonly random: () => number = Math.random,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  initPlayer(playerId: string, now = Date.now()): void {
    this.killCharges.delete(playerId);
    this.afterburnerUntil.delete(playerId);
    this.crossfireUntil.delete(playerId);
    this.surroundedStates.delete(playerId);
    this.movementCharges.set(playerId, {
      travelledPx: 0,
      glutwandererTravelledPx: 0,
      charged: false,
      lastX: 0,
      lastY: 0,
      hasPosition: false,
    });
    // Frisch gespawnt gilt als "seit jeher unbeschadet": die Notfallreparatur soll nicht erst
    // vier Sekunden nach dem Spawn anspringen.
    this.lastRealDamageAt.set(playerId, now - COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs);
  }

  removePlayer(playerId: string): void {
    this.killCharges.delete(playerId);
    this.movementCharges.delete(playerId);
    this.afterburnerUntil.delete(playerId);
    this.crossfireUntil.delete(playerId);
    this.surroundedStates.delete(playerId);
    this.lastRealDamageAt.delete(playerId);
  }

  removeEnemy(enemyId: string): void {
    this.vulnerableUntil.delete(enemyId);
  }

  clear(): void {
    this.killCharges.clear();
    this.movementCharges.clear();
    this.surroundedStates.clear();
    this.afterburnerUntil.clear();
    this.crossfireUntil.clear();
    this.lastRealDamageAt.clear();
    this.vulnerableUntil.clear();
  }

  /** Verwirft abgelaufene Eintraege, damit die Maps nicht ueber eine lange Runde wachsen. */
  hostUpdate(now = Date.now()): void {
    for (const [playerId, state] of this.killCharges) {
      if (now >= state.expiresAt) this.killCharges.delete(playerId);
    }
    for (const [playerId, until] of this.afterburnerUntil) {
      if (now >= until) this.afterburnerUntil.delete(playerId);
    }
    for (const [playerId, until] of this.crossfireUntil) {
      if (now >= until) this.crossfireUntil.delete(playerId);
    }
    for (const [enemyId, until] of this.vulnerableUntil) {
      if (now >= until) this.vulnerableUntil.delete(enemyId);
    }
    for (const [playerId, state] of this.surroundedStates) {
      if (state.lingerUntil > 0 && now >= state.lingerUntil) this.surroundedStates.delete(playerId);
    }
  }

  // ── Kampfaufladung ─────────────────────────────────────────────────────────

  /**
   * Ein eigener Kill: ein Stapel mehr, Dauer aller Stapel erneuert, nie ueber das Maximum.
   * Nur fuer den tatsaechlichen Killer aufrufen – Kills von Verbuendeten zaehlen nicht.
   */
  registerOwnKill(playerId: string, now = Date.now()): void {
    if (this.deps.getAffixValue(playerId, 'adrenaline_kill_charge') <= 0) return;
    const current = this.killCharges.get(playerId);
    const stacks = current && now < current.expiresAt ? current.stacks : 0;
    this.killCharges.set(playerId, {
      stacks: Math.min(COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks, stacks + 1),
      expiresAt: now + COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs,
    });
  }

  getKillChargeStacks(playerId: string, now = Date.now()): number {
    const state = this.killCharges.get(playerId);
    return state && now < state.expiresAt ? state.stacks : 0;
  }

  /** Faktor auf die Adrenalinregeneration; 1 ohne aktive Stapel. */
  getAdrenalineRegenMultiplier(playerId: string, now = Date.now()): number {
    const stacks = this.getKillChargeStacks(playerId, now);
    let bonus = stacks > 0
      ? stacks * this.deps.getAffixValue(playerId, 'adrenaline_kill_charge')
      : 0;
    if (this.isSurrounded(playerId, now)) {
      bonus += this.deps.getAffixValue(playerId, 'surrounded');
    }
    return 1 + bonus;
  }

  // ── Schockreaktion, Dornen, Notfallreparatur ───────────────────────────────

  /**
   * Tatsaechlich erlittener Schaden. Liefert den Dornen-Rueckwurf zurueck, damit der Aufrufer
   * ihn ueber den regulaeren Schadenspfad zufuegen kann – dieses System kennt kein `CombatSystem`.
   */
  handlePlayerDamageTaken(
    playerId: string,
    attackerId: string | undefined,
    hpLost: number,
    armorLost: number,
    damageKind: CombatDamageKind,
    now = Date.now(),
  ): { adrenalineGain: number; reflectedDamage: number; reflectTargetId?: string } {
    const actualDamage = Math.max(0, hpLost) + Math.max(0, armorLost);
    if (actualDamage <= 0) return { adrenalineGain: 0, reflectedDamage: 0 };

    this.lastRealDamageAt.set(playerId, now);

    const adrenalineGain = actualDamage * this.deps.getAffixValue(playerId, 'adrenaline_from_damage');

    // Reflektierter Schaden darf keine weiteren Dornen ausloesen, sonst schaukeln sich zwei
    // Dornentraeger gegenseitig hoch. Ohne eindeutigen Verursacher wird nichts zurueckgeworfen.
    const reflectionFraction = this.deps.getAffixValue(playerId, 'damage_reflection');
    const canReflect = damageKind !== 'reflect'
      && reflectionFraction > 0
      && attackerId !== undefined
      && attackerId !== playerId;

    return {
      adrenalineGain,
      reflectedDamage: canReflect ? actualDamage * reflectionFraction : 0,
      reflectTargetId: canReflect ? attackerId : undefined,
    };
  }

  /** Zusaetzliche Ruestungsregeneration, sobald lange genug kein echter Schaden entstand. */
  getBonusArmorRegenPerSecond(playerId: string, now = Date.now()): number {
    const perSecond = this.deps.getAffixValue(playerId, 'out_of_combat_armor_repair');
    if (perSecond <= 0) return 0;
    const lastDamageAt = this.lastRealDamageAt.get(playerId);
    if (lastDamageAt === undefined) return 0;
    return now - lastDamageAt >= COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs ? perSecond : 0;
  }

  // ── HP-abhaengige Affixe ───────────────────────────────────────────────────

  /**
   * Zusaetzlicher prozentualer Schadensbonus des Angreifers.
   *
   * Blutrausch und Unversehrt schliessen sich gegenseitig aus, addieren sich aber mit allem
   * anderen. Nicht-Spieler (Tuerme, Basis-Pseudo-IDs) liefern kein HP-Verhaeltnis und bekommen
   * deshalb keinen Bonus – ohne diese Pruefung erhielte ein Turm dauerhaft den Unversehrt-Bonus.
   *
   * `sourceSlot` entscheidet ueber die slot-gebundenen Anteile (Kreuzfeuer). Fehlt er, wirken nur
   * die slot-unabhaengigen Boni – Umgebungs- und Faehigkeitsschaden bleibt damit unveraendert.
   */
  getConditionalOutgoingDamageBonus(
    attackerId: string | undefined,
    sourceSlot?: LoadoutSlot,
    now = Date.now(),
  ): number {
    if (!attackerId) return 0;
    const fraction = this.getHpFraction(attackerId);
    if (fraction === null) return 0;

    let bonus = 0;
    if (fraction < COOP_DEFENSE_AFFIX_RULES.lowHpThreshold) {
      bonus += this.deps.getAffixValue(attackerId, 'low_hp_blood_rage');
    } else if (fraction >= COOP_DEFENSE_AFFIX_RULES.highHpThreshold) {
      bonus += this.deps.getAffixValue(attackerId, 'high_hp_damage');
    }
    if (sourceSlot === 'weapon1' && now < (this.crossfireUntil.get(attackerId) ?? 0)) {
      bonus += this.deps.getAffixValue(attackerId, 'crossfire');
    }
    return bonus;
  }

  /**
   * Ein Waffeneinsatz des Spielers. Nur Waffe 2 oeffnet das Kreuzfeuer-Fenster; erneutes Feuern
   * verlaengert es lediglich, die Staerke desselben Effekts stapelt sich nicht.
   */
  registerWeaponFired(playerId: string, sourceSlot: LoadoutSlot, now = Date.now()): void {
    if (sourceSlot !== 'weapon2') return;
    if (this.deps.getAffixValue(playerId, 'crossfire') <= 0) return;
    this.crossfireUntil.set(playerId, now + COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs);
  }

  /** Fester Lifeleech-Zuschlag aus Blutrausch, solange die Schwelle unterschritten ist. */
  getConditionalLifeLeechBonus(playerId: string): number {
    if (this.deps.getAffixValue(playerId, 'low_hp_blood_rage') <= 0) return 0;
    const fraction = this.getHpFraction(playerId);
    return fraction !== null && fraction < COOP_DEFENSE_AFFIX_RULES.lowHpThreshold
      ? COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus
      : 0;
  }

  /** Zusaetzliche Schadensreduktion aus "Letzte Bastion". */
  getConditionalDamageReduction(playerId: string): number {
    const value = this.deps.getAffixValue(playerId, 'low_hp_damage_reduction');
    if (value <= 0) return 0;
    const fraction = this.getHpFraction(playerId);
    return fraction !== null && fraction < COOP_DEFENSE_AFFIX_RULES.lowHpThreshold ? value : 0;
  }

  // ── Bewegung ───────────────────────────────────────────────────────────────

  /** Faktor auf die normale Laufgeschwindigkeit aus "Unter Druck" und "Nachbrenner". */
  getRunSpeedMultiplier(playerId: string, now = Date.now()): number {
    let bonus = 0;

    const lowHpBonus = this.deps.getAffixValue(playerId, 'low_hp_speed');
    if (lowHpBonus > 0) {
      const fraction = this.getHpFraction(playerId);
      if (fraction !== null && fraction < COOP_DEFENSE_AFFIX_RULES.lowHpThreshold) bonus += lowHpBonus;
    }

    if (now < (this.afterburnerUntil.get(playerId) ?? 0)) {
      bonus += this.deps.getAffixValue(playerId, 'dash_speed');
    }

    return 1 + bonus;
  }

  /**
   * Ein Dash ist gerade zu Ende gegangen. Erneuert nur die Dauer – die Staerke desselben
   * Effekts stapelt sich nicht.
   */
  registerDashCompleted(playerId: string, now = Date.now()): void {
    if (this.deps.getAffixValue(playerId, 'dash_speed') <= 0) return;
    this.afterburnerUntil.set(playerId, now + COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs);
  }

  /**
   * Zurueckgelegte Strecke aus der Position dieses Frames.
   *
   * Die Framedifferenz wird geklemmt, weil Translocator, Tunnel und Respawn die Position direkt
   * schreiben statt ueber Geschwindigkeit – ein Sprung quer durch die Arena darf keine Ladung
   * schenken. Normale Bewegung, Dash und Bewegung unter der Erde bleiben unter der Grenze.
   */
  trackMovement(playerId: string, x: number, y: number): number {
    const state = this.movementCharges.get(playerId);
    if (!state) return 0;

    const previousX = state.lastX;
    const previousY = state.lastY;
    const hadPosition = state.hasPosition;
    state.lastX = x;
    state.lastY = y;
    state.hasPosition = true;
    if (!hadPosition) return 0;

    const step = Math.hypot(x - previousX, y - previousY);
    if (step > MAX_TRACKED_STEP_PX) return 0;

    let glutwandererBursts = 0;
    if (this.deps.getAffixValue(playerId, 'glutwanderer') > 0) {
      state.glutwandererTravelledPx += step;
      const distance = COOP_DEFENSE_AFFIX_RULES.glutwandererDistancePx;
      glutwandererBursts = Math.floor(state.glutwandererTravelledPx / distance);
      if (glutwandererBursts > 0) state.glutwandererTravelledPx %= distance;
    }

    if (state.charged || this.deps.getAffixValue(playerId, 'movement_charge_damage') <= 0) {
      return glutwandererBursts;
    }

    state.travelledPx += step;
    if (state.travelledPx >= COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx) {
      state.travelledPx = 0;
      state.charged = true;
    }
    return glutwandererBursts;
  }

  /** Fortschritt zur naechsten Ladung, 0..1 – Grundlage des HUD-Balkens. */
  getMovementChargeProgress(playerId: string): number {
    const state = this.movementCharges.get(playerId);
    if (!state) return 0;
    if (state.charged) return 1;
    return Math.min(1, state.travelledPx / COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx);
  }

  hasMovementCharge(playerId: string): boolean {
    return this.movementCharges.get(playerId)?.charged === true;
  }

  /**
   * Verbraucht eine gespeicherte Ladung und liefert den Schadensbonus.
   *
   * Auch ein verfehlter Schuss verbraucht sie: der Aufrufer ruft beim Feuern auf, nicht beim
   * Treffen. Es kann immer nur eine Ladung gespeichert sein.
   */
  consumeMovementCharge(playerId: string): number {
    const state = this.movementCharges.get(playerId);
    if (!state?.charged) return 0;
    state.charged = false;
    state.travelledPx = 0;
    return this.deps.getAffixValue(playerId, 'movement_charge_damage');
  }

  /** Anzahl brennender Brocken pro Glutwanderer-Burst; der Affixwert bleibt ganzzahlig lesbar. */
  getGlutwandererChunkCount(playerId: string): number {
    return Math.max(1, Math.floor(this.deps.getAffixValue(playerId, 'glutwanderer')));
  }

  /** Fortschritt bis zum naechsten Glutwanderer-Burst, 0..1. */
  getGlutwandererProgress(playerId: string): number {
    const state = this.movementCharges.get(playerId);
    if (!state) return 0;
    return Math.min(1, state.glutwandererTravelledPx / COOP_DEFENSE_AFFIX_RULES.glutwandererDistancePx);
  }

  /** Aktualisiert den Schwellenzustand fuer Umzingelt vor der Ressourcenregeneration. */
  updateSurrounded(
    playerId: string,
    playerX: number,
    playerY: number,
    enemies: readonly { x: number; y: number; active?: boolean; alive?: boolean }[],
    now = Date.now(),
  ): void {
    if (this.deps.getAffixValue(playerId, 'surrounded') <= 0) {
      this.surroundedStates.delete(playerId);
      return;
    }

    const radiusSq = COOP_DEFENSE_AFFIX_RULES.surroundedRadiusPx ** 2;
    let nearbyEnemyCount = 0;
    for (const enemy of enemies) {
      if (enemy.active === false || enemy.alive === false) continue;
      const dx = enemy.x - playerX;
      const dy = enemy.y - playerY;
      if (dx * dx + dy * dy <= radiusSq) nearbyEnemyCount += 1;
    }

    const current = this.surroundedStates.get(playerId);
    if (nearbyEnemyCount >= COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount) {
      this.surroundedStates.set(playerId, { lingerUntil: 0 });
      return;
    }
    if (!current) return;
    if (current.lingerUntil === 0) {
      current.lingerUntil = now + COOP_DEFENSE_AFFIX_RULES.surroundedLingerMs;
    } else if (now >= current.lingerUntil) {
      this.surroundedStates.delete(playerId);
    }
  }

  isSurrounded(playerId: string, now = Date.now()): boolean {
    const state = this.surroundedStates.get(playerId);
    if (!state) return false;
    if (state.lingerUntil > 0 && now >= state.lingerUntil) {
      this.surroundedStates.delete(playerId);
      return false;
    }
    return true;
  }

  /** Liefert das per Distanz und stabiler ID-Reihenfolge gewaehlte eigene Konstrukt. */
  getRemoteControlTarget(
    playerId: string,
    sources: readonly RemoteControlSource[],
  ): RemoteControlSource | null {
    if (!this.isRemoteControlActive(playerId)) return null;
    const playerPosition = this.deps.getPlayerPosition?.(playerId);
    if (!playerPosition) return null;

    let best: RemoteControlSource | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const source of sources) {
      if (source.ownerId !== playerId) continue;
      const dx = source.x - playerPosition.x;
      const dy = source.y - playerPosition.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq || (
        distanceSq === bestDistanceSq
        && best !== null
        && compareRemoteControlIds(source.id, best.id) < 0
      )) {
        best = source;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  /** Multiplikator fuer einen Schuss des ausgewaehlten eigenen Konstrukts. */
  getRemoteControlDamageMultiplier(
    playerId: string,
    source: RemoteControlSource,
    sources: readonly RemoteControlSource[],
  ): number {
    const target = this.getRemoteControlTarget(playerId, sources);
    return target && String(target.id) === String(source.id)
      ? 1 + this.deps.getAffixValue(playerId, 'remote_control')
      : 1;
  }

  /** Replizierbarer Zustand fuer die Spielerfarben-Glut am jeweils ausgewaehlten Konstrukt. */
  getRemoteControlSnapshot(
    playerIds: readonly string[],
    sources: readonly RemoteControlSource[],
  ): { turretId: string; ownerId: string; x: number; y: number; color: number }[] {
    const snapshot: { turretId: string; ownerId: string; x: number; y: number; color: number }[] = [];
    for (const playerId of playerIds) {
      const target = this.getRemoteControlTarget(playerId, sources);
      if (!target) continue;
      snapshot.push({
        turretId: String(target.id),
        ownerId: playerId,
        x: target.x,
        y: target.y,
        color: target.ownerColor,
      });
    }
    return snapshot;
  }

  private isRemoteControlActive(playerId: string): boolean {
    return this.deps.getPlayerClassId?.(playerId) === 'inspector_gadachs'
      && this.deps.getAffixValue(playerId, 'remote_control') > 0;
  }

  // ── Primaerwaffen-Treffereffekte ───────────────────────────────────────────

  /**
   * Wuerfe fuer Fokusfeuer und Unterdrueckungsmunition nach einem direkten
   * Primaerwaffentreffer. Liefert die gewuenschte Verlangsamung zurueck; die Verwundbarkeit
   * verwaltet dieses System selbst.
   */
  rollDirectPrimaryHitEffects(
    attackerId: string,
    enemyId: string,
    now = Date.now(),
  ): { slowFraction: number; slowDurationMs: number } {
    const vulnerabilityChance = this.deps.getAffixValue(attackerId, 'primary_vulnerability');
    if (vulnerabilityChance > 0 && this.random() < vulnerabilityChance) {
      // Stapelt nicht: eine erneute Ausloesung verlaengert nur.
      this.vulnerableUntil.set(
        enemyId,
        Math.max(this.vulnerableUntil.get(enemyId) ?? 0, now + COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs),
      );
    }

    const slowChance = this.deps.getAffixValue(attackerId, 'primary_slow');
    return slowChance > 0 && this.random() < slowChance
      ? {
        slowFraction: COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction,
        slowDurationMs: COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs,
      }
      : { slowFraction: 0, slowDurationMs: 0 };
  }

  /** Ist der Hinrichtungsschlag faellig? Bosse sind vollstaendig immun. */
  rollCulling(attackerId: string, remainingHp: number, maxHp: number, isBoss: boolean): boolean {
    if (isBoss || maxHp <= 0 || remainingHp <= 0) return false;
    if (remainingHp >= maxHp * COOP_DEFENSE_AFFIX_RULES.cullingHpThreshold) return false;
    const chance = this.deps.getAffixValue(attackerId, 'primary_culling');
    return chance > 0 && this.random() < chance;
  }

  /** Ist der Brandzerfall bei diesem Kill faellig? */
  rollFireChunksOnKill(killerId: string): boolean {
    const chance = this.deps.getAffixValue(killerId, 'primary_kill_fire_chunks');
    return chance > 0 && this.random() < chance;
  }

  // ── Verwundbarkeit ─────────────────────────────────────────────────────────

  /** Eingehender Schadensmultiplikator eines Gegners; 1 ohne Verwundbarkeit. */
  getEnemyIncomingDamageMultiplier(enemyId: string, now = Date.now()): number {
    const until = this.vulnerableUntil.get(enemyId);
    if (until === undefined) return 1;
    if (now >= until) {
      this.vulnerableUntil.delete(enemyId);
      return 1;
    }
    return 1 + COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus;
  }

  /**
   * Replizierbarer Zustand: Gegner-ID und absoluter Ablaufzeitpunkt. Absolut statt Restdauer,
   * damit der Client zwischen zwei Snapshots selbst herunterzaehlen kann.
   */
  getVulnerableEnemiesSnapshot(now = Date.now()): { enemyId: string; expiresAt: number }[] {
    const snapshot: { enemyId: string; expiresAt: number }[] = [];
    for (const [enemyId, expiresAt] of this.vulnerableUntil) {
      if (now < expiresAt) snapshot.push({ enemyId, expiresAt });
    }
    return snapshot;
  }

  private getHpFraction(playerId: string): number | null {
    const hp = this.deps.getPlayerHp(playerId);
    if (!hp || hp.maxHp <= 0) return null;
    return hp.hp / hp.maxHp;
  }
}

function compareRemoteControlIds(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'number') return -1;
  if (typeof right === 'number') return 1;
  return left.localeCompare(right);
}
