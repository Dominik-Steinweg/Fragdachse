/**
 * Authored Boss-Intro-Presets. Der Host verzögert den Boss-Spawn um `emergeAtMs` und
 * repliziert Ort/Startzeit/Seed; Renderer leiten die gesamte Inszenierung deterministisch
 * aus diesen Werten und der synchronisierten Zeit ab.
 */
export type BossIntroPresetId = 'graveyard-rise';

export const BOSS_INTRO_PRESET_IDS: readonly BossIntroPresetId[] = ['graveyard-rise'];

export interface GraveyardRiseIntroPreset {
  /** Zeitpunkt (ab Intro-Start), an dem der Host den Boss spawnt. */
  readonly emergeAtMs: number;
  /** Gesamtlänge inklusive Nachklang (Fragmente, Rückschwenk). */
  readonly durationMs: number;
  /** Bevorzugter Mindestabstand des Spawnpunkts zum Kartenrand, damit die Szene nicht abgeschnitten wird. */
  readonly spawnEdgeMarginCells: number;
  readonly moonlight: {
    readonly fadeInMs: number;
    readonly fadeOutMs: number;
    readonly radius: number;
    readonly intensity: number;
    readonly color: number;
  };
  readonly tombstones: {
    readonly count: number;
    /** Halbachsen des Gräberfelds; die Gräber stehen in versetzten Reihen. */
    readonly fieldRadiusX: number;
    readonly fieldRadiusY: number;
    /** Freier Innenradius für das Aufwühlen. */
    readonly innerRadius: number;
    readonly rowSpacingPx: number;
    readonly columnSpacingPx: number;
    readonly riseStartMs: number;
    readonly riseStaggerMs: number;
    readonly riseDurationMs: number;
    /** Größe im Spiel (längste Kante in px; 32 px ≈ 1 m). */
    readonly sizePx: number;
    /** Breite eines Grabfelds in px. */
    readonly plotWidthPx: number;
    readonly sizeJitter: number;
  };
  readonly fireflies: {
    readonly count: number;
    readonly startMs: number;
    readonly orbitRadius: number;
  };
  readonly churn: {
    readonly startMs: number;
    readonly radius: number;
    readonly rumbleAmplitudePx: number;
  };
  readonly shatter: {
    readonly fragmentsPerStone: number;
    readonly fragmentLifetimeMs: number;
    readonly fragmentSpeed: number;
    readonly shockwaveRadius: number;
  };
  readonly camera: {
    readonly panInMs: number;
    /** Wie lange nach dem Durchbruch die Kamera noch auf dem Boss bleibt. */
    readonly holdAfterEmergeMs: number;
    readonly panOutMs: number;
    /** Zusaetzlicher Kamerazoom am Fokuspunkt (1 = kein Zoom). */
    readonly zoom: number;
  };
}

export const GRAVEYARD_RISE_INTRO: GraveyardRiseIntroPreset = {
  emergeAtMs: 5_600,
  durationMs: 8_000,
  spawnEdgeMarginCells: 5,
  moonlight: { fadeInMs: 900, fadeOutMs: 1_600, radius: 360, intensity: 1.15, color: 0xa9c4ff },
  tombstones: {
    count: 18,
    fieldRadiusX: 165,
    fieldRadiusY: 135,
    innerRadius: 60,
    rowSpacingPx: 64,
    columnSpacingPx: 36,
    riseStartMs: 600,
    riseStaggerMs: 120,
    riseDurationMs: 560,
    sizePx: 24,
    sizeJitter: 0.2,
    plotWidthPx: 26,
  },
  fireflies: { count: 20, startMs: 1_000, orbitRadius: 175 },
  churn: { startMs: 3_000, radius: 64, rumbleAmplitudePx: 6 },
  shatter: { fragmentsPerStone: 4, fragmentLifetimeMs: 1_500, fragmentSpeed: 260, shockwaveRadius: 190 },
  camera: { panInMs: 1_400, holdAfterEmergeMs: 1_100, panOutMs: 1_300, zoom: 1.45 },
};

export function getBossIntroPreset(id: BossIntroPresetId): GraveyardRiseIntroPreset {
  switch (id) {
    case 'graveyard-rise':
      return GRAVEYARD_RISE_INTRO;
  }
}

export function isBossIntroPresetId(value: unknown): value is BossIntroPresetId {
  return typeof value === 'string' && (BOSS_INTRO_PRESET_IDS as readonly string[]).includes(value);
}

/** Replizierter, Late-Join-fähiger Intro-Anker. */
export interface BossIntroState {
  readonly preset: BossIntroPresetId;
  readonly x: number;
  readonly y: number;
  readonly startedAtMs: number;
  readonly seed: number;
}

/** Validiert einen replizierten Intro-Anker; fremde oder kaputte Werte ergeben `null`. */
export function readBossIntroState(raw: unknown): BossIntroState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isBossIntroPresetId(value.preset)) return null;
  const { x, y, startedAtMs, seed } = value;
  if (![x, y, startedAtMs, seed].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  return {
    preset: value.preset,
    x: x as number,
    y: y as number,
    startedAtMs: startedAtMs as number,
    seed: (seed as number) >>> 0,
  };
}
