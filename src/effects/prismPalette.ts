/** Saturated rainbow shared by the Time Bubble source and path-bound projectile material. */
export const PRISM_PALETTE = [0xff234a, 0xff7a00, 0xffe100, 0x00dc6a, 0x008cff, 0x922bff] as const;
export const PRISM_COLOR_PERIOD_MS = 250;

export function prismColorAtTime(timeMs: number): number {
  const phase = ((timeMs % PRISM_COLOR_PERIOD_MS + PRISM_COLOR_PERIOD_MS) % PRISM_COLOR_PERIOD_MS)
    / PRISM_COLOR_PERIOD_MS * PRISM_PALETTE.length;
  const index = Math.floor(phase), mix = phase - index;
  const a = PRISM_PALETTE[index], b = PRISM_PALETTE[(index + 1) % PRISM_PALETTE.length];
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - mix) + ((b >> shift) & 255) * mix);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
