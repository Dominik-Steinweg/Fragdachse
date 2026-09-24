import { describe, expect, it } from 'vitest';
import { ATTACK_DRONE_RULES as R } from '../src/config/attackDrone';
import { advanceDroneFlight, AttackDroneFlightNeighbors, droneSeparationVelocity, type DroneFlightState } from '../src/systems/AttackDroneFlight';

const bounds = { left: 0, top: 0, right: 12000, bottom: 12000 };
const flight = (): DroneFlightState => ({ x: 2000, y: 2000, velocityX: 0, velocityY: 0, flightAngle: 0 });

describe('attack drone flight steering', () => {
  it('accelerates, brakes before arrival and settles without overshooting a stationary destination', () => {
    const d = flight(), destination = { x: d.x + R.travelSpeed * 3, y: d.y }, speeds: number[] = [];
    let arrived = false;
    for (let i = 0; i < 1000 && !arrived; i++) {
      const previousSpeed = d.velocityX;
      arrived = advanceDroneFlight(d, destination, R.travelSpeed, 25, bounds);
      speeds.push(d.velocityX);
      expect(d.velocityX - previousSpeed).toBeLessThanOrEqual(R.flightAcceleration * 0.025 + 1e-8);
      expect(previousSpeed - d.velocityX).toBeLessThanOrEqual(R.flightBraking * 0.025 + 1e-8);
      expect(d.velocityX).toBeLessThanOrEqual(R.travelSpeed);
      expect(d.x).toBeLessThanOrEqual(destination.x);
    }
    expect(arrived).toBe(true);
    expect(speeds[0]).toBeGreaterThan(0); expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(Math.max(...speeds)).toBeCloseTo(R.travelSpeed);
    expect(speeds.at(-2)).toBeGreaterThan(speeds.at(-1)!);
    expect(d).toMatchObject({ ...destination, velocityX: 0, velocityY: 0 });
  });
  it('brakes momentum before reversing and limits body turns independently of the destination', () => {
    const d = flight(); d.velocityX = R.attackSpeed;
    const destination = { x: d.x - R.range, y: d.y };
    advanceDroneFlight(d, destination, R.attackSpeed, 25, bounds);
    expect(d.velocityX).toBeGreaterThan(0); expect(d.velocityX).toBeLessThan(R.attackSpeed);
    expect(d.flightAngle).toBe(0);
    for (let i = 0; i < 40; i++) {
      const angle = d.flightAngle;
      advanceDroneFlight(d, destination, R.attackSpeed, 25, bounds);
      expect(Math.abs(d.flightAngle - angle)).toBeLessThanOrEqual(R.flightTurnDegreesPerSecond * Math.PI / 180 * 0.025 + 1e-8);
    }
    expect(d.velocityX).toBeLessThan(0);
  });
  it('holds body heading through hover corrections, zero-time updates and blocked movement', () => {
    const d = flight(); d.flightAngle = 0.7;
    for (let i = 0; i < 100; i++) {
      advanceDroneFlight(d, { x: 2000 + Math.sin(i) * 0.0001, y: 2000 + Math.cos(i) * 0.0001 }, R.attackSpeed, 25, bounds);
      expect(d.flightAngle).toBe(0.7);
    }
    advanceDroneFlight(d, { x: 9000, y: 9000 }, R.attackSpeed, 0, bounds);
    expect(d.flightAngle).toBe(0.7);
    d.x = 0; d.velocityX = -R.attackSpeed;
    advanceDroneFlight(d, { x: -R.range, y: d.y }, R.attackSpeed, 25, bounds);
    expect(d.x).toBe(0); expect(d.velocityX).toBe(0); expect(d.flightAngle).toBe(0.7);
  });
  it('breaks exact overlap symmetrically without pushing positions or exceeding steering strength', () => {
    const point = { x: 2000, y: 2000 };
    const a = droneSeparationVelocity(point, 1, [{ ...point, stationId: 2 }]);
    const b = droneSeparationVelocity(point, 2, [{ ...point, stationId: 1 }]);
    expect(a.x).toBeCloseTo(-b.x); expect(a.y).toBeCloseTo(-b.y);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(R.separationSpeed);
    const crowded = droneSeparationVelocity(point, 1, Array.from({ length: 48 }, (_, i) => ({ ...point, stationId: i + 2 })));
    expect(Math.hypot(crowded.x, crowded.y)).toBeLessThanOrEqual(R.separationSpeed + 1e-8);
    expect(point).toEqual({ x: 2000, y: 2000 });
  });
  it('queries local neighbors and discards old positions on replacement and teardown', () => {
    const neighbors = new AttackDroneFlightNeighbors(), point = { x: 2000, y: 2000 };
    neighbors.replace([{ ...point, stationId: 1 }, { ...point, stationId: 2 }, { x: 10000, y: 10000, stationId: 3 }]);
    expect(neighbors.query(point, R.separationRadius, 1).map(d => d.stationId)).toEqual([2]);
    neighbors.replace([{ x: 10000, y: 10000, stationId: 2 }]);
    expect(neighbors.query(point, R.separationRadius, 1)).toEqual([]);
    neighbors.clear(); expect(neighbors.query({ x: 10000, y: 10000 }, R.separationRadius, 1)).toEqual([]);
  });
});
