import type * as Phaser from 'phaser';

/**
 * Airborne void spore haze carried by the ground fog (GDD Nachtsicht N-6, user 2026-10-18: "soll
 * sich mit dem Nebel verbinden und wie der Nebel auf Geschosse, Explosionen und Bewegung
 * reagieren"). Borrowed from the World's void creep owner, which keeps texture and values current;
 * the fog only reads it. The fog's own wakes cut it and its stirred air blows it apart.
 */
export interface FogVoidHaze {
  /** Creep field: R soaked ground, G land share, B spore haze, world-anchored over `frame`. */
  readonly texture: Phaser.Textures.Texture;
  /** World rectangle the creep texture covers: x, y, width, height. */
  readonly frame: Float32Array;
  /** Presentation time in seconds; the haze drifts with the ground haze below it. */
  readonly time: number;
  /** 0..1 strength of the airborne layer. */
  readonly strength: number;
  /** Spawn zone warnings (`uVoidAlert[0]`: x, y, width, height per zone; `uVoidAlertLevel[0]`). */
  readonly alerts: Float32Array;
  readonly alertLevels: Float32Array;
  /**
   * Trails of hostile bodies (VoidTaintLayer, E12): R haze, G flare over the world rect `view`;
   * `on` 1 while the texture holds trails. Read every frame; absent in Worlds without trails.
   */
  readonly taint?: { readonly texture: Phaser.Textures.Texture | null; readonly view: Float32Array; readonly on: number } | null;
}
