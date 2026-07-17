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
 *   idNum, mask, [x, y]?, [rotQuant]?, [hp, maxHp]?, [kindIndex]?, [burnStacks]?, [faction, ownerId, ownerColor]?
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
const FIELD_BURN = 16; // visuelle Brand-Stackzahl
const FIELD_FACTION = 32; // Fraktion und optionale Besitzerdarstellung

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

  out.push(enemyIdToNum(entry.id), mask);
  if (mask & FIELD_POS) out.push(entry.x as number, entry.y as number);
  if (mask & FIELD_ROT) out.push(Math.round((entry.rot as number) * ROT_QUANT));
  if (mask & FIELD_HP) out.push(entry.hp as number, entry.maxHp as number);
  if (mask & FIELD_KIND) out.push(getCoopDefenseEnemyKindIndex(entry.kind as string));
  if (mask & FIELD_BURN) out.push(entry.burnStacks as number);
  if (mask & FIELD_FACTION) {
    out.push(entry.faction === 'allied' ? 1 : 0, entry.ownerId ?? '', entry.ownerColor ?? 0);
  }
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
    if (mask & FIELD_BURN) { entry.burnStacks = stream[i++] as number; }
    if (mask & FIELD_FACTION) {
      entry.faction = (stream[i++] as number) === 1 ? 'allied' : 'hostile';
      const ownerId = stream[i++] as string;
      entry.ownerId = ownerId || undefined;
      entry.ownerColor = stream[i++] as number;
    }
    result.push(entry);
  }
  return result;
}

/** Zählt die Upsert-Einträge im Strom, ohne Objekte zu allozieren (nur für Telemetrie). */
export function countEnemyUpserts(stream: readonly (number | string)[]): number {
  let count = 0;
  let i = 0;
  while (i + 1 < stream.length) {
    const mask = stream[i + 1] as number;
    i += 2;
    if (mask & FIELD_POS) i += 2;
    if (mask & FIELD_ROT) i += 1;
    if (mask & FIELD_HP) i += 2;
    if (mask & FIELD_KIND) i += 1;
    if (mask & FIELD_BURN) i += 1;
    if (mask & FIELD_FACTION) i += 3;
    count += 1;
  }
  return count;
}
