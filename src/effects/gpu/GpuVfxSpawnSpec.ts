import { GpuVfxEase } from './GpuVfxEase';
import type { GpuVfxFrameId } from './GpuVfxAtlas';
import type { GpuVfxEffectId } from './GpuVfxEffects';
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

  lifeMs: number;
  x: number;
  y: number;
  /** Geschwindigkeit in px/s; das Backend rechnet daraus die Amplitude ueber die Lebenszeit. */
  vx: number;
  vy: number;
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

  /** Ein Verlauf fuer beide Achsen: alle bisherigen Effekte skalieren uniform. */
  scaleStart: number;
  scaleEnd: number;
  scaleEase: GpuVfxEase;

  alphaStart: number;
  alphaEnd: number;
  alphaEase: GpuVfxEase;

  /** Multiply-Tint; wird auf alle vier Ecken verteilt. */
  tint: number;
}
