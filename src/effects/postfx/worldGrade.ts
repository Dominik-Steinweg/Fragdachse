/**
 * Basis-Bildkomposition der Spielwelt. Ohne Phaser-Import, damit die Grenzen der Lesbarkeit
 * prüfbar sind statt nur behauptet.
 *
 * Verantwortungsabgrenzung: das Licht- und Tageszeitsystem behält die Hauptverantwortung für
 * Helligkeit und Atmosphäre. Das Grading ist ein kleiner Trimm darüber und wird deshalb aus
 * demselben {@link SkyState} abgeleitet – sonst könnten beide auseinanderlaufen.
 */

import type { SkyState } from '../TimeOfDay';

export interface WorldGrade {
  /** 1 = neutral. */
  readonly saturation: number;
  readonly contrast: number;
  readonly brightness: number;
  /** −1 kalt … +1 warm. */
  readonly temperature: number;
  readonly tint: number;
  readonly tintStrength: number;
  readonly vignetteRadius: number;
  readonly vignetteStrength: number;
  /** Helligkeitsschwelle, ab der ein Pixel in den Bloom eingeht. */
  readonly bloomThreshold: number;
  readonly bloomAmount: number;
}

export interface WorldGradeInputs {
  readonly skyState: SkyState;
  readonly isVoidMap: boolean;
  /** 0 = keine Bossphase. */
  readonly bossPhase: number;
  /** 1 … 0 */
  readonly localHpFraction: number;
  readonly gamePhase: 'LOBBY' | 'ARENA';
}

/**
 * Harte Grenzen. Sie werden in {@link resolveBaseGrade} erzwungen und im Test geprüft, damit
 * keine spätere Abstimmung Telegraphen, Spielerfarben oder Gefahrenhinweise unleserlich macht.
 */
export const WORLD_GRADE_CLAMPS = {
  saturation: [0.80, 1.12],
  contrast: [0.92, 1.18],
  brightness: [0.94, 1.08],
  temperature: [-1, 1],
  tintStrength: [0, 0.40],
  /**
   * Untergrenze ist **kein** Geschmackswert. Phasers Vignette mischt außerhalb des Radius
   * **voll** zur Vignettenfarbe (`vignette = 1.0` als Mix-Faktor), innerhalb dagegen weich über
   * `sin(g·π·strength)`. Die Bildecke liegt bei `sqrt(0.5² + 0.5²) ≈ 0.707`; ein kleinerer
   * Radius erzeugt dort einen harten schwarzen Rand statt eines Verlaufs. Die Stärke steuert
   * die Intensität, der Radius bleibt jenseits der Ecke.
   */
  vignetteRadius: [0.75, 1.2],
  // Obergrenze bewusst moderat: `sin(g·π·strength)` erreicht bei 0.5 bereits rund 85 % Abdunklung
  // in den Ecken. Darüber verschluckt die Vignette Gegner am Bildrand.
  vignetteStrength: [0, 0.5],
  bloomThreshold: [0.30, 0.95],
  bloomAmount: [0, 0.85],
} as const;

/**
 * Weitere Grenzen für die Dauer eines Ereignisses. Die engen Grenzen oben schützen das
 * **Dauerbild**; ein Nuke-Belichtungsstoß oder der eigene Tod dürfen kurzzeitig deutlicher
 * ausschlagen, ohne dass dadurch der Normalzustand aufgeweicht wird.
 */
export const POST_FX_PULSE_CLAMPS = {
  saturation: [0.45, 1.35],
  contrast: [0.85, 1.45],
  brightness: [0.88, 1.30],
  temperature: [-1, 1],
  tintStrength: [0, 0.65],
  vignetteRadius: [0.75, 1.2],
  vignetteStrength: [0, 0.80],
  bloomThreshold: [0.20, 0.95],
  bloomAmount: [0, 1.2],
} as const;

export const NEUTRAL_WORLD_GRADE: WorldGrade = {
  saturation: 1,
  contrast: 1,
  brightness: 1,
  temperature: 0,
  tint: 0xffffff,
  tintStrength: 0,
  vignetteRadius: 1,
  vignetteStrength: 0,
  bloomThreshold: 0.8,
  bloomAmount: 0,
};

const VOID_TINT = 0x8a5cff;
const NIGHT_TINT = 0x7fa8ff;
const BOSS_TINT = 0xff6a4a;

function clamp(value: number, range: readonly [number, number]): number {
  if (!Number.isFinite(value)) return range[0];
  return value < range[0] ? range[0] : value > range[1] ? range[1] : value;
}

/** Wie dunkel es gerade ist: 0 am hellen Mittag, 1 in voller Nacht. */
export function resolveDarkness(sky: SkyState): number {
  const ambient = sky.ambientColor;
  const luminance =
    (((ambient >> 16) & 0xff) * 0.2126 + ((ambient >> 8) & 0xff) * 0.7152 + (ambient & 0xff) * 0.0722) / 255;
  return Math.min(1, Math.max(0, 1 - luminance));
}

/**
 * Der Bloom sieht die **beleuchtete** Welt: die Lichtkarte wird per MULTIPLY in denselben
 * Puffer komponiert, bevor die Kamerafilter laufen. Eine feste Schwelle blühte deshalb tagsüber
 * überall und nachts nirgends. Sie folgt darum der Helligkeit des Bildes.
 */
