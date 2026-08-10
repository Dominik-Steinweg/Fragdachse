import { describe, expect, it } from 'vitest';
import {
  advanceSpectatorCameraScroll,
  getSpectatorCameraMaxScroll,
} from '../src/scenes/arena/SpectatorCameraModel';

describe('spectator camera model', () => {
  it('moves horizontally with A/D and clamps to both arena edges', () => {
    expect(getSpectatorCameraMaxScroll(3200, 1920)).toBe(1280);
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 0,
      deltaMs: 1000,
      moveLeft: false,
      moveRight: true,
      arenaWidth: 3200,
      viewportWidth: 1920,
      speedPxPerSecond: 500,
    })).toBe(500);
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 1200,
      deltaMs: 1000,
      moveLeft: false,
      moveRight: true,
      arenaWidth: 3200,
      viewportWidth: 1920,
      speedPxPerSecond: 500,
    })).toBe(1280);
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 100,
      deltaMs: 1000,
      moveLeft: true,
      moveRight: false,
      arenaWidth: 3200,
      viewportWidth: 1920,
      speedPxPerSecond: 500,
    })).toBe(0);
  });

  it('does not pan an arena that fits inside the viewport', () => {
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 40,
      deltaMs: 1000,
      moveLeft: false,
      moveRight: true,
      arenaWidth: 1600,
      viewportWidth: 1920,
    })).toBe(0);
  });

  it('uses the same clamped model for vertical W/S movement', () => {
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 0,
      deltaMs: 1000,
      moveLeft: false,
      moveRight: true,
      arenaWidth: 1_664,
      viewportWidth: 1_056,
      speedPxPerSecond: 500,
    })).toBe(500);
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 500,
      deltaMs: 1000,
      moveLeft: false,
      moveRight: true,
      arenaWidth: 1_664,
      viewportWidth: 1_056,
      speedPxPerSecond: 500,
    })).toBe(608);
    expect(advanceSpectatorCameraScroll({
      currentScrollX: 120,
      deltaMs: 1000,
      moveLeft: true,
      moveRight: false,
      arenaWidth: 1_664,
      viewportWidth: 1_056,
      speedPxPerSecond: 500,
    })).toBe(0);
  });
});
