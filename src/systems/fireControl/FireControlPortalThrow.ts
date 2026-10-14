/**
 * Portal throw rules shared by the host and the client preview (GDD V2 §4.1, D33/D34/D39/D43).
 * Phaser-free: the device flies straight (no bounces), comes to rest through air friction or at
 * its first contact, and opens at the last valid point of its flight.
 */

/** Host-authored flight parameters; identical inputs give identical predictions (D39). */
export interface FireControlPortalFlightConfig {
  readonly minThrowSpeed: number;
  readonly projectileSpeed: number;
  readonly projectileSize: number;
  /** Safety limit only: when it elapses the exit opens where the device is (D33). */
  readonly fuseTime: number;
  readonly frictionDelayMs?: number;
  readonly airFrictionDecayPerSec?: number;
  readonly stopSpeedThreshold?: number;
}

/** Step used by Arcade physics (fixed 60 Hz); the preview integrates the same damping. */
export const FIRE_CONTROL_PORTAL_FLIGHT_STEP_MS = 1000 / 60;
/** Resolution of the walk back along the flight path (D34). */
export const FIRE_CONTROL_PORTAL_LANDING_STEP_PX = 4;

export function resolvePortalThrowSpeed(config: FireControlPortalFlightConfig, chargeFraction: number): number {
  const charge = Math.max(0, Math.min(1, Number.isFinite(chargeFraction) ? chargeFraction : 0));
  return config.minThrowSpeed + (config.projectileSpeed - config.minThrowSpeed) * charge;
}

/**
 * Landing rule D34: the rest point if it is free, otherwise the last free point on the straight
 * flight back towards the release point; without any, the release point itself.
 */
export function resolvePortalLandingPoint(
  originX: number, originY: number, restX: number, restY: number,
  isFree: (x: number, y: number) => boolean,
): { readonly x: number; readonly y: number; readonly moved: boolean } {
  if (isFree(restX, restY)) return { x: restX, y: restY, moved: false };
  const dx = originX - restX, dy = originY - restY;
  const length = Math.hypot(dx, dy);
  const steps = Math.floor(length / FIRE_CONTROL_PORTAL_LANDING_STEP_PX);
  for (let i = 1; i <= steps; i++) {
    const t = (i * FIRE_CONTROL_PORTAL_LANDING_STEP_PX) / length;
    const x = restX + dx * t, y = restY + dy * t;
    if (isFree(x, y)) return { x, y, moved: true };
  }
  return { x: originX, y: originY, moved: true };
}

export interface FireControlPortalThrowPrediction {
  readonly restX: number; readonly restY: number;
  readonly landingX: number; readonly landingY: number;
  /** The rest point was invalid and the exit moves back along the flight. */
  readonly moved: boolean;
  readonly flightMs: number;
}

/**
 * Landing-point preview (D43) against static geometry. `blocksFlight` reports a contact on the
 * step segment; the device stops before it (no reflection). `isLandingFree` is the D34 read.
 */
export function predictPortalThrow(input: {
  readonly x: number; readonly y: number; readonly angle: number; readonly chargeFraction: number;
  readonly config: FireControlPortalFlightConfig;
  readonly blocksFlight: (x0: number, y0: number, x1: number, y1: number) => boolean;
  readonly isLandingFree: (x: number, y: number) => boolean;
}): FireControlPortalThrowPrediction {
  const { config } = input;
  const dt = FIRE_CONTROL_PORTAL_FLIGHT_STEP_MS / 1000;
  const dirX = Math.cos(input.angle), dirY = Math.sin(input.angle);
  let speed = resolvePortalThrowSpeed(config, input.chargeFraction);
  let x = input.x, y = input.y, ageMs = 0, friction = false;
  const decay = config.airFrictionDecayPerSec;
  const stop = config.stopSpeedThreshold ?? 0;
  while (speed > 0 && ageMs < config.fuseTime) {
    ageMs += FIRE_CONTROL_PORTAL_FLIGHT_STEP_MS;
    if (!friction && decay !== undefined && ageMs >= (config.frictionDelayMs ?? 0)) friction = true;
    if (friction && decay !== undefined) speed *= Math.pow(decay, dt);
    const nx = x + dirX * speed * dt, ny = y + dirY * speed * dt;
    if (input.blocksFlight(x, y, nx, ny)) break;
    x = nx; y = ny;
    if (friction && speed < stop) speed = 0;
  }
  const landing = resolvePortalLandingPoint(input.x, input.y, x, y, input.isLandingFree);
  return { restX: x, restY: y, landingX: landing.x, landingY: landing.y, moved: landing.moved,
    flightMs: Math.min(ageMs, config.fuseTime) };
}
