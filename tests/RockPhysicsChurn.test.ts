import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import { CELL_SIZE } from '../src/config';
import type { RockCell } from '../src/types';
import { RockGridIndex } from '../src/arena/RockGridIndex';

/**
 * Die Kosten einer Felszerstoerung duerfen nicht am Gesamtbestand haengen.
 *
 * `Phaser.Physics.Arcade.StaticGroup.refresh()` sieht harmlos aus, ruft aber `body.reset()` auf
 * **jedem** Mitglied, und jedes `reset()` entfernt den Koerper aus dem statischen RTree und fuegt
 * ihn sofort wieder ein. Pro zerstoertem Fels war das ein vollstaendiger Umbau des Baums: Auf
 * einer Karte mit rund 29 000 Felsen kostete eine Flaechenzerstoerung damit hunderte Millionen
 * Baumoperationen – im Trace ein 30 Sekunden langes Standbild bei der NUKE.
 *
 * Der Test prueft deshalb nicht eine Zeit, sondern die Eigenschaft: Ein einzelner Fels fasst nur
 * seinen eigenen Koerper an.
 */

const ROCKS: RockCell[] = Array.from({ length: 64 }, (_, index) => ({
  gridX: index % 8,
  gridY: Math.floor(index / 8),
}));

function fakeRock() {
  const body = { updateFromGameObject: vi.fn() };
  return {
    active: true,
    body,
    setFrame: vi.fn(),
    setTint: vi.fn(),
    setVisible: vi.fn(),
    destroy(): void { this.active = false; },
  };
}

function buildResult() {
  const rockObjects = ROCKS.map(() => fakeRock());
  const removed: unknown[] = [];
  const rockGroup = {
    // Wie die echte StaticGroup: Der Beitritt versorgt das Objekt mit seinem Koerper.
    add: vi.fn((child: { body?: unknown }) => {
      child.body ??= { updateFromGameObject: vi.fn() };
      return rockGroup;
    }),
    remove: vi.fn((child: unknown) => {
      removed.push(child);
      (child as { destroy(): void }).destroy();
    }),
    refresh: vi.fn(),
    destroy: vi.fn(),
  };
  const result = {
    rockObjects,
    rockStateTints: ROCKS.map(() => 0xffffff),
    rockGroup,
    rockGrid: new RockGridIndex(ROCKS, { cols: 8, rows: 8 }),
    rockCuller: null,
  } as unknown as ArenaBuilderResult;
  return { result, rockGroup, rockObjects, removed };
}

describe('rock destruction physics churn', () => {
  it('never resets the whole static group when a single rock falls', () => {
    const { result, rockGroup, rockObjects } = buildResult();
    const destroyed = rockObjects[10];

    ArenaBuilder.destroyRock(result, 10);

    expect(destroyed.active).toBe(false);
    expect(result.rockObjects[10]).toBeNull();
    // Der Gruppenabgang meldet den Koerper bereits ab; ein `refresh()` waere ein O(Bestand)-Sturm.
    expect(rockGroup.refresh).not.toHaveBeenCalled();
    expect(rockGroup.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the cost of a destruction wave linear in the destroyed rocks', () => {
    const { result, rockGroup } = buildResult();

    for (let id = 0; id < ROCKS.length; id += 1) {
      ArenaBuilder.destroyRockAndRetile(result, ROCKS, id);
    }

    expect(rockGroup.refresh).not.toHaveBeenCalled();
    expect(rockGroup.remove).toHaveBeenCalledTimes(ROCKS.length);
    expect(result.rockObjects.every((image) => image === null)).toBe(true);
  });

  it('touches only the new body when a rock is built at runtime', () => {
    const { result, rockGroup } = buildResult();
    // Alle Nachbarn merken, bevor der Slot neu besetzt wird.
    const survivors = result.rockObjects.filter((image, id) => image !== null && id !== 10);
    ArenaBuilder.destroyRockAndRetile(result, ROCKS, 10);
    rockGroup.refresh.mockClear();

    // Der Fels wird losgeloest gebaut und nur noch der Anzeigeliste (oder der Fels-Ebene)
    // uebergeben; die Attrappe muss deshalb `existing` kennen, nicht `image`.
    const scene = { add: { existing: <T>(gameObject: T): T => gameObject } };
    ArenaBuilder.spawnRockAndRetile(
      scene as never,
      result,
      ROCKS,
      10,
      undefined,
      0,
      100,
      100,
      { offsetX: 0, offsetY: 0, width: 8 * CELL_SIZE, height: 8 * CELL_SIZE },
    );

    expect(rockGroup.refresh).not.toHaveBeenCalled();
    expect(result.rockObjects[10]).toBeTruthy();
    // Genau ein Koerper wird in den Baum eingetragen: der neue. Kein Nachbar wird angefasst.
    const touchedSurvivors = survivors.filter((image) => (
      (image as unknown as ReturnType<typeof fakeRock>).body.updateFromGameObject.mock.calls.length > 0
    ));
    expect(touchedSurvivors).toHaveLength(0);
    const spawned = result.rockObjects[10] as unknown as ReturnType<typeof fakeRock>;
    expect(spawned.body.updateFromGameObject).toHaveBeenCalledTimes(1);
  });
});
