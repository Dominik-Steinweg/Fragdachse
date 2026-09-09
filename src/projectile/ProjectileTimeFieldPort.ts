/** Host-authoritative movement factor for one projectile at an explicit host time. */
export interface ProjectileTimeFieldPort {
  isBubbleActive?(bubbleId: number, nowMs: number): boolean;
  getMovementFactor(
    x: number,
    y: number,
    nowMs: number,
  ): number;
}
