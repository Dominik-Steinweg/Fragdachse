import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { GpuVfxEase } from './GpuVfxEase';

/**
 * GpuVfxRenderLanes – der Manifest aller physischen `SpriteGPULayer`.
 *
 * Eine **Render-Lane** ist genau ein Layer. Ein **logischer Effekt** ist etwas anderes und steht
 * in `GpuVfxEffects.ts`: mehrere Effekte duerfen sich eine kompatible Lane teilen, und ein Effekt
 * darf je nach Variante verschiedene Lanes benutzen. Ohne diese Trennung waechst die Layerzahl
 * mit der Effektzahl, und genau das soll die Architektur verhindern.
 *
 * ## Wann zwei Effekte dieselbe Lane benutzen duerfen
 *
 * Notwendig ist Gleichheit in allem, was *layerglobal* ist:
 * Depth, Blend-Mode, Textur (durch den Atlas immer erfuellt), `gravity`, Scroll-/Kamera-Verhalten,
 * Lighting. Nicht relevant sind alle Eigenschaften, die pro Member existieren: Position, Frame,
 * Rotation, Scale, Alpha, Tint, Lebenszeit, Creation Time.
 *
 * Hinreichend ist das aber nicht. Zusaetzlich gilt:
 *
 * 1. **Zeichenreihenfolge.** Innerhalb einer Lane ist die Reihenfolge die Slot-Index-Reihenfolge,
 *    und Slots werden recycelt. Teilen duerfen sich eine Lane deshalb nur Effekte, deren
 *    gegenseitige Reihenfolge egal ist – oder die sich nie ueberlappen. Phasers ADD ist
 *    `[ONE, DST_ALPHA, ONE, DST_ALPHA]`; kommutativ ist das nur dort, wo `dstAlpha` bereits auf 1
 *    gesaettigt ist, also ueber opaker Geometrie. Deshalb heisst die Policy `add-over-opaque` und
 *    nicht `orderIndependent`: sie ist eine Ortsbedingung, keine globale Eigenschaft.
 * 2. **Co-Activity.** Eine Lane wird gezeichnet, sobald *irgendein* Effekt darauf lebt – mit
 *    `instanceCount = memberCount`. Ein selten aktiver Effekt zahlt dann die Kapazitaet aller
 *    Mitbewohner. `GpuVfxProfiler` misst das ueber `visibleFrames` und `coVisibleFrames`.
 * 3. **Lebenszeitspreizung.** Der Ring-Allokator vergibt Slots der Reihe nach; die laengste
 *    Lebenszeit bestimmt, wie lange ein Slot blockiert. `maxLifetimeMs` macht die Kapazitaet
 *    ueberhaupt erst nachvollziehbar: `capacity >~ peakSpawnRate * maxLifetimeMs`.
 */

/**
 * Geteilte Layer entstehen beim Szenenaufbau, die urspruenglichen Emitter entstanden zur Laufzeit
 * und lagen bei gleicher Depth deshalb ueber Spielern, Felsen und Projektilkoerpern. Dieser
 * Versatz haelt die Reihenfolge, ohne ein bestehendes Tiefenband zu verlassen: er ist deutlich
 * kleiner als der kleinste vorhandene Abstand (DEPTH.ROCKS 9 -> DEPTH.ROCK_MOSS 9.08).
 */
export const GPU_VFX_DEPTH_EPSILON = 0.001;

export const GpuVfxLaneId = {
  AirstrikeSpark: 0,
  AirstrikeBomb:  1,
  RocketExhaust:  2,
  RocketSmoke:    3,
  StinkNormal:    4,
  StinkAdd:       5,
  FlameOuter:     6,
  FlameCore:      7,
  FlameSpark:     8,
} as const;

export type GpuVfxLaneId = (typeof GpuVfxLaneId)[keyof typeof GpuVfxLaneId];

/**
 * `ordered`: die Reihenfolge innerhalb der Lane ist sichtbar (NORMAL-Blend mit merklicher Alpha).
 * `add-over-opaque`: additiv ueber opaker Geometrie, die Reihenfolge ist rechnerisch egal.
 */
export type GpuVfxOrderPolicy = 'ordered' | 'add-over-opaque';

