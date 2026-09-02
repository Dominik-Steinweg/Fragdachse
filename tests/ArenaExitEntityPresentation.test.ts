import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import { ArenaExitEntityPresentation } from '../src/world/ArenaExitEntityPresentation';

function source(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    visible: true,
    alpha: 0.8,
    x: 12,
    y: 34,
    texture: { key: 'enemy' },
    frame: { name: 7 },
    originX: 0.5,
    originY: 0.75,
    displayWidth: 48,
    displayHeight: 52,
    rotation: 0.4,
    depth: 20,
    flipX: true,
    flipY: false,
    scrollFactorX: 1,
    scrollFactorY: 1,
    blendMode: 0,
    tintTopLeft: 0xffffff,
    tintTopRight: 0xffffff,
    tintBottomLeft: 0xffffff,
    tintBottomRight: 0xffffff,
    tintMode: 0,
    ...overrides,
  };
}

function snapshot() {
  const target = {
    destroy: vi.fn(),
    setOrigin: vi.fn(),
    setDisplaySize: vi.fn(),
    setRotation: vi.fn(),
    setAlpha: vi.fn(),
    setDepth: vi.fn(),
    setFlip: vi.fn(),
    setScrollFactor: vi.fn(),
    setBlendMode: vi.fn(),
    setTint: vi.fn(),
    setTintMode: vi.fn(),
  };
  for (const method of Object.values(target)) method.mockReturnValue(target);
  return target;
}

describe('ArenaExitEntityPresentation', () => {
  it('kopiert nur sichtbare Entity-Darstellung und zerstoert sie idempotent', () => {
    const first = snapshot();
    const addImage = vi.fn().mockReturnValue(first);
    const scene = { add: { image: addImage } };

    const presentation = new ArenaExitEntityPresentation(scene as never, [
      source(),
      source({ active: false }),
      source({ visible: false }),
      source({ alpha: 0 }),
    ] as never);

    expect(presentation.size).toBe(1);
    expect(addImage).toHaveBeenCalledExactlyOnceWith(12, 34, 'enemy', 7);
    expect(first.setDisplaySize).toHaveBeenCalledWith(48, 52);
    expect(first.setTint).toHaveBeenCalledWith(0xffffff, 0xffffff, 0xffffff, 0xffffff);

    presentation.destroy();
    presentation.destroy();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(presentation.size).toBe(0);
  });

  it('beendet Gameplay vor dem Fade und haelt den Snapshot frei von Runtime-Abhaengigkeiten', () => {
    const scene = readFileSync(resolve(process.cwd(), 'src/scenes/ArenaScene.ts'), 'utf8');
    const coordinator = readFileSync(
      resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts'),
      'utf8',
    );
    const presentation = readFileSync(
      resolve(process.cwd(), 'src/world/ArenaExitEntityPresentation.ts'),
      'utf8',
    );

    const begin = scene.indexOf('this.arenaRuntime.beginArenaExitPresentation();');
    const play = scene.indexOf('overlay.play(outcome', begin);
    expect(begin).toBeGreaterThan(0);
    expect(play).toBeGreaterThan(begin);
    expect(scene).toContain(
      'worldVisible: exitPresentationActive || (worldActive && (!activityActive || arenaVisible)),',
    );

    const method = coordinator.slice(
      coordinator.indexOf('  beginArenaExitPresentation(): void'),
      coordinator.indexOf('  private clearArenaExitPresentation()', coordinator.indexOf('  beginArenaExitPresentation(): void')),
    );
    // Einfrieren, dann Instanz beenden, dann abraeumen – in genau dieser Reihenfolge.
    expect(method.indexOf('this.captureArenaExitEntityPresentation();'))
      .toBeLessThan(method.indexOf('this.synchronizeLocalWorldLifecycle(null);'));
    expect(method.indexOf('this.synchronizeLocalWorldLifecycle(null);'))
      .toBeLessThan(method.indexOf('this.tearDownArena(true);'));
    expect(method).toContain('new ArenaExitEntityPresentation(');

    // Der Host beendet seine World-Instanz schon beim Rundenabschluss. Player- und
    // Enemy-Runtime fallen mit ihr, deshalb steht das eingefrorene Bild dort vorher.
    const completeRound = coordinator.slice(
      coordinator.indexOf('  hostCompleteRound('),
      coordinator.indexOf('\n  /**', coordinator.indexOf('  hostCompleteRound(')),
    );
    expect(completeRound.indexOf('this.captureArenaExitEntityPresentation();'))
      .toBeLessThan(completeRound.indexOf('this.worldLifecycle.endInstance();'));
    expect(coordinator).toContain('this.arenaExitEntityPresentation && this.worldPresentationHandoff.pending');
    expect(presentation).not.toMatch(/EnemyManager|PlayerManager|Physics\.Arcade|NetworkBridge/);
  });
});
