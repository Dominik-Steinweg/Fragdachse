/**
 * Lokale Schaetzung des World-Ladefortschritts fuer die Ladeanzeige.
 *
 * Die gemessenen Ladegates verlaufen zeitlich sehr ungleich: der synchrone Aufbau ist schnell,
 * die letzten Render-Publikationen sind langsam. Deshalb merkt sich jeder Rechner, wie lange eine
 * World-Definition zuletzt brauchte, und mischt die daraus erwartete Zeitkurve mit dem Messwert.
 * Ohne Erfahrungswert zaehlt allein der Messwert. Bis zur Bereitschaft faellt die Schaetzung nie.
 */

export interface WorldLoadDurationStore {
  read(key: string): number | null;
  write(key: string, durationMs: number): void;
}

const STORAGE_KEY = 'fragdachse_world_load_durations';
/** Faellt zurueck, wenn diese World-Definition auf dem Rechner noch nie geladen wurde. */
const ANY_WORLD_KEY = '*';
/** Gewicht der Zeitkurve, sobald ein Erfahrungswert existiert. */
const TIME_WEIGHT = 0.6;
/** Neuer Messwert gegen alten Erfahrungswert; glaettet Ausreisser wie einen verborgenen Tab. */
const DURATION_BLEND = 0.5;
const MIN_RECORDED_MS = 300;
const MAX_RECORDED_MS = 60_000;

/**
 * Erwarteter Fortschritt bei `ratio` = verstrichene / erwartete Dauer: linear bis 96 %, danach
 * asymptotisch gegen 99 %, damit eine laengere Ladung nicht stehen bleibt und nie fertig wirkt.
 */
export function expectedWorldLoadTimeProgress(ratio: number): number {
  const r = Math.max(0, ratio);
  return r <= 1 ? 96 * r : 96 + 3 * (1 - Math.exp(-(r - 1) * 2));
}

export class WorldLoadProgressEstimator {
  private revision = -1;
  private startedAt = 0;
  private key: string | null = null;
  private expectedMs: number | null = null;
  private progress = 0;
  private recorded = false;

  constructor(private readonly store: WorldLoadDurationStore = browserWorldLoadDurationStore) {}

  /**
   * Liefert den anzuzeigenden Fortschritt (0–100) fuer `measured` (0–100) der World-Instanz
   * `revision`. Die erste Probe einer Revision startet die Uhr; `key` darf spaeter nachkommen.
   */
  sample(revision: number, key: string | null, measured: number, ready: boolean, now: number): number {
    if (revision !== this.revision) {
      this.revision = revision;
      this.startedAt = now;
      this.key = null;
      this.expectedMs = null;
      this.progress = 0;
      this.recorded = false;
    }
    if (key && key !== this.key) {
      this.key = key;
      this.expectedMs = this.store.read(key) ?? this.store.read(ANY_WORLD_KEY);
    }
    if (ready) {
      if (!this.recorded) this.record(now - this.startedAt);
      this.recorded = true;
      return (this.progress = 100);
    }
    const clamped = Math.max(0, Math.min(99, Number.isFinite(measured) ? measured : 0));
    // Nach der Bereitschaft streamt die World weiter; dann zaehlt wieder nur der Messwert.
    if (this.recorded) return clamped;
    const estimate = this.expectedMs
      ? TIME_WEIGHT * expectedWorldLoadTimeProgress((now - this.startedAt) / this.expectedMs)
        + (1 - TIME_WEIGHT) * clamped
      : clamped;
    this.progress = Math.max(this.progress, Math.min(99, estimate));
    return this.progress;
  }

  private record(elapsedMs: number): void {
    if (!this.key || !(elapsedMs >= MIN_RECORDED_MS && elapsedMs <= MAX_RECORDED_MS)) return;
    for (const key of [this.key, ANY_WORLD_KEY]) {
      const previous = this.store.read(key);
      this.store.write(key, previous ? previous + (elapsedMs - previous) * DURATION_BLEND : elapsedMs);
    }
  }
}

function readDurations(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** Komfortwert je Rechner: fehlt der Speicher, zeigt die Anzeige allein den Messwert. */
export const browserWorldLoadDurationStore: WorldLoadDurationStore = {
  read(key) {
    const value = readDurations()[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  },
  write(key, durationMs) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ ...readDurations(), [key]: Math.round(durationMs) }));
    } catch {
      // Privater Modus oder gesperrter Speicher: die Schaetzung bleibt beim Messwert.
    }
  },
};
