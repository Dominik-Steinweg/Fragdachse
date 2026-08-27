import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

// Phaser importiert globale Browser-APIs; minimaler Mock reicht, weil unsere Test-Pfade
// (buildSeparationGrid, computeSeparation, separationCellKey) keine Phaser-Runtime nutzen.
vi.mock('phaser', () => ({
  default: {},
  Math: {
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    RND: { realInRange: (min: number, max: number) => min + (max - min) * 0.5 },
    Angle: { Wrap: (r: number) => r },
  },
  GameObjects: {},
}));

import type { EnemyEntity } from '../src/entities/EnemyEntity';
import { EnemyManager } from '../src/entities/EnemyManager';

/**
 * Regressionstests für die persistente Separation-Grid-Struktur des EnemyManagers.
 *
 * Prüft:
 * 1. Identische Separation-Ergebnisse wie bei der früheren Neu-Allokation pro Frame.
 * 2. Wiederverwendung der Map- und Bucket-Instanzen über Frames hinweg.
 * 3. Keine stale Enemy-Referenzen zwischen Frames.
 * 4. Cleanup des Bucket-Pools bei stark sinkender Gegnerzahl.
 */

/** Baut ein minimales EnemyEntity-Stub mit den für das Grid nötigen Feldern. */
function stubEnemy(id: string, x: number, y: number): EnemyEntity {
  return fakeEntity({ id, x, y, destroy() {} }) as unknown as EnemyEntity;
}

/**
 * Erzeugt einen EnemyManager und bestückt ihn mit den gegebenen Stubs, ohne den vollen
 * Spawn-Lifecycle zu durchlaufen (das Grid braucht nur die `enemies`-Map).
 */
function makeManager(enemies: EnemyEntity[]): EnemyManager {
  const manager = new EnemyManager(null as any);
  const map: Map<string, EnemyEntity> = (manager as any).enemies;
  for (const e of enemies) map.set(e.id, e);
  return manager;
}

