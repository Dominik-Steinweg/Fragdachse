import type * as Phaser from 'phaser';

type MemberValue = Phaser.Types.GameObjects.SpriteGPULayer.Member['x'];

/** A bounded sine bob `centre + amplitude * sin(omega * t + phase)` as a GPU member animation.
 * A looping yoyo Sine.easeInOut is exactly a cosine wave; its delay supplies the phase. */
export function bob(centre: number, amplitude: number, omega: number, phase: number): MemberValue {
  const duration = Math.PI / omega * 1000;
  const periods = ((-(phase + Math.PI / 2) / Math.PI) % 2 + 2) % 2;
  return { base: centre - amplitude, amplitude: amplitude * 2, ease: 'Sine.easeInOut', duration, delay: periods * duration, yoyo: true, loop: true };
}

/** Position and rotation of a floating pond plant; every layer drawing the plant uses the same motion. */
export function floatingMotion(p: { x: number; y: number; rotation: number }): { x: MemberValue; y: MemberValue; rotation: MemberValue } {
  const phase = p.x * .005 + p.y * .007;
  return { x: bob(p.x, .7, .21, phase), y: bob(p.y, .5, .17, phase + Math.PI / 2), rotation: bob(p.rotation, .025, .18, phase) };
}
