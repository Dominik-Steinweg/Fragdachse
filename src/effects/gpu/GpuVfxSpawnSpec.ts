import { GpuVfxEase } from './GpuVfxEase';
import type { GpuVfxFrameId } from './GpuVfxAtlas';
import type { GpuVfxEffectId } from './GpuVfxEffects';
import type { GpuVfxFrameAnimationId } from './GpuVfxFrameAnimations';
import type { GpuVfxLaneId } from './GpuVfxRenderLanes';

/**
 * GpuVfxSpawnSpec – der neutrale Spawn-Auftrag zwischen Effektcontroller und GPU-Backend.
 *
 * Nur flache Zahlen: der Controller beschreibt *was* entstehen soll, das Backend uebersetzt das
 * in Phasers `MemberAnimation`-Objekte, wendet die Basis-Korrektur fuer nicht-lineare Eases an
 * und schreibt den Member. Ein Controller sieht danach weder `editMember` noch `creationTime`,
 * `loop`/`yoyo`, die Kodierung von `gravityFactor` oder das Buffer-Layout.
 *
 * ## Warum ein Spec je Controller und kein geteiltes Scratch-Objekt
 *
 * Jeder Controller bekommt sein Exemplar ueber `GpuVfxSystem.createSpec()` und mutiert nur
 * dieses. Ein einziges geteiltes Objekt waere zwar ebenso allokationsfrei, wuerde aber die heute
 * durch getrennte Modul-Vorlagen (`PUFF_MEMBER`, `EXHAUST_MEMBER`, …) geschenkte Isolation
 * aufgeben: ein Feld, das ein Effekt setzt und ein anderer nicht zuruecksetzt, wanderte
 * unbemerkt hinueber.
 *
 * Im Hotpath wird nie ein Spec angelegt – nur seine Felder werden ueberschrieben.
 */
export interface GpuVfxSpawnSpec {
  /** Fest; bestimmt Importance, Release-Modus und die Zeile im Profiler-Report. */
  readonly effect: GpuVfxEffectId;
  /**
   * Ziel-Lane. Vorbelegt aus dem Effekt-Manifest; nur Effekte mit variantenabhaengigem
   * Blend-Mode (Wolkenpartikel) schreiben hier um.
   */
  lane: GpuVfxLaneId;
  /** Motiv im geteilten Atlas. Vorbelegt aus dem Effekt-Manifest. */
  frame: GpuVfxFrameId;
  /** Optionale, laneweit vorgewaermte GPU-One-Shot-Framefolge; -1 behaelt den statischen Frame. */
  frameAnimation: GpuVfxFrameAnimationId | -1;
  /**
   * Streckt die Framefolge gegenueber `lifeMs`; 1 laesst sie exakt mit dem Member enden.
   *
   * Damit laufen sonst identische Partikel ihre Morph-Phasen zu verschiedenen Zeitpunkten durch,
   * ohne dass sich ihre Bewegung oder Lebensdauer aendert – ein Burst zerfaellt als Welle statt
   * synchron umzuschalten.
   *
   * **Nur Werte >= 1.** Phaser 4.2.1 laesst `loop: false` bei der Frame-Animation fallen; eine
   * kuerzere Folge als der Member wuerde am Ende wieder auf den ersten Frame springen. Das
   * Backend klemmt entsprechend. Groessere Werte sind unbedenklich: das Partikel stirbt dann
   * vor dem letzten Frame, was bei einem gegen 0 laufenden Alpha nicht sichtbar ist.
   */
  frameAnimationDurationScale: number;

  lifeMs: number;
  x: number;
  y: number;
  /** Geschwindigkeit in px/s; das Backend rechnet daraus die Amplitude ueber die Lebenszeit. */
  vx: number;
  vy: number;
  /** Positionskurve fuer X/Y. Gravity bleibt das separate Y-Bewegungsmodell. */
  positionEase: GpuVfxEase;
  /**
   * Bewegungsmodell der Y-Achse. `Gravity` benutzt `vy` als Anfangsgeschwindigkeit und die
   * layerglobale `gravity` der Lane; Phaser kodiert diese Geschwindigkeit ganzzahlig.
   */
  yMode: typeof GpuVfxEase.Linear | typeof GpuVfxEase.Gravity;
  /**
   * Nur fuer `yMode: Gravity`: Anteil der layerglobalen `gravity` dieser Lane, in (0, 1].
   * Phaser kodiert ihn in den Nachkommaanteil der Amplitude, die Beschleunigung im Shader ist
   * `uGravity * gravityFactor`. Damit traegt eine Lane mehrere Beschleunigungen, solange die
   * staerkste als `gravity` deklariert ist – abweichende Gravity ist kein Lane-Trennkriterium.
   */
  gravityFactor: number;

  /** Statische Ausrichtung in Radiant. */
  rotation: number;
  /** Drehgeschwindigkeit in rad/s. 0 laesst die Rotation statisch – wie bei allen Piloten. */
  angularVelocity: number;
  /** Kurve der Drehung; standardmaessig linear, beim Death-Release bewusst spaet. */
  rotationEase: GpuVfxEase;

  /** Der gemeinsame Groessenverlauf. Ohne `stretch*` gilt er unveraendert fuer beide Achsen. */
  scaleStart: number;
  scaleEnd: number;
  scaleEase: GpuVfxEase;

  /**
   * Streckung entlang der lokalen X-Achse, als Faktor auf `scaleStart`/`scaleEnd`; 1 = uniform.
   *
   * Zusammen mit `rotation` wird daraus ein an der Stroemung ausgerichteter Streifen: eine
   * Flammenzunge, ein Funkenstrich, eine Druckwelle. Getrennte Achsen kosten einen zweiten
   * Animationsslot pro Spawn, deshalb faellt der Pfad bei `1/1` auf das bisherige *eine*
   * Kurvenobjekt fuer beide Achsen zurueck.
   *
   * Ein von `stretchStart` abweichendes `stretchEnd` laesst die Form ueber die Lebenszeit
   * relaxieren – ein gestreckter Ballen wird beim Ausbrennen wieder rund.
   */
  stretchStart: number;
  stretchEnd: number;

  alphaStart: number;
  alphaEnd: number;
  alphaEase: GpuVfxEase;

  /** Multiply-Tint; wird auf alle vier Ecken verteilt. */
  tint: number;

  /**
   * Wie stark `tint` wirkt: 0 laesst die Textur unveraendert (also weiss), 1 ist der volle
   * Tint. Phaser sieht dafuer einen eigenen Animationsslot vor – es ist der einzige Weg, eine
   * Farbe ueber die Lebenszeit zu veraendern, denn die vier Eckfarben selbst sind statisch.
   *
   * Ein Verlauf 0 -> 1 ist die Temperaturkurve eines Glutpartikels: weissheiss geboren, in
   * seiner Zielfarbe ausgebrannt. Bei `1/1` wird wie bisher die Konstante geschrieben.
   * Die Kurve laeuft immer linear; jede andere Ease muesste auf jeder Lane vorgewaermt werden,
   * die sie benutzen koennte.
   */
  tintBlendStart: number;
  tintBlendEnd: number;
}
