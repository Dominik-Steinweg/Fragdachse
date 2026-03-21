import Phaser from 'phaser';

/**
 * Shared helpers for effect/particle systems.
 * Avoids duplicate circleZone/edgeZone implementations across FireSystem, SmokeSystem, etc.
 */

/** Random circular emit zone (Partikel spawnen zufällig innerhalb des Kreises). */
export function circleZone(r: number, quantity?: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
  return {
    type:     'random',
    source:   new Phaser.Geom.Circle(0, 0, r),
    ...(quantity !== undefined && { quantity }),
  } as Phaser.Types.GameObjects.Particles.EmitZoneData;
}

/** Edge emit zone: Partikel spawnen gleichmäßig auf dem Kreisrand. */
export function edgeZone(r: number, quantity = 32): Phaser.Types.GameObjects.Particles.EmitZoneData {
  return {
    type:     'edge',
    source:   new Phaser.Geom.Circle(0, 0, r),
    quantity,
  } as Phaser.Types.GameObjects.Particles.EmitZoneData;
}
