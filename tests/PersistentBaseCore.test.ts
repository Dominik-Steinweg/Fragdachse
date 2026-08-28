import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PERSISTENT_BASE_CORE_CELLS,
  DEFAULT_PERSISTENT_BASE_ORIENTATION,
  PERSISTENT_BASE_CORE_SIZE_CELLS,
  PERSISTENT_BASE_ORIENTATIONS,
  buildPersistentBaseCoreBaseConfig,
  getCanonicalPersistentBaseCoreCells,
  getPersistentBaseCoreOrigin,
  getPersistentBaseCoreSurfaceOffsets,
  isPersistentBaseOrientation,
  resolvePersistentBaseCoreCells,
  type PersistentBaseCellDomain,
} from '../src/persistentBase/PersistentBaseCore';
import { resolveWorldBases } from '../src/arena/BaseRegistry';
import { getPersistentBaseAnchor } from '../src/persistentBase/PersistentBaseZone';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';
import { getAuthoredWorldMetricsProfile } from '../src/config';
import type { WorldDefinition } from '../src/config/authoring/WorldDefinition';

/**
 * Phase 3A – der persistente Basiskern ist Code-Definition, keine Map-Geometrie.
 *
 * Abgesicherter Pflichtzustand: Es gibt genau **eine** Beschreibung der Basisform. Eine World
 * steuert Lage und Ausrichtung bei, nie eine Zelle. Daraus folgt der eigentliche Nachweis dieser
 * Phase: Dieselbe Basis erscheint an verschiedenen Ankern deckungsgleich, ohne dass ihre Form je
 * Map beschrieben worden waere.
 */

function cellKeys(cells: readonly { gridX: number; gridY: number }[]): string[] {
  return cells.map((cell) => `${cell.gridX}:${cell.gridY}`).sort();
}

function domainOf(
  cells: readonly { relativeGridX: number; relativeGridY: number; domain: PersistentBaseCellDomain }[],
  relativeGridX: number,
  relativeGridY: number,
): PersistentBaseCellDomain | undefined {
  return cells.find((cell) => cell.relativeGridX === relativeGridX && cell.relativeGridY === relativeGridY)?.domain;
}

describe('PersistentBaseCore – kanonische Form', () => {
  it('beschreibt eine 5x5-Flaeche mit Anker in der Mitte', () => {
    expect(PERSISTENT_BASE_CORE_SIZE_CELLS).toBe(5);
    expect(CANONICAL_PERSISTENT_BASE_CORE_CELLS).toHaveLength(25);

    const xs = CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => cell.relativeGridX);
    const ys = CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => cell.relativeGridY);
    expect(Math.min(...xs)).toBe(-2);
    expect(Math.max(...xs)).toBe(2);
    expect(Math.min(...ys)).toBe(-2);
    expect(Math.max(...ys)).toBe(2);

    // Der Anker selbst ist eine echte Zelle und liegt im Innenhof – nicht in einer Wand.
    expect(domainOf(CANONICAL_PERSISTENT_BASE_CORE_CELLS, 0, 0)).toBe('courtyard-build-area');
  });

  it('teilt die Flaeche in feste Basis, Innenhof und Eingang', () => {
    expect(getCanonicalPersistentBaseCoreCells('base-surface')).toHaveLength(13);
    expect(getCanonicalPersistentBaseCoreCells('courtyard-build-area')).toHaveLength(9);
    expect(getCanonicalPersistentBaseCoreCells('entrance')).toHaveLength(3);
  });

  it('bildet ein nach links geoeffnetes U', () => {
    const rows: string[] = [];
    for (let relativeGridY = -2; relativeGridY <= 2; relativeGridY += 1) {
      let row = '';
      for (let relativeGridX = -2; relativeGridX <= 2; relativeGridX += 1) {
        const domain = domainOf(CANONICAL_PERSISTENT_BASE_CORE_CELLS, relativeGridX, relativeGridY);
        row += domain === 'base-surface' ? 'B' : domain === 'courtyard-build-area' ? 'H' : 'E';
      }
      rows.push(row);
    }
    expect(rows).toEqual([
      'BBBBB',
      'EHHHB',
      'EHHHB',
      'EHHHB',
      'BBBBB',
    ]);
  });
});