describe('EnemySeparationGrid – Wiederverwendung', () => {

  it('erzeugt korrekte Buckets mit denselben Gegnern wie eine frische Map', () => {
    const enemies = [
      stubEnemy('a', 100, 100),
      stubEnemy('b', 105, 105), // gleiche Zelle wie a
      stubEnemy('c', 900, 900), // andere Zelle
    ];
    const mgr = makeManager(enemies);
    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();

    // b und a liegen in derselben Zelle
    const keyA = (mgr as any).separationCellKey(100, 100);
    const keyC = (mgr as any).separationCellKey(900, 900);
    expect(grid.get(keyA)!.sort((a: EnemyEntity, b: EnemyEntity) => a.id.localeCompare(b.id)))
      .toEqual([enemies[0], enemies[1]]);
    expect(grid.get(keyC)).toEqual([enemies[2]]);
  });

  it('gibt bei leerem Gegner-Set eine leere Map zurück', () => {
    const mgr = makeManager([]);
    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    expect(grid.size).toBe(0);
  });

  it('verwendet zwischen Aufrufen dieselbe Map-Instanz', () => {
    const mgr = makeManager([stubEnemy('a', 50, 50)]);
    const grid1: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    const grid2: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    expect(grid1).toBe(grid2); // selbe Referenz
  });

  it('recycelt Bucket-Arrays aus dem Pool statt neue anzulegen', () => {
    const mgr = makeManager([stubEnemy('a', 50, 50), stubEnemy('b', 5000, 5000)]);
    const firstGrid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();

    // Buckets aus dem ersten Build merken.
    const firstBuckets = [...firstGrid.values()];

    // Zweiter Build – die alten Buckets sollten in den Pool gegangen und wiederverwendet worden sein.
    (mgr as any).buildSeparationGrid();
    const secondBuckets = [...firstGrid.values()];

    // Mindestens ein recyceltes Array sollte unter den neuen Buckets auftauchen.
    const recycled = secondBuckets.filter(b => firstBuckets.includes(b));
    expect(recycled.length).toBeGreaterThan(0);
  });

  it('hält keine stale Enemy-Referenzen nach Entfernung', () => {
    const e1 = stubEnemy('a', 50, 50);
    const e2 = stubEnemy('b', 50, 50); // gleiche Zelle
    const mgr = makeManager([e1, e2]);

    // Erster Build: beide drin.
    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    const keyA = (mgr as any).separationCellKey(50, 50);
    expect(grid.get(keyA)!.length).toBe(2);

    // Gegner b entfernen.
    (mgr as any).enemies.delete('b');

    // Zweiter Build: nur noch a.
    (mgr as any).buildSeparationGrid();
    const bucket = grid.get(keyA)!;
    expect(bucket.length).toBe(1);
    expect(bucket[0]).toBe(e1);
  });

  it('hält keine stale Zellen nach Positionswechsel', () => {
    const e = stubEnemy('a', 50, 50);
    const mgr = makeManager([e]);

    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    const oldKey = (mgr as any).separationCellKey(50, 50);
    expect(grid.has(oldKey)).toBe(true);

    // Gegner bewegt sich in eine andere Zelle.
    e.sprite.x = 5000;
    e.sprite.y = 5000;
    (mgr as any).buildSeparationGrid();

    // Alte Zelle darf nicht mehr existieren (Map wurde gecleart).
    const newKey = (mgr as any).separationCellKey(5000, 5000);
    expect(oldKey).not.toBe(newKey);
    expect(grid.has(oldKey)).toBe(false);
    expect(grid.get(newKey)!).toEqual([e]);
  });

  it('kürzt den Bucket-Pool nach 300 Frames wenn Gegnerzahl stark sinkt', () => {
    // Viele Gegner erzeugen → viele Buckets.
    const manyEnemies: EnemyEntity[] = [];
    for (let i = 0; i < 200; i++) {
      manyEnemies.push(stubEnemy(`e${i}`, i * 500, i * 500));
    }
    const mgr = makeManager(manyEnemies);
    (mgr as any).buildSeparationGrid();

    // Alle Gegner entfernen → nächster Build produziert Pool-Einträge, aber keine Buckets.
    (mgr as any).enemies.clear();

    // 300 Frames simulieren, um den Cleanup-Zyklus zu triggern.
    for (let frame = 0; frame < 300; frame++) {
      (mgr as any).buildSeparationGrid();
    }

    const pool: unknown[] = (mgr as any).separationBucketPool;
    // gridSize ist 0, also maxPoolSize = 0. Pool muss auf 0 gekürzt sein.
    expect(pool.length).toBe(0);
  });

  it('destroy() räumt Grid und Pool vollständig auf', () => {
    const mgr = makeManager([stubEnemy('a', 50, 50)]);
    (mgr as any).buildSeparationGrid();

    // Vor destroy: Grid und Pool sind nicht leer.
    expect((mgr as any).separationGrid.size).toBeGreaterThan(0);

    mgr.destroy();

    expect((mgr as any).separationGrid.size).toBe(0);
    expect((mgr as any).separationBucketPool.length).toBe(0);
    expect((mgr as any).separationGridCleanupCounter).toBe(0);
  });

  it('computeSeparation liefert identische Ergebnisse mit persistentem Grid', () => {
    // Zwei Gegner nah beieinander → Push-Vektor muss nicht-null sein.
    const e1 = stubEnemy('a', 100, 100);
    const e2 = stubEnemy('b', 110, 105);
    const mgr = makeManager([e1, e2]);
    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();

    const sep1 = (mgr as any).computeSeparation(e1, grid);
    const sep1x = sep1.x;
    const sep1y = sep1.y;
    // Vektor zeigt weg von e2: dx = 100-110 = -10, dy = 100-105 = -5 → negativer Push.
    expect(sep1x).toBeLessThan(0);
    expect(sep1y).toBeLessThan(0);

    // Ergebnis muss bei erneutem Aufruf mit recyceltem Grid identisch sein.
    (mgr as any).buildSeparationGrid();
    const sep2 = (mgr as any).computeSeparation(e1, (mgr as any).separationGrid);
    expect(sep2.x).toBeCloseTo(sep1x, 10);
    expect(sep2.y).toBeCloseTo(sep1y, 10);
  });

  it('Gegner ausserhalb des Separation-Radius erzeugen keinen Push', () => {
    // Gegner weit voneinander entfernt.
    const e1 = stubEnemy('a', 0, 0);
    const e2 = stubEnemy('b', 10000, 10000);
    const mgr = makeManager([e1, e2]);
    const grid: Map<number, EnemyEntity[]> = (mgr as any).buildSeparationGrid();
    const sep = (mgr as any).computeSeparation(e1, grid);
    expect(sep.x).toBe(0);
    expect(sep.y).toBe(0);
  });
});
