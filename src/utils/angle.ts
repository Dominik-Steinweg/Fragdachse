const TWO_PI = 2 * Math.PI;

/** Radiant [-π, π] auf uint8 [0, 255] quantisieren (~1.4° Präzision). */
export function quantizeAngle(rad: number): number {
  const norm = ((rad % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(norm * 255 / TWO_PI) & 0xFF;
}

/** uint8 [0, 255] zurück in Radiant [0, 2π] wandeln. */
export function dequantizeAngle(byte: number): number {
  return (byte / 255) * TWO_PI;
}
