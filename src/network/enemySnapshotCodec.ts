import { DAWN_ELITE_AFFIX_IDS } from '../dawn/contracts/DawnContentIds';
import { isEnemyClawState } from '../systems/EnemyClawAttack';
import { readAreaClawState } from './krakenSnapshotCodec';
import { isShieldChargeState, SHIELD_CHARGE_PHASES } from '../systems/ShieldChargeState';
import { ENERGY_CONE_CLIP_QUANT, ENERGY_CONE_CLIP_RAYS, ENERGY_CONE_PHASES, isEnergyConeState } from '../systems/EnergyConeState';
/**
 * Kompakte (De-)Serialisierung des Gegner-Upsert-Stroms für {@link SyncedEnemySnapshot}.
 *
 * Motivation: Bei vielen Gegnern dominieren die Gegner-Updates die Netzwerk-Payload (~60 % laut
 * Telemetrie). Ein Upsert als JSON-Objekt (`{"id":"e4z","x":1234,"y":567}`) kostet ~32 Byte, davon
 * über die Hälfte wiederholte Keys und die String-ID. Hier werden Upserts stattdessen als flacher
 * Zahlenstrom mit Per-Eintrag-Bitmaske kodiert – das halbiert die Payload ohne jede Auswirkung auf
 * Update-Frequenz oder Interpolation (Direktheit bleibt unverändert).
 *
 * Stromformat von `u` (Einträge hintereinander, variable Länge):
 *   idNum, mask, [x, y]?, [rotQuant]?, [hp, maxHp]?, [kindIndex]?, [burnStacks]?, [faction, ownerId, ownerColor]?, [burrowed]?, [dashPhase]?, [specialAction...]?, [plasmaChargeStacks]?, [entityGeneration]?, [claw...]?, [positionRevision]?
 * Reihenfolge der optionalen Felder ist fix; `mask` gibt an, welche vorhanden sind.
 */
import {
  getCoopDefenseEnemyKindByIndex,
  getCoopDefenseEnemyKindIndex,
} from '../config/coopDefenseEnemies';
import type { SyncedEnemyDeltaState } from '../types';

const FIELD_GENERATION = 1024;
const FIELD_CLAW = 2048;
const FIELD_POSITION_REVISION = 4096;
const FIELD_AREA_CLAW = 8192;
/** Host-fixed shield charge lane: revision, phase, origin, angle, length, half width, timeline. */
const FIELD_SHIELD_CHARGE = 16384;
/** Host-fixed energy cone: revision, phase, origin, angle, range, arc, timeline, quantized cover profile. */
const FIELD_ENERGY_CONE = 32768;
/** Lane angles need more precision than body rotation: a 0.01 rad error is 8 px at 800 px. */
const LANE_ANGLE_QUANT = 10000;
/** Dawn elite affix id (validated against DAWN_ELITE_AFFIX_IDS on decode). */
const FIELD_ELITE_AFFIX = 65536;
/** Amphibious enemy under water (0/1); absent in full states means surfaced. */
const FIELD_SUBMERGED = 131072;
// Codes 0–6 are deployed legacy values; append new actions without renumbering them.
const SPECIAL_ACTIONS = ['none', 'gauss-charge', 'phase-nuke', 'armageddon', 'timebomb-chase',
  'timebomb-fuse', 'void-molotov-windup', 'kraken-ink', 'kraken-eggs', 'kraken-dive',
  'kraken-submerged', 'kraken-surface', 'kraken-ashore', 'kraken-slam', 'kraken-spines', 'fire-lance-charge'] as const;
const FIELD_POS = 1;   // x + y
const FIELD_ROT = 2;   // rot (quantisiert × ROT_QUANT)
const FIELD_HP = 4;    // hp + maxHp
const FIELD_KIND = 8;  // kindIndex
// Visuelle Brand-Stackzahl; `.5` kodiert lila Feuer rueckwaertskompatibel im selben Wert.
const FIELD_BURN = 16;
const FIELD_FACTION = 32; // Fraktion und optionale Besitzerdarstellung
const FIELD_BURROW = 64;  // Einbuddel-Zustand
const FIELD_DASH = 128;   // Ausweichschritt-Phase (0/1/2)
const FIELD_SPECIAL = 256; // Spezialaktion + Endzeit + Gauss-Fortschritt/Zielwinkel
const FIELD_PLASMA_CHARGE = 512; // Stackzahl der Plasma-Aufladung

