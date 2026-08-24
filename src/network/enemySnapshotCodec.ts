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
 *   idNum, mask, [x, y]?, [rotQuant]?, [hp, maxHp]?, [kindIndex]?, [burnStacks]?, [faction, ownerId, ownerColor]?, [burrowed]?, [dashPhase]?, [specialAction...]?, [plasmaChargeStacks]?
 * Reihenfolge der optionalen Felder ist fix; `mask` gibt an, welche vorhanden sind.
 */
import {
  getCoopDefenseEnemyKindByIndex,
  getCoopDefenseEnemyKindIndex,
} from '../config/coopDefenseEnemies';
import type { SyncedEnemyDeltaState } from '../types';

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
  let mask = 0;
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

  out.push(enemyIdToNum(entry.id), mask);
  if (mask & FIELD_POS) out.push(entry.x as number, entry.y as number);
  if (mask & FIELD_ROT) out.push(Math.round((entry.rot as number) * ROT_QUANT));
  if (mask & FIELD_HP) out.push(entry.hp as number, entry.maxHp as number);
  if (mask & FIELD_KIND) out.push(getCoopDefenseEnemyKindIndex(entry.kind as string));
  if (mask & FIELD_BURN) {
    out.push((entry.burnStacks as number) + (entry.burnVisualStyle === 'void' ? 0.5 : 0));
  }
  if (mask & FIELD_FACTION) {
    out.push(entry.faction === 'allied' ? 1 : 0, entry.ownerId ?? '', entry.ownerColor ?? 0);
  }
  if (mask & FIELD_BURROW) out.push(entry.burrowed ? 1 : 0);
  if (mask & FIELD_DASH) out.push(entry.dashPhase as number);
  if (mask & FIELD_SPECIAL) {
    const actionCode = entry.specialAction === 'gauss-charge'
      ? 1
      : entry.specialAction === 'phase-nuke'
        ? 2
        : entry.specialAction === 'armageddon'
          ? 3
          : entry.specialAction === 'timebomb-chase'
            ? 4
            : entry.specialAction === 'timebomb-fuse'
              ? 5
              : entry.specialAction === 'void-molotov-windup'
                ? 6
          : 0;
    out.push(
      actionCode,
      entry.specialActionEndsAt ?? 0,
      Math.round((entry.gaussChargeProgress ?? 0) * 1000),
      Math.round((entry.gaussAimAngle ?? 0) * ROT_QUANT),
    );
  }
  if (mask & FIELD_PLASMA_CHARGE) out.push(entry.plasmaChargeStacks as number);
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
      entry.burnVisualStyle = packedBurn - entry.burnStacks >= 0.5 ? 'void' : 'normal';
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
      entry.specialAction = actionCode === 1
        ? 'gauss-charge'
        : actionCode === 2
          ? 'phase-nuke'
        : actionCode === 3
            ? 'armageddon'
            : actionCode === 4
              ? 'timebomb-chase'
              : actionCode === 5
                ? 'timebomb-fuse'
                : actionCode === 6
                  ? 'void-molotov-windup'
            : 'none';
      entry.specialActionEndsAt = stream[i++] as number;
      entry.gaussChargeProgress = (stream[i++] as number) / 1000;
      entry.gaussAimAngle = (stream[i++] as number) / ROT_QUANT;
    }
    if (mask & FIELD_PLASMA_CHARGE) entry.plasmaChargeStacks = stream[i++] as number;
    result.push(entry);
  }
  return result;
}