export interface GpuVfxLaneSpec {
  readonly id: GpuVfxLaneId;
  /** Erscheint in Diagnose, Profiler-Report und Kapazitaetswarnungen. */
  readonly label: string;
  readonly depth: number;
  readonly blendMode: number;
  /** Nur fuer `GpuVfxEase.Gravity`: Beschleunigung in px/s². Layerglobal. */
  readonly gravity?: number;
  /** Alle Eases, die Effekte auf dieser Lane benutzen duerfen; werden bei Init vorgewaermt. */
  readonly eases: readonly GpuVfxEase[];
  readonly capacity: number;
  readonly maxLifetimeMs: number;
  readonly order: GpuVfxOrderPolicy;
  /**
   * Logische Reserve: die letzten `reserveCritical` freien Slots nimmt nur `critical` an. Bewusst
   * ein Vergleich auf `liveCount` und kein physisch reservierter Indexbereich – der wuerde den
   * Ring fragmentieren und die Slot-Lokalitaet der Buffer-Uploads verschlechtern.
   */
  readonly reserveCritical: number;
  /** Warum diese Lane existiert und nicht mit einer anderen zusammenfaellt. */
  readonly rationale: string;
  /** Herleitung der Kapazitaet. */
  readonly capacityRationale: string;
}

const STINK_DEPTH = DEPTH.STINK;

/**
 * Reihenfolge = `GpuVfxLaneId`. Die Lanes stehen hier in der Reihenfolge, in der sie erzeugt
 * werden; bei unterschiedlichen Depths ist das ohne Belang, wird aber eingehalten, damit die
 * Diagnoseausgabe stabil bleibt.
 */
