/**
 * Tageszeit als kontinuierlicher Parameter der Beleuchtung.
 *
 * Es gibt genau **eine** Rechenvorschrift für Licht, unabhängig von der Uhrzeit: die
 * Lightmap wird mit `ambientColor` gefüllt, Lichter werden additiv hineingestempelt, und
 * das Ergebnis multipliziert die Szene. Die Uhrzeit ändert ausschließlich Werte, nie den
 * Pfad. Zwei Punkte der Kurve sind dabei besonders:
 *
 * - **12:00** liefert `0xffffff`. Phasers MULTIPLY ist `blendFunc(DST_COLOR,
 *   ONE_MINUS_SRC_ALPHA)`; bei weißer Quelle mit Alpha 1 ist das Ergebnis bit-exakt das
 *   Ziel. Der Mittag ist also ein echter No-Op und kostet keinen Renderpass.
 * - **00:00** liefert die Werte, mit denen das frühere Nachtprofil abgestimmt war.
 *
 * Weil MULTIPLY nur abdunkeln kann, tragen Lichter zum Mittag hin von selbst immer
 * weniger bei – das ersetzt die früheren `day`-Overrides der einzelnen Lichtpresets.
 *
 * Es gibt bewusst keinen Wechsel während einer Runde: die statischen Schatten werden
 * beim Rundenaufbau gebacken, ein laufender Wechsel würde sie jedes Mal neu erzwingen.
 *
 * Das Modul ist absichtlich frei von Phaser- und Szenenbezug: eine reine Tabelle plus
 * Interpolation, damit die Kurve ohne Renderer testbar bleibt.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Mittag: weißes Ambient, keine Lightmap-Kosten. Gilt für alle Nicht-Coop-Modi. */
export const DEFAULT_TIME_OF_DAY_MINUTES = 12 * 60;

export interface SkyState {
  /** Grundhelligkeit der Lightmap. `0xffffff` = Composite ist ein No-Op. */
  readonly ambientColor: number;
  /** Skaliert jede dynamische Lichtquelle (0 = Lichter tragen nichts bei). */
  readonly lightFactor: number;
  /**
   * Baumkronen liegen über dem Overlay und werden einzeln eingefärbt. Der Faktor dämpft,
   * wie stark bodennahe Lichtquellen sie erreichen – eine Näherung der Kronenhöhe.
   */
  readonly canopyLightFactor: number;
  /**
   * Künstliche Lichter, die man nur bei Dunkelheit einschaltet: Taschenlampen der Spieler
   * und die Zugbeleuchtung. 0 bedeutet, dass sie gar nicht erst angemeldet werden.
   */
  readonly artificialLightFactor: number;
  readonly shadowOpacityMult: number;
  readonly shadowLengthMult: number;
  readonly shadowSoftnessMult: number;
  /**
   * Globaler Alphafaktor additiver Effektgrafiken. Additive Sprites liegen teils über dem
   * Lightmap-Overlay und werden von `ambientColor` gar nicht erfasst; über hellem Boden
   * brennen sie ohne diese Dämpfung aus. Nachts 1 – die Nachtoptik bleibt unangetastet.
   */
  readonly emissiveScale: number;
  /**
   * Platzhalter für einen späteren additiven Zweitpass ("Licht, das über die Szene
   * hinausleuchtet"). MULTIPLY allein kann nur abdunkeln, ein warmes Licht auf warmem
   * Abendambient liest sich deshalb entsättigend statt wärmend. Der Ausbau wäre eine
   * komplette zusätzliche Fullscreen-Stufe; bis dahin bleibt der Wert überall 0.
   */
  readonly bleedFactor: number;
}

interface SkyKeyframe extends SkyState {
  readonly atMinute: number;
}

/**
 * Die Tabelle ist die einzige Tuning-Oberfläche der Tageszeit.
 *
 * Alle Werte sind von Hand gesetzt und **nicht** aus der Helligkeit abgeleitet. Eine
 * skalare Ableitung würde "wie hell ist es" mit "ab wann zählt Licht" verkoppeln und
 * könnte die kanalweise Asymmetrie von MULTIPLY ohnehin nicht ausdrücken: gegen ein
 * warmes Ambient hat ein warmes Licht im Rotkanal keinen Spielraum mehr, ein kaltes
 * schon.
 *
 * Zwei Nachtstufen mit bewusst breiten Plateaus, damit eine Map nicht auf die Minute
 * genau treffen muss: tiefe Nacht (23:30–03:00) und Mondnacht (04:00–05:00, 21:30–22:30),
 * in der Silhouetten auch ohne Taschenlampe lesbar bleiben.
 */