describe('PersistentBaseCore – Ausrichtung', () => {
  it('kennt vier Ausrichtungen und weist alles andere ab', () => {
    expect(DEFAULT_PERSISTENT_BASE_ORIENTATION).toBe('open-left');
    expect(PERSISTENT_BASE_ORIENTATIONS).toContain(DEFAULT_PERSISTENT_BASE_ORIENTATION);
    expect(isPersistentBaseOrientation('open-up')).toBe(true);
    expect(isPersistentBaseOrientation('open-sideways')).toBe(false);
    expect(isPersistentBaseOrientation(undefined)).toBe(false);
  });

  it('dreht dieselbe Form, statt eine zweite zu beschreiben', () => {
    const anchor = { gridX: 40, gridY: 40 };
    for (const orientation of PERSISTENT_BASE_ORIENTATIONS) {
      const cells = resolvePersistentBaseCoreCells(anchor, orientation);
      expect(cells).toHaveLength(25);
      // Die Domainverteilung ist eine Eigenschaft der Form, nicht ihrer Lage im Raum.
      for (const [domain, count] of [
        ['base-surface', 13],
        ['courtyard-build-area', 9],
        ['entrance', 3],
      ] as const) {
        expect(cells.filter((cell) => cell.domain === domain), orientation).toHaveLength(count);
      }
      // Die Drehung erfolgt um den Anker; die belegte Flaeche bleibt exakt dieselbe 5x5-Box.
      expect(cellKeys(cells), orientation)
        .toEqual(cellKeys(resolvePersistentBaseCoreCells(anchor)));
    }
  });

  it('legt den Eingang je Ausrichtung auf die passende Seite', () => {
    const anchor = { gridX: 40, gridY: 40 };
    const entranceOf = (orientation: typeof PERSISTENT_BASE_ORIENTATIONS[number]) =>
      resolvePersistentBaseCoreCells(anchor, orientation).filter((cell) => cell.domain === 'entrance');

    expect(entranceOf('open-left').every((cell) => cell.gridX === 38)).toBe(true);
    expect(entranceOf('open-right').every((cell) => cell.gridX === 42)).toBe(true);
    expect(entranceOf('open-up').every((cell) => cell.gridY === 38)).toBe(true);
    expect(entranceOf('open-down').every((cell) => cell.gridY === 42)).toBe(true);
  });
});

describe('PersistentBaseCore – dieselbe Basis an verschiedenen Ankern', () => {
  it('erscheint an zwei Ankern deckungsgleich, nur verschoben', () => {
    const here = resolvePersistentBaseCoreCells({ gridX: 24, gridY: 20 });
    const there = resolvePersistentBaseCoreCells({ gridX: 34, gridY: 20 });
    expect(there.map((cell) => ({
      gridX: cell.gridX - 10,
      gridY: cell.gridY,
      domain: cell.domain,
    }))).toEqual([...here]);
  });

  it('haelt Shape-Ursprung und Anker deterministisch auseinander', () => {
    expect(getPersistentBaseCoreOrigin({ gridX: 24, gridY: 20 })).toEqual({ gridX: 22, gridY: 18 });
    // Die Shape-Offsets sind auf (0,0) normalisiert, damit sie zum Basisvertrag passen.
    const offsets = getPersistentBaseCoreSurfaceOffsets();
    expect(offsets).toHaveLength(13);
    expect(Math.min(...offsets.map((offset) => offset.gridX))).toBe(0);
    expect(Math.min(...offsets.map((offset) => offset.gridY))).toBe(0);
    expect(Math.max(...offsets.map((offset) => offset.gridX))).toBe(4);
    expect(Math.max(...offsets.map((offset) => offset.gridY))).toBe(4);
  });
});

describe('PersistentBaseCore – Uebergang in den Basisvertrag', () => {
  const site = { baseId: 'core-under-test', anchor: { gridX: 30, gridY: 16 }, hpMax: 4200 } as const;

  function worldWithCore(): WorldDefinition {
    return {
      id: 'world:test:persistent-core',
      metrics: { widthCells: 60, heightCells: 33 },
      terrain: {},
      bases: [buildPersistentBaseCoreBaseConfig(site)],
      persistentBaseSite: site,
      initialTimeOfDay: '12:00',
    };
  }

  it('erzeugt eine friendly Main-Base mit den Kernzellen', () => {
    const base = buildPersistentBaseCoreBaseConfig(site);
    expect(base.id).toBe('core-under-test');
    expect(base.hpMax).toBe(4200);
    expect(base.faction).toBe('friendly');
    expect(base.role).toBe('main');
    expect(base.anchor).toEqual({ kind: 'grid', gridX: 28, gridY: 14 });
    expect(base.shape).toEqual({ kind: 'cells', cells: getPersistentBaseCoreSurfaceOffsets() });
  });

  it('loest den authored Anker unveraendert wieder auf', () => {
    const metrics = resolveWorldMetrics(getAuthoredWorldMetricsProfile(60, 33));
    const [resolved] = resolveWorldBases(worldWithCore(), metrics);

    // Die Bounding-Box ist immer die volle 5x5-Flaeche, ihre Mitte deshalb exakt die Ankerzelle.
    // Genau daran haengt, dass anker-relative Konstruktionen jede Map ueberleben.
    expect(resolved.region).toEqual({ minGridX: 28, maxGridX: 32, minGridY: 14, maxGridY: 18 });
    expect(getPersistentBaseAnchor(resolved)).toEqual(site.anchor);
    expect(resolved.cells).toHaveLength(13);
    expect(resolved.persistentReservationRadiusCells).toBeGreaterThan(0);
  });

  it('laesst den Kern samt Reservierung aus, wenn die Instanz ihn nicht besitzt', () => {
    const metrics = resolveWorldMetrics(getAuthoredWorldMetricsProfile(60, 33));
    expect(resolveWorldBases(worldWithCore(), metrics, { includePersistentBaseCore: false }))
      .toEqual([]);
  });
});