function resolveBloomThreshold(darkness: number): number {
  return clamp(0.62 - darkness * 0.22, WORLD_GRADE_CLAMPS.bloomThreshold);
}

export function resolveBaseGrade(inputs: WorldGradeInputs): WorldGrade {
  // In der Lobby wird nicht komponiert: dort gibt es keine Spielwelt zu führen, und ein
  // Grading würde nur die Menüdarstellung verfälschen.
  if (inputs.gamePhase === 'LOBBY') return NEUTRAL_WORLD_GRADE;

  const darkness = resolveDarkness(inputs.skyState);
  const hurt = 1 - Math.min(1, Math.max(0, inputs.localHpFraction));
  const bossActive = inputs.bossPhase > 0;

  // Nachts entsättigen und die Kontraste anziehen – das ist der Effekt, den das Auge bei
  // wenig Licht ohnehin erwartet, und er trennt Silhouetten besser vom Boden.
  let saturation = 1 - darkness * 0.18;
  let contrast = 1 + darkness * 0.12;
  let brightness = 1 - darkness * 0.04;

  let tint = darkness > 0.05 ? NIGHT_TINT : 0xffffff;
  let tintStrength = darkness * 0.28;
  let temperature = -darkness * 0.6;

  if (inputs.isVoidMap) {
    tint = VOID_TINT;
    tintStrength = Math.max(tintStrength, 0.3);
    saturation -= 0.06;
    contrast += 0.04;
  }

  if (bossActive) {
    tint = BOSS_TINT;
    tintStrength = Math.max(tintStrength, 0.22 + Math.min(0.14, inputs.bossPhase * 0.07));
    contrast += 0.06;
    temperature += 0.45;
  }

  // Niedrige Gesundheit ausschliesslich über Vignette und Entsättigung – kein Farbtonwechsel,
  // sonst verschieben sich Telegraph- und Teamfarben genau dann, wenn sie am wichtigsten sind.
  // Der Radius bleibt jenseits der Bildecke, die Intensität läuft allein über die Stärke.
  // Die Vignette rahmt ein Bild, sie verdunkelt es nicht zusätzlich. Nachts ist die Lightmap
  // ohnehin dunkel; ein mit der Dunkelheit wachsender Rand würde dort Gegner am Bildrand
  // verschlucken. Sie bleibt deshalb weitgehend konstant, und die Dramatik kommt aus der
  // Gesundheit.
  const vignetteStrength = 0.18 + darkness * 0.05 + hurt * 0.34;
  const vignetteRadius = 1.05 - hurt * 0.18;
  saturation -= hurt * 0.2;

  return {
    saturation: clamp(saturation, WORLD_GRADE_CLAMPS.saturation),
    contrast: clamp(contrast, WORLD_GRADE_CLAMPS.contrast),
    brightness: clamp(brightness, WORLD_GRADE_CLAMPS.brightness),
    temperature: clamp(temperature, WORLD_GRADE_CLAMPS.temperature),
    tint,
    tintStrength: clamp(tintStrength, WORLD_GRADE_CLAMPS.tintStrength),
    vignetteRadius: clamp(vignetteRadius, WORLD_GRADE_CLAMPS.vignetteRadius),
    vignetteStrength: clamp(vignetteStrength, WORLD_GRADE_CLAMPS.vignetteStrength),
    bloomThreshold: resolveBloomThreshold(darkness),
    bloomAmount: clamp(0.34 + darkness * 0.14, WORLD_GRADE_CLAMPS.bloomAmount),
  };
}

/**
 * Baut die 20-Werte-Matrix, die `Phaser.Display.ColorMatrix.multiply()` erwartet: eine
 * kanalweise Skalierung Richtung Farbtemperatur und Zielfarbton.
 *
 * Bewusst multiplikativ und nicht additiv – ein additiver Farbstich hellt schwarze Flächen auf
 * und zerstört den Schwarzwert, den Lightmap und Vignette gerade aufgebaut haben.
 */
export function buildTintMatrix(temperature: number, tint: number, strength: number): number[] {
  const s = clamp(strength, WORLD_GRADE_CLAMPS.tintStrength);
  const t = clamp(temperature, WORLD_GRADE_CLAMPS.temperature);

  const tintR = ((tint >> 16) & 0xff) / 255;
  const tintG = ((tint >> 8) & 0xff) / 255;
  const tintB = (tint & 0xff) / 255;

  // Wärme hebt Rot und senkt Blau; Kälte umgekehrt. Grün bleibt Anker, damit die
  // Gesamthelligkeit stabil bleibt.
  const warmR = 1 + t * 0.12;
  const warmB = 1 - t * 0.12;

  const r = (1 - s + s * tintR) * warmR;
  const g = 1 - s + s * tintG;
  const b = (1 - s + s * tintB) * warmB;

  return [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export function isNeutralGrade(grade: WorldGrade): boolean {
  return grade.saturation === 1
    && grade.contrast === 1
    && grade.brightness === 1
    && grade.tintStrength === 0
    && grade.vignetteStrength === 0
    && grade.bloomAmount === 0;
}
