import { ATTACK_DRONE_RULES as R } from '../config/attackDrone';
import type { DronePoint, DroneRect } from './AttackDroneTargeting';

export interface DroneFlightState {
  x: number; y: number; velocityX: number; velocityY: number; flightAngle: number;
}
export interface DroneFlightNeighbor extends DronePoint { readonly stationId: number }

/** A read view taken before each simulation slice, independent of drone update order. No collisions. */
export class AttackDroneFlightNeighbors {
  private readonly cells = new Map<string, DroneFlightNeighbor[]>();
  replace(drones: Iterable<DroneFlightNeighbor>): void {
    this.cells.clear();
    for (const drone of drones) {
      const key = `${Math.floor(drone.x / R.separationRadius)}:${Math.floor(drone.y / R.separationRadius)}`;
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = []);
      cell.push(drone);
    }
  }
  query(point: DronePoint, radius: number, stationId: number): DroneFlightNeighbor[] {
    const result: DroneFlightNeighbor[] = [];
    for (let x = Math.floor((point.x - radius) / R.separationRadius); x <= Math.floor((point.x + radius) / R.separationRadius); x++) {
      for (let y = Math.floor((point.y - radius) / R.separationRadius); y <= Math.floor((point.y + radius) / R.separationRadius); y++) {
        for (const other of this.cells.get(`${x}:${y}`) ?? []) {
          if (other.stationId !== stationId && Math.hypot(other.x - point.x, other.y - point.y) < radius) result.push(other);
        }
      }
    }
    return result;
  }
  clear(): void { this.cells.clear(); }
}

/** Capped steering preference. Exact overlaps receive opposite, stable directions for each pair. */
export function droneSeparationVelocity(position: DronePoint, stationId: number, neighbors: readonly DroneFlightNeighbor[]): DronePoint {
  let x = 0, y = 0;
  for (const other of neighbors) {
    if (other.stationId === stationId) continue;
    let dx = position.x - other.x, dy = position.y - other.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= R.separationRadius) continue;
    if (distance < 1e-6) {
      const low = Math.min(stationId, other.stationId), high = Math.max(stationId, other.stationId);
      const hash = (Math.imul(low, 73856093) ^ Math.imul(high, 19349663)) >>> 0;
      const angle = hash / 0x100000000 * Math.PI * 2, sign = stationId === low ? 1 : -1;
      dx = Math.cos(angle) * sign; dy = Math.sin(angle) * sign;
    } else { dx /= distance; dy /= distance; }
    const weight = 1 - distance / R.separationRadius;
    x += dx * weight; y += dy * weight;
  }
  const scale = R.separationSpeed / Math.max(1, Math.hypot(x, y));
  return { x: x * scale, y: y * scale };
}

/** Velocity-based arrival steering; position/heading are authoritative and the renderer only interpolates. */
export function advanceDroneFlight(state: DroneFlightState, destination: DronePoint, maxSpeed: number, dt: number,
  bounds: DroneRect, separation: DronePoint = { x: 0, y: 0 }): boolean {
  const seconds = Math.max(0, dt) / 1000;
  const dx = destination.x - state.x, dy = destination.y - state.y, distance = Math.hypot(dx, dy);
  const desiredSpeed = Math.min(maxSpeed, distance / (R.flightSteeringMs / 1000), Math.sqrt(2 * R.flightBraking * distance));
  let desiredX = dx / Math.max(1e-8, distance) * desiredSpeed + separation.x;
  let desiredY = dy / Math.max(1e-8, distance) * desiredSpeed + separation.y;
  const speedScale = Math.min(1, maxSpeed / Math.max(1e-8, Math.hypot(desiredX, desiredY)));
  desiredX *= speedScale; desiredY *= speedScale;
  const changeX = desiredX - state.velocityX, changeY = desiredY - state.velocityY;
  const braking = state.velocityX * changeX + state.velocityY * changeY < 0;
  const changeScale = Math.min(1, (braking ? R.flightBraking : R.flightAcceleration) * seconds / Math.max(1e-8, Math.hypot(changeX, changeY)));
  state.velocityX += changeX * changeScale; state.velocityY += changeY * changeScale;
  const previousX = state.x, previousY = state.y;
  const x = state.x + state.velocityX * seconds, y = state.y + state.velocityY * seconds;
  state.x = Math.max(bounds.left, Math.min(bounds.right, x)); state.y = Math.max(bounds.top, Math.min(bounds.bottom, y));
  if (state.x !== x) state.velocityX = 0;
  if (state.y !== y) state.velocityY = 0;
  // Ignore sub-pixel corrections and wall-blocked movement instead of turning toward numerical noise.
  if (seconds > 0 && Math.hypot(state.x - previousX, state.y - previousY) / seconds >= R.flightHeadingMinSpeed) {
    const desired = Math.atan2(state.y - previousY, state.x - previousX);
    const diff = Math.atan2(Math.sin(desired - state.flightAngle), Math.cos(desired - state.flightAngle));
    const turn = R.flightTurnDegreesPerSecond * Math.PI / 180 * seconds;
    state.flightAngle += Math.max(-turn, Math.min(turn, diff));
  }
  const arrived = Math.hypot(destination.x - state.x, destination.y - state.y) <= 0.5
    && Math.hypot(state.velocityX, state.velocityY) <= R.flightHeadingMinSpeed
    && Math.hypot(separation.x, separation.y) < 1e-8;
  if (arrived) { state.x = destination.x; state.y = destination.y; state.velocityX = 0; state.velocityY = 0; }
  return arrived;
}
