/**
 * Authored Boss-Intro-Presets. Der Host verzögert den Boss-Spawn um `emergeAtMs` und
 * repliziert Ort/Startzeit/Seed; Renderer leiten die Inszenierung aus diesem Anker
 * und der synchronisierten Zeit ab.
 */
export type BossIntroPresetId = 'graveyard-rise' | 'void-sparks';

export const BOSS_INTRO_PRESET_IDS: readonly BossIntroPresetId[] = ['graveyard-rise', 'void-sparks'];

/**
 * „Riss aus einer anderen Dimension“: Anomalie → Riss öffnet sich → Kollaps → Erscheinen.
 * Alle Zeiten ab Intro-Start; GPU-Funken und CPU-Riss lesen dieselbe Zeitachse.
 */
export const VOID_SPARKS_INTRO = {
  emergeAtMs: 5_200,
  durationMs: 7_800,
  spawnEdgeMarginCells: 5,
  /** Funken sickern ein, Bodenrisse kriechen aus. */
  anomalyEndMs: 1_400,
  /** Der Riss öffnet sich zuerst in der Länge, dann in der Breite. */
  riftOpenStartMs: 1_200,
  riftOpenEndMs: 3_300,
  /** Der Riss zieht sich zur Linie zusammen; danach ein kurzer Moment Stille. */
  collapseStartMs: 4_550,
  collapseEndMs: 4_950,
  riftLengthPx: 260,
  riftWidthPx: 92,
  veinRadiusPx: 230,
  shockwaveRadiusPx: 440,
  shockwaveMs: 750,
  scarFadeMs: 2_200,
  arcs: { startMs: 2_100, endMs: 4_550, minIntervalMs: 140, maxIntervalMs: 340, reachPx: 230 },
  rumble: { startMs: 2_000, amplitudePx: 8 },
  camera: { panInMs: 1_400, holdAfterEmergeMs: 1_300, panOutMs: 1_300, zoom: 1.5 },
} as const;

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

export function getBossIntroPreset(id: 'graveyard-rise'): GraveyardRiseIntroPreset;
export function getBossIntroPreset(id: 'void-sparks'): typeof VOID_SPARKS_INTRO;
export function getBossIntroPreset(id: BossIntroPresetId): GraveyardRiseIntroPreset | typeof VOID_SPARKS_INTRO;
export function getBossIntroPreset(id: BossIntroPresetId): GraveyardRiseIntroPreset | typeof VOID_SPARKS_INTRO {
  switch (id) {
    case 'graveyard-rise':
      return GRAVEYARD_RISE_INTRO;
    case 'void-sparks':
      return VOID_SPARKS_INTRO;
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
