import * as Phaser from 'phaser';
import { DEPTH, DEPTH_FX } from '../../config';
import { GpuVfxEase } from './GpuVfxEase';
import {
  GpuVfxFrameAnimationId,
  type GpuVfxFrameAnimationId as GpuVfxFrameAnimationIdType,
} from './GpuVfxFrameAnimations';

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
 * Depth, Blend-Mode, Textur (durch den Atlas immer erfuellt), Scroll-/Kamera-Verhalten, Lighting.
 * Nicht relevant sind alle Eigenschaften, die pro Member existieren: Position, Frame, Rotation,
 * Scale, Alpha, Tint, Lebenszeit, Creation Time.
 *
 * Auch die Beschleunigung ist *kein* Trennkriterium, obwohl `layer.gravity` layerglobal ist: der
 * Shader rechnet `uGravity * gravityFactor`, und `gravityFactor` liegt pro Member. Eine Lane
 * deklariert deshalb die staerkste Beschleunigung ihrer Bewohner, die uebrigen skalieren sie ueber
 * `GpuVfxSpawnSpec.gravityFactor`. Nur das *Vorzeichen* ist gebunden – ein Faktor ausserhalb
 * [-1, 1] laesst sich nicht kodieren.
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
  GroundFire:      9,
  GroundFireSmoke: 10,
  EntityBurn:      11,
  ProjectileBurn:  12,
  WorldDebris:      13,
  ExplosionSpark:   14,
  ExplosionEmberDown: 15,
  ExplosionEmberUp: 16,
  ExplosionAccent:  17,
  ExplosionCascade: 18,
  ExplosionTrainChunk: 19,
  ExplosionTrainSpark: 20,
  ExplosionHolyCrown: 21,
  ExplosionTrainCore: 22,
  ExplosionNukePlume: 23,
  ExplosionNukeFallout: 24,
  ExplosionRegeneration: 25,
  ExplosionSmoke:       26,
  GoreNormal:            27,
  GoreAdd:               28,
  PowerUpPedestal:       29,
  MuzzleFlash:           30,
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
  /**
   * Nur fuer `GpuVfxEase.Gravity`: die *staerkste* Beschleunigung der Lane in px/s². Layerglobal.
   * Schwaechere Beschleunigungen laufen ueber `GpuVfxSpawnSpec.gravityFactor` (Shader:
   * `uGravity * gravityFactor`) und rechtfertigen deshalb keine eigene Lane.
   */
  readonly gravity?: number;
  /** Alle Eases, die Effekte auf dieser Lane benutzen duerfen; werden bei Init vorgewaermt. */
  readonly eases: readonly GpuVfxEase[];
  /** Optionale GPU-Framefolgen; werden nach dem Atlasbau und vor dem ersten Member registriert. */
  readonly frameAnimations?: readonly GpuVfxFrameAnimationIdType[];
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
    // QuadOut traegt die Ausdehnung der Flammenballen: ein Gasballen waechst zuerst schnell und
    // laeuft dann aus. Linear bleibt fuer Position und Alpha.
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
    capacity: 3072,
    maxLifetimeMs: 450,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Flammenband auf DEPTH.FIRE; die Outer-Partikel entsprechen dem alten '
      + 'Emitter und muessen unter Core und Spark bleiben.',
    capacityRationale:
      '48 plausible parallele Hitboxen x 2 Spawns / 17 ms x 450 ms = 2541 lebende Member; '
      + '3072 gibt rund 20 Prozent Reserve fuer Burst- und Timing-Schwankungen. Die Frequenz '
      + 'traegt die Dichte des Strahls und ist der Wert, der bei gemessenen capacityDrops '
      + 'zuerst zurueckgeht.',
  },
  {
    id: GpuVfxLaneId.FlameCore,
    label: 'flame-core',
    depth: DEPTH.FIRE + 0.05,
    blendMode: Phaser.BlendModes.ADD,
    // Wie flame-outer: die Zungen dehnen sich ueber QuadOut, alles andere bleibt linear.
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
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
  {
    id: GpuVfxLaneId.GroundFire,
    label: 'ground-fire',
    // Frueher sechs Emitter: outer 9.2, core 9.25, spark 9.3 und die Void-Varianten auf 9.22,
    // 9.27, 9.32. Zwischen 9.12 und 9.35 liegt nichts weiter, und alle sechs blenden additiv
    // ueber dem opaken Arenaboden – die Staffelung untereinander war rechnerisch folgenlos.
    depth: DEPTH.ROCKS + 0.2,
    blendMode: Phaser.BlendModes.ADD,
    // Staerkste Beschleunigung der Lane (Funken). Core laeuft mit Faktor 0.5 (-18 px/s²),
    // Outer mit 10/36 (-10 px/s²).
    gravity: -36,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 6144,
    // Das Glutbett lebt bis zu 1900 ms: lange Lebensdauern halten die Flaeche ruhig, weil die
    // Spawnrate `Lebendzahl / Lebensdauer` ist und kurze Motive die Flaeche flimmern lassen.
    maxLifetimeMs: 1900,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Tiefenband knapp ueber den Felsen und unter den Spielern; der Bodenrauch '
      + 'liegt als NORMAL-Lane darunter. Traegt Bett, Flaechenfeld, Heissfeld, Glutnester und '
      + 'Funken in beiden Stilen – ihre abweichenden Beschleunigungen laufen ueber `gravityFactor` '
      + 'und trennen keine Lanes mehr.',
    capacityRationale:
      'GroundFire emittiert flaechendeckend: die Lebendzahl je Cluster ist eine Dichte *pro '
      + 'Rasterzelle* (Bett 0.70, Flaechenfeld 1.30, Heissfeld 0.85, Glutnest 0.40, Glutregen '
      + '0.28, Funken-Ausreisser 0.035), '
      + 'damit eine Brandflaeche als geschlossene Flaeche liest statt als Perlenkette. Die '
      + 'Zellzahl geht dabei nur bis 140 voll ein und ist bei 320 gedeckelt, ein Cluster kostet '
      + 'also hoechstens rund 1141 Member. Fuenf gleichzeitig sichtbare Grossflaechen brauchen '
      + 'rechnerisch rund 5704 und passen damit in 6144 Slots. Die Dichten im Renderer sind die '
      + 'Werte, die bei gemessenen capacityDrops zuerst zurueckgehen.',
  },
  {
    id: GpuVfxLaneId.GroundFireSmoke,
    label: 'ground-fire-smoke',
    // Der Smoke-Emitter entstand schon beim Szenenaufbau und lag bei gleicher Depth deshalb unter
    // der zur Rundenzeit gebauten Felsvegetation (DEPTH.ROCK_VEGETATION 9.12) – die Lane entsteht
    // noch frueher und behaelt dieselbe Reihenfolge. Kein Epsilon-Versatz noetig.
    depth: DEPTH.ROCKS + 0.12,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear],
    capacity: 128,
    maxLifetimeMs: 1650,
    order: 'ordered',
    reserveCritical: 0,
    rationale:
      'Einziger nicht-additiver Teil des Bodenfeuers: der Rauch blendet normal und muss unter den '
      + 'additiven Flammen liegen. Der Blend-Mode ist layerglobal, teilen kann er sich die Lane '
      + 'deshalb mit niemandem.',
    capacityRationale:
      'Rauch bleibt ein sparsamer Cluster-Accent mit einer langen Lebenszeit; 128 Slots halten '
      + 'auch mehrere getrennte Brandflächen ohne eine per-Zelle-Emission.',
  },
  {
    id: GpuVfxLaneId.EntityBurn,
    label: 'entity-burn',
    // Frueher drei per-Entity-Emitter: outer 10.23, core 10.27, spark 10.32. Das Band traegt
    // ausserdem PlasmaChargeRenderer (10.24 / 10.30) – alles additiv, die Reihenfolge ist egal.
    depth: DEPTH.PLAYERS + 0.23,
    blendMode: Phaser.BlendModes.ADD,
    // Nur die Funken fallen; core und outer laufen mit linearer Y-Achse und ignorieren sie.
    gravity: -34,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 2048,
    maxLifetimeMs: 560,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Tiefenband ueber den Spielern und unter dem Zug. Ersetzt die drei '
      + 'Emitter, die bisher *je brennender Entity* neu entstanden; die Lane existiert stattdessen '
      + 'einmal fuer die ganze Szene.',
    capacityRationale:
      'Rund 30 gleichzeitig brennende Entities bei 8 Stacks ergeben je etwa 50 gleichzeitig '
      + 'lebende Member, also rund 1500. 2048 ist zugleich die erste Obergrenze, die dieser Effekt '
      + 'ueberhaupt hat – die per-Entity-Emitter waren unbegrenzt. Gegen gemessenes peakLive '
      + 'nachziehen.',
  },
  {
    id: GpuVfxLaneId.ProjectileBurn,
    label: 'projectile-burn',
    // Frueher sechs Emitter: outer 15.34, core 15.39, spark 15.43 und die Void-Varianten auf
    // denselben Tiefen. Das Band 15.28 bis 15.48 traegt nur additive Nachbarn (GuardianSpirit,
    // Slime-Bubbles, fliegende Feuerbrocken).
    depth: DEPTH.PROJECTILES + 0.34,
    blendMode: Phaser.BlendModes.ADD,
    // Staerkste Beschleunigung der Lane (Funken); outer laeuft mit Faktor 0.8 (-24 px/s²), core
    // mit linearer Y-Achse.
    gravity: -30,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 2048,
    maxLifetimeMs: 380,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Eigenes additives Tiefenband ueber den Projektilkoerpern und ueber der Rocket-Exhaust-Lane; '
      + 'der Glow des brennenden Projektils bleibt als CPU-Image knapp darunter. Getrennt von '
      + 'flame-outer, weil dessen Tiefenband bei DEPTH.FIRE liegt.',
    capacityRationale:
      'Die Trail-Logik deckelt sich global auf rund 2500 emitAt/s (TARGET_TRAIL_SAMPLES_PER_SYNC '
      + 'geteilt durch die Zahl brennender Projektile, dazu MAX_TRAIL_SAMPLES_PER_MS). Daraus '
      + 'folgen rund 900 + 625 + 317 = 1842 gleichzeitig lebende Member; 2048 entspricht zugleich '
      + 'der Summe der alten maxAliveParticles (900 + 720 + 420).',
  },
  {
    id: GpuVfxLaneId.WorldDebris,
    label: 'world-debris',
    depth: DEPTH.FIRE + 0.075,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear],
    capacity: 2048,
    maxLifetimeMs: 860,
    order: 'ordered',
    reserveCritical: 0,
    rationale:
      'NORMAL-Blend fuer fallendes Weltdebris. Die Tiefe liegt explizit zwischen FlameCore '
      + '(FIRE + 0.05) und FlameSpark (FIRE + 0.1), damit die Reihenfolge nicht von der '
      + 'Erzeugungsreihenfolge der GPU-Quellen abhaengt.',
    capacityRationale:
      'Ein LeafBlower erzeugt 5 Blaetter je 40 ms, also 125/s; bei maximal 860 ms leben rund '
      + '108 Member je Quelle. Der zusaetzliche Staub liegt bei 1 je 40 ms und maximal 650 ms, '
      + 'also rund 17 weitere Member je Quelle. 16 gleichzeitig sichtbare LeafBlower benoetigen '
      + 'damit rund 2000 Slots; 2048 ist die naechste begruendete Reserve.',
  },
  {
    id: GpuVfxLaneId.ExplosionSpark,
    label: 'explosion-spark',
    depth: DEPTH_FX,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 4096,
    maxLifetimeMs: 1100,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Additive Funken im gemeinsamen Explosionsband auf DEPTH_FX.',
    capacityRationale: 'Traegt auch den groessten Nuke-Spark-Burst mit Reserve fuer ueberlappende Einschlaege.',
  },
  {
    id: GpuVfxLaneId.ExplosionEmberDown,
    label: 'explosion-ember-down',
    depth: DEPTH_FX,
    blendMode: Phaser.BlendModes.NORMAL,
    gravity: 40,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity, GpuVfxEase.QuadOut],
    capacity: 4096,
    maxLifetimeMs: 1400,
    order: 'ordered',
    reserveCritical: 0,
    rationale: 'Normale Glutpartikel mit der bisherigen positiven Gravitation von 40 px/s².',
    capacityRationale: 'Bietet Reserve fuer mehrere gleichzeitig sichtbare Standardexplosionen.',
  },
  {
    id: GpuVfxLaneId.ExplosionEmberUp,
    label: 'explosion-ember-up',
    depth: DEPTH_FX,
    blendMode: Phaser.BlendModes.NORMAL,
    gravity: -180,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 4096,
    maxLifetimeMs: 1800,
    order: 'ordered',
    reserveCritical: 0,
    rationale: 'Energy-, Holy- und Nuke-Glut teilen das Band; schwächere Gravitationen skalieren per gravityFactor.',
    capacityRationale: 'Traegt Nuke-Ember-Bursts und ueberlappende Energy-/Holy-Explosionen.',
  },
  {
    id: GpuVfxLaneId.ExplosionAccent,
    label: 'explosion-accent',
    depth: DEPTH_FX + 0.1,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
    capacity: 2048,
    maxLifetimeMs: 520,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Energy-Arc und Timebomb-Motes liegen im selben additiven Akzentband.',
    capacityRationale: 'Die maximale Arc-Menge liegt deutlich unter 512 pro Burst; 2048 deckt Ueberlappung ab.',
  },
  {
    id: GpuVfxLaneId.ExplosionCascade,
    label: 'explosion-cascade',
    depth: DEPTH_FX + 0.12,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 2048,
    maxLifetimeMs: 520,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Kurze Mini-Raketen-Kaskadenfunken mit eigenem Tiefenversatz.',
    capacityRationale: 'Mehrere Kaskaden-Bursts bleiben unterhalb der Lane-Reserve.',
  },
  {
    id: GpuVfxLaneId.ExplosionTrainChunk,
    label: 'explosion-train-chunk',
    depth: DEPTH_FX + 0.24,
    blendMode: Phaser.BlendModes.ADD,
    gravity: 170,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 4096,
    maxLifetimeMs: 1450,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Train-Glutbrocken im bisherigen additiven Tiefenband.',
    capacityRationale: 'Ein grosser Train-Burst erzeugt unter 800 Brocken; die Reserve traegt Folgeeinschlaege.',
  },
  {
    id: GpuVfxLaneId.ExplosionTrainSpark,
    label: 'explosion-train-spark',
    depth: DEPTH_FX + 0.3,
    blendMode: Phaser.BlendModes.ADD,
    gravity: 95,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 2048,
    maxLifetimeMs: 780,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Train-Funken und Lightning-Funken teilen ein kompatibles additives Tiefenband.',
    capacityRationale: 'Deckt Train- und Lightning-Bursts mit mehreren parallelen Einschlaegen ab.',
  },
  {
    id: GpuVfxLaneId.ExplosionHolyCrown,
    label: 'explosion-holy-crown',
    depth: DEPTH_FX + 0.32,
    blendMode: Phaser.BlendModes.ADD,
    gravity: 120,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 2048,
    maxLifetimeMs: 980,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Aufsteigende Holy-Krone bleibt ueber dem Spark-Band.',
    capacityRationale: 'Der Einzelburst liegt unter 500 Partikeln; 2048 bietet deutliche Ueberlappungsreserve.',
  },
  {
    id: GpuVfxLaneId.ExplosionTrainCore,
    label: 'explosion-train-core',
    depth: DEPTH_FX + 0.34,
    blendMode: Phaser.BlendModes.ADD,
    gravity: 110,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity],
    capacity: 2048,
    maxLifetimeMs: 860,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Train-Kernpartikel behalten ihren eigenen Tiefenversatz.',
    capacityRationale: 'Mehrere Train-Kerne bleiben weit unter 2048 gleichzeitig lebenden Membern.',
  },
  {
    id: GpuVfxLaneId.ExplosionNukePlume,
    label: 'explosion-nuke-plume',
    depth: DEPTH_FX + 0.4,
    blendMode: Phaser.BlendModes.ADD,
    gravity: -120,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity, GpuVfxEase.QuadOut],
    capacity: 2048,
    maxLifetimeMs: 2200,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Nuke-Plume ueber allen anderen Nuke-Partikeln mit negativer Gravitation.',
    capacityRationale: 'Traegt mehrere Plume-Bursts der groessten Nuke-Radien.',
  },
  {
    id: GpuVfxLaneId.ExplosionNukeFallout,
    label: 'explosion-nuke-fallout',
    depth: DEPTH_FX + 0.35,
    blendMode: Phaser.BlendModes.NORMAL,
    gravity: 45,
    eases: [GpuVfxEase.Linear, GpuVfxEase.Gravity, GpuVfxEase.QuadOut],
    capacity: 2048,
    maxLifetimeMs: 2200,
    order: 'ordered',
    reserveCritical: 0,
    rationale: 'Nicht-additives Nuke-Fallout bleibt getrennt vom additiven Regenerationsband.',
    capacityRationale: 'Die groesste Fallout-Menge liegt unter 250 Partikeln pro Nuke.',
  },
  {
    id: GpuVfxLaneId.ExplosionRegeneration,
    label: 'explosion-regeneration',
    depth: DEPTH_FX + 0.35,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 1024,
    maxLifetimeMs: 720,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale: 'Regenerationsmotes liegen additiv auf demselben Tiefenband wie der alte Emitter.',
    capacityRationale: 'Regenerationsbursts bleiben klein; 1024 deckt parallele Heilimpulse ab.',
  },
  {
    id: GpuVfxLaneId.ExplosionSmoke,
    label: 'explosion-smoke',
    depth: DEPTH_FX - 0.04,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
    capacity: 2048,
    maxLifetimeMs: 1900,
    order: 'ordered',
    reserveCritical: 0,
    rationale:
      'Nicht-additiver Explosionsrauch liegt bewusst unter Kern, Glut und Druckwelle. Das eigene '
      + 'Tiefenband verhindert, dass spaet gespawnter Rauch die lesbare Hauptform ueberdeckt.',
    capacityRationale:
      'Bis zu 20 Rauchmember je normale Explosion beziehungsweise 160 je Nuke ergeben selbst '
      + 'bei zwoelf ueberlappenden Grossdetonationen weniger als 2048 lebende Member.',
  },
  {
    id: GpuVfxLaneId.GoreNormal,
    label: 'gore-normal',
    depth: DEPTH_FX - 0.1,
    blendMode: Phaser.BlendModes.NORMAL,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut, GpuVfxEase.CubicIn],
    frameAnimations: [GpuVfxFrameAnimationId.DeathDisintegration],
    capacity: 4096,
    maxLifetimeMs: 1400,
    order: 'ordered',
    reserveCritical: 512,
    rationale:
      'Gemeinsames normales Gore-Band fuer Death-Fragmente und den kurzlebigen Blutkern. '
      + 'Streaks und Tropfen bleiben untereinander bewusst reihenfolgearm; eine zweite Lane '
      + 'fuer minimale Depth-Unterschiede wuerde nur GPU-Kapazitaet duplizieren.',
    capacityRationale:
      'Die 1,4-s-Death-Lifetime erlaubt bei 48 Haupt- plus hoechstens 14 dekorativen Dust-Membern '
      + 'rund 52 voll ueberlappende Todesfaelle neben schwerem Blut-Spray. 4096 bleibt begrenzt '
      + 'und reserviert 512 Slots fuer Hauptfragmente und Hauptspray gegen Mikrodetails.',
  },
  {
    id: GpuVfxLaneId.GoreAdd,
    label: 'gore-add',
    depth: DEPTH_FX + 0.05,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut, GpuVfxEase.CubicIn],
    capacity: 1024,
    maxLifetimeMs: 1400,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Additive Ebene fuer DeathGlow und ausgewaehlte farbige Player-Fragment-Saeume. Die '
      + 'Hauptfragmente bleiben dominant im Normal-Band; minimale Tiefenunterschiede '
      + 'rechtfertigen keine weiteren GPU-Layer.',
    capacityRationale:
      'Bei rund 52 voll ueberlappenden Todesfaellen mit bis zu acht DeathGlows und zwoelf kleinen '
      + 'Player-Saeumen bleibt die Lane nahe ihrer 1024 Slots; Standard-Quality reduziert beide '
      + 'dekorativen Schichten bei Ueberlast zuerst, statt die Lane zu vergroessern.',
  },
  {
    id: GpuVfxLaneId.PowerUpPedestal,
    label: 'powerup-pedestal',
    depth: DEPTH.PLAYERS - 2.05,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear],
    capacity: 1024,
    maxLifetimeMs: 1100,
    order: 'add-over-opaque',
    reserveCritical: 0,
    rationale:
      'Ambient-Motes, Funken und Spawn-Bursts teilen das additive Pedestal-Tiefenband. Die '
      + 'dauerhafte Co-Activity bleibt getrennt von den nur waehrend Airstrikes sichtbaren Lanes.',
    capacityRationale:
      'Die groesste authored Map besitzt 18 Pedestals mit rund 13 lebenden Flow-Membern je '
      + 'Sockel. 1024 laesst mehrere gleichzeitige 19-Member-Spawn-Bursts und Konstruktionen zu.',
  },
  {
    id: GpuVfxLaneId.MuzzleFlash,
    label: 'muzzle-flash',
    depth: DEPTH.PROJECTILES + 2 + GPU_VFX_DEPTH_EPSILON,
    blendMode: Phaser.BlendModes.ADD,
    eases: [GpuVfxEase.Linear, GpuVfxEase.QuadOut],
    capacity: 512,
    maxLifetimeMs: 236,
    order: 'add-over-opaque',
    reserveCritical: 64,
    rationale:
      'Body und Sparks bleiben in einer gemeinsamen additiven Lane auf PROJECTILES + 2 + epsilon. '
      + 'Der epsilon-Versatz bildet die Laufzeit-Reihenfolge des alten Emitters auf der persistenten '
      + 'Lane nach; die Sparks wandern dabei von + 1.5 auf + 2.001. ADD ueber opaker Geometrie ist '
      + 'reihenfolgeunkritisch, und Linear/QuadOut decken alle Member-Animationen ab.',
    capacityRationale:
      '12 Spieler x 16.7 Negev-Schuesse/s x 5 Sparks x 80 ms ergeben rund 80 lebende Sparks; '
      + '236 ms decken den laengsten Muzzle-Lebenszyklus mit reichlich Burst- und Turret-Reserve. '
      + '512 Slots begrenzen die Lane belastbar fuer Multiplayer-Spitzen, waehrend 64 kritische '
      + 'Reserveplaetze den stets sichtbaren Body gegen Spark-Ueberlast schuetzen.',
  },
];