const SKY_KEYFRAMES: readonly SkyKeyframe[] = [
  // Tiefe Nacht – die Werte, mit denen das frühere Nachtprofil abgestimmt war.
  { atMinute: 0 * 60, ambientColor: 0x161a24, lightFactor: 1, canopyLightFactor: 0.45, artificialLightFactor: 1, shadowOpacityMult: 0.15, shadowLengthMult: 1.9, shadowSoftnessMult: 1.8, emissiveScale: 1, bleedFactor: 0 },
  { atMinute: 3 * 60, ambientColor: 0x161a24, lightFactor: 1, canopyLightFactor: 0.45, artificialLightFactor: 1, shadowOpacityMult: 0.15, shadowLengthMult: 1.9, shadowSoftnessMult: 1.8, emissiveScale: 1, bleedFactor: 0 },
  // Mondnacht: heller Boden, Silhouetten ohne Licht erkennbar.
  { atMinute: 4 * 60, ambientColor: 0x242a38, lightFactor: 0.92, canopyLightFactor: 0.42, artificialLightFactor: 1, shadowOpacityMult: 0.22, shadowLengthMult: 1.9, shadowSoftnessMult: 1.72, emissiveScale: 0.98, bleedFactor: 0 },
  { atMinute: 5 * 60, ambientColor: 0x242a38, lightFactor: 0.92, canopyLightFactor: 0.42, artificialLightFactor: 1, shadowOpacityMult: 0.22, shadowLengthMult: 1.9, shadowSoftnessMult: 1.72, emissiveScale: 0.98, bleedFactor: 0 },
  // Früher Morgen: leicht cyanfarben, bevor das direkte Sonnenlicht einsetzt.
  { atMinute: 5 * 60 + 45, ambientColor: 0x4f6f78, lightFactor: 0.78, canopyLightFactor: 0.36, artificialLightFactor: 0.85, shadowOpacityMult: 0.32, shadowLengthMult: 1.88, shadowSoftnessMult: 1.52, emissiveScale: 0.94, bleedFactor: 0 },
  // Morgengrauen: klares, helles Gelb statt des bisherigen grauen Rosatons.
  { atMinute: 6 * 60 + 45, ambientColor: 0x8a7a80, lightFactor: 0.48, canopyLightFactor: 0.22, artificialLightFactor: 0.4, shadowOpacityMult: 0.42, shadowLengthMult: 1.8, shadowSoftnessMult: 1.25, emissiveScale: 0.82, bleedFactor: 0 },
  { atMinute: 7 * 60 + 45, ambientColor: 0xc9a894, lightFactor: 0.26, canopyLightFactor: 0.12, artificialLightFactor: 0.1, shadowOpacityMult: 0.58, shadowLengthMult: 1.75, shadowSoftnessMult: 1.1, emissiveScale: 0.7, bleedFactor: 0 },
  { atMinute: 9 * 60, ambientColor: 0xefe2d6, lightFactor: 0.08, canopyLightFactor: 0.04, artificialLightFactor: 0, shadowOpacityMult: 0.67, shadowLengthMult: 1.12, shadowSoftnessMult: 1.02, emissiveScale: 0.6, bleedFactor: 0 },
  // Mittag: weiß, damit das Composite exakt zum No-Op wird.
  { atMinute: 12 * 60, ambientColor: 0xffffff, lightFactor: 0, canopyLightFactor: 0, artificialLightFactor: 0, shadowOpacityMult: 1, shadowLengthMult: 1, shadowSoftnessMult: 1, emissiveScale: 0.55, bleedFactor: 0 },
  { atMinute: 15 * 60, ambientColor: 0xfdf4e8, lightFactor: 0.03, canopyLightFactor: 0.01, artificialLightFactor: 0, shadowOpacityMult: 0.79, shadowLengthMult: 1.06, shadowSoftnessMult: 1.01, emissiveScale: 0.57, bleedFactor: 0 },
  // Nachmittag: kräftiges Goldgelb als Gegenstück zum klaren Morgenlicht.
  { atMinute: 17 * 60, ambientColor: 0xf3ddc0, lightFactor: 0.1, canopyLightFactor: 0.05, artificialLightFactor: 0, shadowOpacityMult: 0.65, shadowLengthMult: 1.2, shadowSoftnessMult: 1.05, emissiveScale: 0.62, bleedFactor: 0 },
  // Sonnenuntergang: sattes Orange, anschließend tiefes Rot.
  { atMinute: 18 * 60 + 45, ambientColor: 0xf47722, lightFactor: 0.24, canopyLightFactor: 0.11, artificialLightFactor: 0.08, shadowOpacityMult: 0.56, shadowLengthMult: 1.58, shadowSoftnessMult: 1.32, emissiveScale: 0.71, bleedFactor: 0 },
  { atMinute: 19 * 60 + 45, ambientColor: 0xc93624, lightFactor: 0.44, canopyLightFactor: 0.2, artificialLightFactor: 0.35, shadowOpacityMult: 0.44, shadowLengthMult: 1.68, shadowSoftnessMult: 1.48, emissiveScale: 0.8, bleedFactor: 0 },
  // Dämmerung nach Sonnenuntergang: deutlich gesättigteres Violett/Dunkelblau.
  { atMinute: 20 * 60 + 45, ambientColor: 0x4b2678, lightFactor: 0.72, canopyLightFactor: 0.33, artificialLightFactor: 0.8, shadowOpacityMult: 0.24, shadowLengthMult: 1.7, shadowSoftnessMult: 1.7, emissiveScale: 0.92, bleedFactor: 0 },
  { atMinute: 21 * 60 + 30, ambientColor: 0x242a28, lightFactor: 0.92, canopyLightFactor: 0.42, artificialLightFactor: 1, shadowOpacityMult: 0.22, shadowLengthMult: 1.9, shadowSoftnessMult: 1.72, emissiveScale: 0.98, bleedFactor: 0 },
  { atMinute: 22 * 60 + 30, ambientColor: 0x242a38, lightFactor: 0.92, canopyLightFactor: 0.42, artificialLightFactor: 1, shadowOpacityMult: 0.22, shadowLengthMult: 1.9, shadowSoftnessMult: 1.72, emissiveScale: 0.98, bleedFactor: 0 },
  { atMinute: 23 * 60 + 30, ambientColor: 0x161a24, lightFactor: 1, canopyLightFactor: 0.45, artificialLightFactor: 1, shadowOpacityMult: 0.15, shadowLengthMult: 1.9, shadowSoftnessMult: 1.8, emissiveScale: 1, bleedFactor: 0 },
];

