import type { PersistentBaseMutationIdentity } from './PersistentBaseTransaction';

/**
 * Weltgebundene Verschiebe-Anfrage fuer persistente Basisobjekte.
 *
 * Verbindlicher Zweck: **Eine Anfrage beschreibt eine Bewegung, keinen Neubau.** Sie benennt das
 * vorhandene Objekt und seine Zielzelle; welche persistente Identitaet dahintersteht, loest
 * ausschliesslich der Host aus seinem eigenen autoritativen Bestand auf. Ein Client kann dadurch
 * weder eine fremde Konstruktion noch einen anderen Reward adressieren, als er tatsaechlich
 * unter dem Cursor hatte.
 *
 * Quelle und Zielzelle sind absolute Rasterkoordinaten der aktuellen World. Die Quellzelle ist
 * bewusst Teil der Anfrage: Zusammen mit der Runtime-ID belegt sie, dass Client und Host beim
 * Commit noch dasselbe Objekt meinen.
 *
 * Der Winkel ist bewusst nicht Teil der Anfrage: Er entsteht wie beim regulaeren Bauen aus
 * Spielerposition und Zielzelle und wird deshalb host-seitig aus derselben Vorschau abgeleitet.
 */
export interface PersistentBaseMoveRequest extends PersistentBaseMutationIdentity {
  readonly sourceRuntimeId: number;
  readonly sourceGridX: number;
  readonly sourceGridY: number;
  readonly targetGridX: number;
  readonly targetGridY: number;
}

const MAX_GRID_COORDINATE = 1_000_000;

export function sanitizePersistentBaseMoveRequest(value: unknown): PersistentBaseMoveRequest | null {
  if (!isRecord(value)
    || !isSafeIntegerInRange(value.worldRevision, 0, Number.MAX_SAFE_INTEGER)
    || !isOptionalActivityRevision(value.activityRevision)
    || !isSafeIntegerInRange(value.sourceRuntimeId, 0, Number.MAX_SAFE_INTEGER)
    || !isSafeIntegerInRange(value.sourceGridX, -MAX_GRID_COORDINATE, MAX_GRID_COORDINATE)
    || !isSafeIntegerInRange(value.sourceGridY, -MAX_GRID_COORDINATE, MAX_GRID_COORDINATE)
    || !isSafeIntegerInRange(value.targetGridX, -MAX_GRID_COORDINATE, MAX_GRID_COORDINATE)
    || !isSafeIntegerInRange(value.targetGridY, -MAX_GRID_COORDINATE, MAX_GRID_COORDINATE)) {
    return null;
  }
  return {
    worldRevision: value.worldRevision,
    ...(value.activityRevision === undefined ? {} : { activityRevision: value.activityRevision }),
    sourceRuntimeId: value.sourceRuntimeId,
    sourceGridX: value.sourceGridX,
    sourceGridY: value.sourceGridY,
    targetGridX: value.targetGridX,
    targetGridY: value.targetGridY,
  };
}

function isOptionalActivityRevision(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}

function isSafeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