export const GPU_VFX_LANES: readonly GpuVfxLaneSpec[] = [
  {
    id: GpuVfxLaneId.AirstrikeSpark,
    label: 'airstrike-spark',
    depth: DEPTH.PLAYERS - 1 + GPU_VFX_DEPTH_EPSILON,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 1024,
    maxLifetimeMs: 480,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes Tiefenband unter den Spielern. Die Spieler sind CPU-GameObjects und liegen '
      + 'zwischen dieser Lane und der Bomb-Lane; ein Zusammenlegen wuerde die Funken ueber die '
      + 'Spieler heben.',
    capacityRationale:
      'Worst Case Eroeffnungs-Sweep Map 11: bis zu neun gleichzeitige Strikes, Endfrequenz 15 ms '
      + 'bei bis zu 480 ms Lebenszeit, also rund 290 gleichzeitig lebende Member.',
  },
  {
    id: GpuVfxLaneId.AirstrikeBomb,
    label: 'airstrike-bomb',
    depth: DEPTH.PLAYERS + GPU_VFX_DEPTH_EPSILON,
    blendMode: Phaser.BlendModes.ADD,
    // `gravityFactor: 1` wird als 0 kodiert und vom Shader wieder als 1 gelesen – exakt die
    // fruehere `accelerationY: 30`.
    gravity: 30,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 1024,
    maxLifetimeMs: 460,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes Tiefenband ueber den Spielern, und `layer.gravity` ist layerglobal: nur die Bomben '
      + 'fallen mit 30 px/s². Eine Lane mit abweichender Gravity kann diese nicht mitbenutzen.',
    capacityRationale:
      'Worst Case wie bei den Funken, Endfrequenz 20 ms bei bis zu 460 ms Lebenszeit, also rund '
      + '210 gleichzeitig lebende Member.',
  },
  {
    id: GpuVfxLaneId.RocketExhaust,
    label: 'rocket-exhaust',
    depth: DEPTH.PROJECTILES + GPU_VFX_DEPTH_EPSILON,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 2048,
    maxLifetimeMs: 140,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes Tiefenband knapp ueber den Projektilkoerpern; der Raketen-Accent auf '
      + 'DEPTH.PROJECTILES + 1 bleibt darueber.',
    capacityRationale:
      'Alle 14 ms bei bis zu 140 ms Lebenszeit, also rund zehn Member je Rakete. 2048 traegt ueber '
      + '200 gleichzeitige Raketen.',
  },
  {
    id: GpuVfxLaneId.RocketSmoke,
    label: 'rocket-smoke',
    // Der Smoke-Emitter entstand schon beim Szenenaufbau und lag bei gleicher Depth ohnehin unter
    // allem zur Laufzeit Erzeugten – hier braucht es keinen Epsilon-Versatz.
    depth: DEPTH.FIRE,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
    capacity: 640,
    maxLifetimeMs: 1000,
    order: 'ordered',
    reserveCritical: 0,
    rationale:
      'NORMAL-Blend mit Start-Alpha 0.95: die Reihenfolge innerhalb der Lane ist sichtbar, frische '
      + 'Puffs muessen ueber aelteren liegen. Teilen darf sich diese Lane deshalb niemand.',
    capacityRationale:
      'Entspricht dem fruehreren `maxAliveParticles: 640` des geteilten Emitters – ein '
      + 'Kapazitaets-Drop ist hier der nachgebildete Deckel, kein Hinweis auf zu wenig Platz.',
  },
  {
    id: GpuVfxLaneId.StinkNormal,
    label: 'stink-normal',
    // Frueher zwei Lanes: inner auf STINK_DEPTH + Epsilon, plume auf + 0.02. Der Epsilon-Versatz
    // stammte daher, dass `inner` exakt auf dem Container mit Haze und Blobs lag und der Emitter
    // je Wolke zur Laufzeit *nach* dem Container entstand. Beide liegen jetzt auf + 0.02, also
    // weiterhin ueber dem Container.
    depth: STINK_DEPTH + 0.02,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear],
    capacity: 1280,
    maxLifetimeMs: 2600,
    order: 'ordered',
    reserveCritical: 0,
    rationale:
      'NORMAL-Blend, muss ueber dem Haze/Blob-Container auf STINK_DEPTH liegen. Traegt die nicht-'
      + 'additiven Varianten von inner und plume. Die beiden untereinander sind reihenfolge-'
      + 'unkritisch: ihre Partikel-Alphas liegen bei 0.02 bis 0.03, der Fehler beim Vertauschen '
      + 'ist ihr Produkt (~0.0016) und damit weit unter der Wahrnehmungsschwelle.',
    capacityRationale:
      'Summe der beiden fruehreren Lanes (512 + 768). Bemessen am unguenstigsten realistischen '
      + 'Fall: dauerhaft 50-ms-Frames, bei denen die framerate-gekoppelte Emission ueberhaupt '
      + 'erst anspringt, mit rund sechs Wolken – je Wolke rund 54 (inner) und 80 (plume) '
      + 'gleichzeitig lebende Member. Erst gegen gemessenes `peakLive` reduzieren.',
  },
  {
    id: GpuVfxLaneId.StinkAdd,
    label: 'stink-add',
    // Frueher vier Lanes: inner + 0.001, plume + 0.02, accent + 0.03, edge + 0.04.
    depth: STINK_DEPTH + 0.04,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 3328,
    maxLifetimeMs: 2600,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Additiv ueber dem opaken Arenaboden und damit reihenfolgeunabhaengig: traegt accent, edge '
      + 'und die additiven Varianten von inner und plume. Getrennt von stink-normal, weil der '
      + 'Blend-Mode layerglobal ist. Dokumentierte Abweichung: die additive inner-Variante wandert '
      + 'von + 0.001 auf + 0.04 und kreuzt dabei stink-normal (+ 0.02). Der Fehler ist das Produkt '
      + 'aus der plume-Alpha (<= 0.029) und dem additiven Beitrag, also <= 3 %, und tritt nur dort '
      + 'auf, wo sich Wolken *unterschiedlicher* Variante ueberlappen.',
    capacityRationale:
      'Summe der vier fruehreren Lanes (512 + 768 + 512 + 1536). Je Wolke rund 54 (inner), 80 '
      + '(plume), 50 (accent) und 222 (edge) gleichzeitig lebende Member im 50-ms-Fall, sechs '
      + 'Wolken. Erst gegen gemessenes `peakLive` reduzieren.',
  },
  {
    id: GpuVfxLaneId.FlameOuter,
    label: 'flame-outer',
    depth: DEPTH.FIRE,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 3072,
    maxLifetimeMs: 450,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Flammenband auf DEPTH.FIRE; die Outer-Partikel entsprechen dem alten '
      + 'Emitter und muessen unter Core und Spark bleiben.',
    capacityRationale:
      '48 plausible parallele Hitboxen x 2 Spawns / 20 ms x 450 ms = 2160 lebende Member; '
      + '3072 gibt rund 42 Prozent Reserve fuer Burst- und Timing-Schwankungen.',
  },
  {
    id: GpuVfxLaneId.FlameCore,
    label: 'flame-core',
    depth: DEPTH.FIRE + 0.05,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 2304,
    maxLifetimeMs: 280,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Flammenband ueber Outer; Core bleibt damit in derselben Tiefenstaffelung '
      + 'wie der bisherige per-Hitbox-Emitter.',
    capacityRationale:
      '48 plausible parallele Hitboxen x 2 Spawns / 16 ms x 280 ms = 1680 lebende Member; '
      + '2304 gibt rund 37 Prozent Reserve fuer Burst- und Timing-Schwankungen.',
  },
  {
    id: GpuVfxLaneId.FlameSpark,
    label: 'flame-spark',
    depth: DEPTH.FIRE + 0.1,
    blendMode: Phaser.BlendModes.ADD,
    gravity: -30,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 512,
    maxLifetimeMs: 300,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Spark-Band ueber Core; die Lane traegt die layerglobale Gravity von -30 '
      + 'px/s² und darf deshalb keine anderen Flows aufnehmen.',
    capacityRationale:
      '48 plausible parallele Hitboxen x 1 Spawn / 50 ms x 300 ms = 288 lebende Member; '
      + '512 gibt rund 78 Prozent Reserve fuer Burst- und Timing-Schwankungen.',
  },
];