/** Rotation wird als Integer (2 Nachkommastellen) übertragen, um den Dezimalpunkt zu sparen. */
const ROT_QUANT = 100;

/** Wandelt die interne String-ID `e<base36>` in ihre numerische Form (für die Übertragung). */
export function enemyIdToNum(id: string): number {
  return parseInt(id.slice(1), 36);
}

/** Rekonstruiert die interne String-ID aus der numerischen Wire-Form. */
export function enemyNumToId(num: number): string {
  return `e${num.toString(36)}`;
}

/** Hängt einen (vollständigen oder Delta-)Upsert an den flachen Zahlenstrom an. */
export function encodeEnemyUpsert(out: Array<number | string>, entry: SyncedEnemyDeltaState): void {
  if (entry.areaClaw !== undefined && (!readAreaClawState(entry.areaClaw)
    || entry.areaClaw.attack?.presentation === 'tentacle')) {
    throw new Error('Enemy snapshots carry only validated body area-claw slots');
  }
  let mask = 0;
  if (entry.eliteAffixId !== undefined) mask |= FIELD_ELITE_AFFIX;
  if (entry.areaClaw !== undefined) mask |= FIELD_AREA_CLAW;
  if (entry.shieldCharge !== undefined) mask |= FIELD_SHIELD_CHARGE;
  if (entry.energyCone !== undefined) mask |= FIELD_ENERGY_CONE;
  if (entry.positionRevision !== undefined) mask |= FIELD_POSITION_REVISION;
  if (entry.claw !== undefined) mask |= FIELD_CLAW;
  if (entry.entityGeneration !== undefined) mask |= FIELD_GENERATION;
  if (entry.x !== undefined && entry.y !== undefined) mask |= FIELD_POS;
  if (entry.rot !== undefined) mask |= FIELD_ROT;
  if (entry.hp !== undefined && entry.maxHp !== undefined) mask |= FIELD_HP;
  if (entry.kind !== undefined) mask |= FIELD_KIND;
  if (entry.burnStacks !== undefined) mask |= FIELD_BURN;
  if (entry.faction !== undefined) mask |= FIELD_FACTION;
  if (entry.burrowed !== undefined) mask |= FIELD_BURROW;
  if (entry.dashPhase !== undefined) mask |= FIELD_DASH;
  if (entry.specialAction !== undefined) mask |= FIELD_SPECIAL;
  if (entry.plasmaChargeStacks !== undefined) mask |= FIELD_PLASMA_CHARGE;
  if (entry.submerged !== undefined) mask |= FIELD_SUBMERGED;

  out.push(enemyIdToNum(entry.id), mask);
  if (mask & FIELD_POS) out.push(entry.x as number, entry.y as number);
  if (mask & FIELD_ROT) out.push(Math.round((entry.rot as number) * ROT_QUANT));
  if (mask & FIELD_HP) out.push(entry.hp as number, entry.maxHp as number);
  if (mask & FIELD_KIND) out.push(getCoopDefenseEnemyKindIndex(entry.kind as string));
  if (mask & FIELD_BURN) {
    // Brandstil im Nachkommaanteil: normal 0, allied 0.25, void 0.5 (alle binär exakt).
    out.push((entry.burnStacks as number) + (entry.burnVisualStyle === 'void' ? 0.5 : entry.burnVisualStyle === 'allied' ? 0.25 : 0));
  }
  if (mask & FIELD_FACTION) {
    out.push(entry.faction === 'allied' ? 1 : 0, entry.ownerId ?? '', entry.ownerColor ?? 0);
  }
  if (mask & FIELD_BURROW) out.push(entry.burrowed ? 1 : 0);
  if (mask & FIELD_DASH) out.push(entry.dashPhase as number);
  if (mask & FIELD_SPECIAL) {
    const actionCode = SPECIAL_ACTIONS.indexOf(entry.specialAction!);
    out.push(
      actionCode,
      entry.specialActionEndsAt ?? 0,
      Math.round((entry.gaussChargeProgress ?? 0) * 1000),
      Math.round((entry.gaussAimAngle ?? 0) * ROT_QUANT),
    );
  }
  if (mask & FIELD_PLASMA_CHARGE) out.push(entry.plasmaChargeStacks as number);
  if (mask & FIELD_GENERATION) out.push(entry.entityGeneration as number);
  if (mask & FIELD_CLAW) {
    const state = entry.claw!, attack = state.attack;
    out.push(state.revision, attack ? 1 : 0);
    if (attack) out.push(attack.attackId, attack.weaponId, attack.startedAt, attack.strikeAt,
      attack.hitAt, attack.endsAt, attack.angle, attack.range, attack.arcDegrees);
  }
  if (mask & FIELD_POSITION_REVISION) out.push(entry.positionRevision as number);
  if (mask & FIELD_AREA_CLAW) out.push(JSON.stringify(entry.areaClaw));
  if (mask & FIELD_SHIELD_CHARGE) {
    const state = entry.shieldCharge!, lane = state.lane;
    out.push(state.revision, SHIELD_CHARGE_PHASES.indexOf(state.phase), lane ? 1 : 0);
    if (lane) out.push(lane.originX, lane.originY, Math.round(lane.angle * LANE_ANGLE_QUANT), lane.length, lane.halfWidth,
      lane.startedAt, lane.runAt, lane.runEndsAt, lane.recoverUntil);
  }
  if (mask & FIELD_ENERGY_CONE) {
    const state = entry.energyCone!, attack = state.attack;
    out.push(state.revision, ENERGY_CONE_PHASES.indexOf(state.phase), attack ? 1 : 0);
    if (attack) {
      out.push(attack.originX, attack.originY, Math.round(attack.angle * LANE_ANGLE_QUANT), attack.range, attack.arcDegrees,
        attack.startedAt, attack.hitAt, attack.recoverUntil);
      for (const reach of attack.clip) out.push(Math.round(reach * ENERGY_CONE_CLIP_QUANT));
    }
  }
  if (mask & FIELD_ELITE_AFFIX) out.push(entry.eliteAffixId!);
  if (mask & FIELD_SUBMERGED) out.push(entry.submerged ? 1 : 0);
}