/** Ambient, bei dem das MULTIPLY-Composite nachweislich nichts tut. */
export const NEUTRAL_AMBIENT_COLOR = 0xffffff;

/** Bringt beliebige Minutenwerte zyklisch nach `[0, MINUTES_PER_DAY)`. */
export function normalizeTimeOfDay(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_TIME_OF_DAY_MINUTES;
  const wrapped = Math.round(minutes) % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

/** `"HH:MM"` → Minuten seit Mitternacht. `null` für alles, was nicht passt. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minuten seit Mitternacht → `"HH:MM"`. */
export function formatTimeOfDay(minutes: number): string {
  const normalized = normalizeTimeOfDay(minutes);
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Zustand des Himmels zur gegebenen Uhrzeit.
 *
 * Wird nicht pro Frame aufgerufen, sondern beim Rundenaufbau und beim Ziehen des
 * Debug-Reglers; die lineare Suche über die Tabelle ist deshalb unkritisch.
 */
export function resolveSkyState(minutes: number): SkyState {
  const time = normalizeTimeOfDay(minutes);

  let previous = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  let next = SKY_KEYFRAMES[0];
  for (let index = 0; index < SKY_KEYFRAMES.length; index += 1) {
    const frame = SKY_KEYFRAMES[index];
    if (frame.atMinute === time) return stripKeyframe(frame);
    if (frame.atMinute > time) {
      next = frame;
      previous = index === 0
        ? SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1]
        : SKY_KEYFRAMES[index - 1];
      break;
    }
    // Hinter dem letzten Keyframe: zurück zum ersten, über Mitternacht hinweg.
    if (index === SKY_KEYFRAMES.length - 1) {
      previous = frame;
      next = SKY_KEYFRAMES[0];
    }
  }

  // Der Abstand wird zyklisch gemessen, damit das Segment 23:30 → 00:00 dieselbe
  // Interpolation bekommt wie jedes andere.
  const span = wrapForward(next.atMinute - previous.atMinute);
  const offset = wrapForward(time - previous.atMinute);
  const t = span === 0 ? 0 : offset / span;

  return {
    ambientColor: mixChannels(previous.ambientColor, next.ambientColor, t),
    lightFactor: lerp(previous.lightFactor, next.lightFactor, t),
    canopyLightFactor: lerp(previous.canopyLightFactor, next.canopyLightFactor, t),
    artificialLightFactor: lerp(previous.artificialLightFactor, next.artificialLightFactor, t),
    shadowOpacityMult: lerp(previous.shadowOpacityMult, next.shadowOpacityMult, t),
    shadowLengthMult: lerp(previous.shadowLengthMult, next.shadowLengthMult, t),
    shadowSoftnessMult: lerp(previous.shadowSoftnessMult, next.shadowSoftnessMult, t),
    emissiveScale: lerp(previous.emissiveScale, next.emissiveScale, t),
    bleedFactor: lerp(previous.bleedFactor, next.bleedFactor, t),
  };
}

function stripKeyframe(frame: SkyKeyframe): SkyState {
  const { atMinute: _atMinute, ...state } = frame;
  return state;
}

function wrapForward(delta: number): number {
  const wrapped = delta % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixChannels(from: number, to: number, amount: number): number {
  const red = Math.round((from >> 16 & 0xff) + ((to >> 16 & 0xff) - (from >> 16 & 0xff)) * amount);
  const green = Math.round((from >> 8 & 0xff) + ((to >> 8 & 0xff) - (from >> 8 & 0xff)) * amount);
  const blue = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * amount);
  return (red << 16) | (green << 8) | blue;
}