/** Dekodiert den flachen Zahlenstrom zurück in Delta-Objekte für die clientseitige Anwendung. */
export function decodeEnemyUpserts(stream: readonly (number | string)[]): SyncedEnemyDeltaState[] {
  const result: SyncedEnemyDeltaState[] = [];
  let i = 0;
  while (i + 1 < stream.length) {
    const idNum = stream[i++] as number;
    const mask = stream[i++] as number;
    const entry: SyncedEnemyDeltaState = { id: enemyNumToId(idNum) };
    if (mask & FIELD_POS) { entry.x = stream[i++] as number; entry.y = stream[i++] as number; }
    if (mask & FIELD_ROT) { entry.rot = (stream[i++] as number) / ROT_QUANT; }
    if (mask & FIELD_HP) { entry.hp = stream[i++] as number; entry.maxHp = stream[i++] as number; }
    if (mask & FIELD_KIND) { entry.kind = getCoopDefenseEnemyKindByIndex(stream[i++] as number); }
    if (mask & FIELD_BURN) {
      const packedBurn = stream[i++] as number;
      entry.burnStacks = Math.floor(packedBurn);
      const styleFraction = packedBurn - entry.burnStacks;
      entry.burnVisualStyle = styleFraction >= 0.5 ? 'void' : styleFraction >= 0.25 ? 'allied' : 'normal';
    }
    if (mask & FIELD_FACTION) {
      entry.faction = (stream[i++] as number) === 1 ? 'allied' : 'hostile';
      const ownerId = stream[i++] as string;
      entry.ownerId = ownerId || undefined;
      entry.ownerColor = stream[i++] as number;
    }
    if (mask & FIELD_BURROW) { entry.burrowed = (stream[i++] as number) === 1; }
    if (mask & FIELD_DASH) { entry.dashPhase = (stream[i++] as number) as 0 | 1 | 2; }
    if (mask & FIELD_SPECIAL) {
      const actionCode = stream[i++] as number;
      entry.specialAction = SPECIAL_ACTIONS[actionCode] ?? 'none';
      entry.specialActionEndsAt = stream[i++] as number;
      entry.gaussChargeProgress = (stream[i++] as number) / 1000;
      entry.gaussAimAngle = (stream[i++] as number) / ROT_QUANT;
    }
    if (mask & FIELD_PLASMA_CHARGE) entry.plasmaChargeStacks = stream[i++] as number;
    if (mask & FIELD_GENERATION) {
      const generation = stream[i++] as number;
      if (Number.isSafeInteger(generation) && generation >= 0) entry.entityGeneration = generation;
    }
    if (mask & FIELD_CLAW) {
      const revision = stream[i++] as number, active = stream[i++] as number;
      const claw = { revision, attack: active ? {
        attackId: stream[i++] as string, weaponId: stream[i++] as string,
        startedAt: stream[i++] as number, strikeAt: stream[i++] as number,
        hitAt: stream[i++] as number, endsAt: stream[i++] as number,
        angle: stream[i++] as number, range: stream[i++] as number, arcDegrees: stream[i++] as number,
      } : null };
      if (isEnemyClawState(claw)) entry.claw = claw;
    }
    if (mask & FIELD_POSITION_REVISION) {
      const revision = stream[i++] as number;
      if (Number.isSafeInteger(revision) && revision >= 0) entry.positionRevision = revision;
    }
    if (mask & FIELD_AREA_CLAW) {
      const encoded = stream[i++];
      if (typeof encoded === 'string') {
        try {
          const state = readAreaClawState(JSON.parse(encoded));
          if (state?.attack?.presentation !== 'tentacle') entry.areaClaw = state;
        } catch { /* Invalid optional state. */ }
      }
    }
    if (mask & FIELD_SHIELD_CHARGE) {
      const revision = stream[i++] as number, phase = SHIELD_CHARGE_PHASES[stream[i++] as number], hasLane = stream[i++] as number;
      const lane = hasLane ? {
        originX: stream[i++] as number, originY: stream[i++] as number, angle: (stream[i++] as number) / LANE_ANGLE_QUANT,
        length: stream[i++] as number, halfWidth: stream[i++] as number, startedAt: stream[i++] as number,
        runAt: stream[i++] as number, runEndsAt: stream[i++] as number, recoverUntil: stream[i++] as number,
      } : null;
      const state = { revision, phase, lane };
      if (isShieldChargeState(state)) entry.shieldCharge = state;
    }
    if (mask & FIELD_ENERGY_CONE) {
      const revision = stream[i++] as number, phase = ENERGY_CONE_PHASES[stream[i++] as number], hasAttack = stream[i++] as number;
      let attack = null;
      if (hasAttack) {
        const head = { originX: stream[i++] as number, originY: stream[i++] as number, angle: (stream[i++] as number) / LANE_ANGLE_QUANT,
          range: stream[i++] as number, arcDegrees: stream[i++] as number, startedAt: stream[i++] as number,
          hitAt: stream[i++] as number, recoverUntil: stream[i++] as number };
        const clip: number[] = [];
        for (let ray = 0; ray < ENERGY_CONE_CLIP_RAYS; ray++) clip.push((stream[i++] as number) / ENERGY_CONE_CLIP_QUANT);
        attack = { ...head, clip };
      }
      const state = { revision, phase, attack };
      if (isEnergyConeState(state)) entry.energyCone = state;
    }
    if (mask & FIELD_ELITE_AFFIX) {
      const affix = stream[i++];
      if (DAWN_ELITE_AFFIX_IDS.some(id => id === affix)) entry.eliteAffixId = affix as SyncedEnemyDeltaState['eliteAffixId'];
    }
    if (mask & FIELD_SUBMERGED) entry.submerged = (stream[i++] as number) === 1;
    result.push(entry);
  }
  return result;
}
