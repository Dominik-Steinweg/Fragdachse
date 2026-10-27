import { PERSISTENT_BASE_INITIAL_HP } from '../src/persistentBase/PersistentBaseHealth';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PERSISTENT_BASE_CORE_CELLS,
  DEFAULT_PERSISTENT_BASE_AREA_STAGE,
  DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  PERSISTENT_BASE_CORE_SIZE_CELLS,
  PERSISTENT_BASE_AREA_STAGES,
  PERSISTENT_BASE_MAX_AREA_STAGE,
  isCampaignPersistentBaseAreaStage,
  resolvePersistentBaseReservationRadiusCells,
  buildPersistentBaseCoreBaseConfig,
  getCanonicalPersistentBaseCoreCells,
  getPersistentBaseCoreOrigin,
  getPersistentBaseCoreSolidOffsets,
  isCellInsidePersistentBaseBuildArea,
  isPersistentBaseBuildArea,
  isPersistentBaseAreaStage,
  resolvePersistentBaseCell,
  resolvePersistentBaseBuildAreaForStage,
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


function domainOf(
  cells: readonly { relativeGridX: number; relativeGridY: number; domain: PersistentBaseCellDomain }[],
  relativeGridX: number,
  relativeGridY: number,
): PersistentBaseCellDomain | undefined {
  return cells.find((cell) => cell.relativeGridX === relativeGridX && cell.relativeGridY === relativeGridY)?.domain;
}

describe('PersistentBaseCore – kanonische Form', () => {
  it('beschreibt eine quadratische Flaeche mit Anker in der Mitte', () => {
    expect(PERSISTENT_BASE_CORE_SIZE_CELLS).toBe(PERSISTENT_BASE_CORE_SIZE_CELLS);
    expect(CANONICAL_PERSISTENT_BASE_CORE_CELLS).toHaveLength(PERSISTENT_BASE_CORE_SIZE_CELLS ** 2);

    const xs = CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => cell.relativeGridX);
    const ys = CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => cell.relativeGridY);
    expect(Math.min(...xs)).toBe(-3);
    expect(Math.max(...xs)).toBe(3);
    expect(Math.min(...ys)).toBe(-3);
    expect(Math.max(...ys)).toBe(3);

    // Der Anker selbst ist eine echte Zelle mitten im Innenhof und traegt die Feuerstelle.
    expect(domainOf(CANONICAL_PERSISTENT_BASE_CORE_CELLS, 0, 0)).toBe('hearth');
  });

  it('teilt die Flaeche in feste Basis, Innenhof, Eingang und Feuerstelle', () => {
    expect(getCanonicalPersistentBaseCoreCells('base-surface')).toHaveLength(12);
    expect(getCanonicalPersistentBaseCoreCells('courtyard-build-area')).toHaveLength((PERSISTENT_BASE_CORE_SIZE_CELLS - 2) ** 2 - 1);
    expect(getCanonicalPersistentBaseCoreCells('entrance')).toHaveLength(12);
    expect(getCanonicalPersistentBaseCoreCells('hearth')).toEqual([{ relativeGridX: 0, relativeGridY: 0, domain: 'hearth' }]);
  });

  it('bildet vier mittige, drei Rasterfelder breite Eingaenge zwischen Eck-Bastionen', () => {
    const rows: string[] = [];
    for (let relativeGridY = -3; relativeGridY <= 3; relativeGridY += 1) {
      let row = '';
      for (let relativeGridX = -3; relativeGridX <= 3; relativeGridX += 1) {
        const domain = domainOf(CANONICAL_PERSISTENT_BASE_CORE_CELLS, relativeGridX, relativeGridY);
        row += domain === 'base-surface' ? 'B' : domain === 'courtyard-build-area' ? 'H' : domain === 'hearth' ? 'F' : 'E';
      }
      rows.push(row);
    }
    expect(rows).toEqual([
      'BBEEEBB',
      'BHHHHHB',
      'EHHHHHE',
      'EHHFHHE',
      'EHHHHHE',
      'BHHHHHB',
      'BBEEEBB',
    ]);
  });

  it('beschreibt die Area-Stufen zentral als 7x7-Quadrat bzw. Radius 5', () => {
    expect(DEFAULT_PERSISTENT_BASE_AREA_STAGE).toBe(0);
    expect(isPersistentBaseAreaStage(0)).toBe(true);
    expect(isPersistentBaseAreaStage(1)).toBe(true);
    expect(isPersistentBaseAreaStage(2)).toBe(true);
    expect(isPersistentBaseAreaStage(3)).toBe(true);
    const expanded = resolvePersistentBaseBuildAreaForStage(2);
    const previous = resolvePersistentBaseBuildAreaForStage(1);
    expect(expanded.kind).toBe('radius');
    if (expanded.kind === 'radius' && previous.kind === 'radius') {
      expect(expanded.radiusCells).toBeGreaterThan(previous.radiusCells);
      expect(isCellInsidePersistentBaseBuildArea(expanded.radiusCells, 0, expanded)).toBe(true);
      expect(isCellInsidePersistentBaseBuildArea(expanded.radiusCells, 0, previous)).toBe(false);
    }
    expect(resolvePersistentBaseBuildAreaForStage(0)).toEqual({ kind: 'square', sizeCells: 7 });
    expect(resolvePersistentBaseBuildAreaForStage(1)).toEqual({ kind: 'radius', radiusCells: 5 });
    expect(resolvePersistentBaseBuildAreaForStage(2)).toEqual({ kind: 'radius', radiusCells: 6 });
    expect(resolvePersistentBaseBuildAreaForStage(11)).toEqual({ kind: 'radius', radiusCells: 15 });
    expect(DEFAULT_PERSISTENT_BASE_BUILD_AREA).toEqual({ kind: 'square', sizeCells: 7 });
    expect(isPersistentBaseBuildArea(DEFAULT_PERSISTENT_BASE_BUILD_AREA)).toBe(true);
    expect(isPersistentBaseBuildArea({ kind: 'square', sizeCells: 4 })).toBe(false);
    expect(isPersistentBaseBuildArea({ kind: 'radius', radiusCells: 5 })).toBe(true);

    for (let relativeGridY = -4; relativeGridY <= 4; relativeGridY += 1) {
      for (let relativeGridX = -4; relativeGridX <= 4; relativeGridX += 1) {
        const inside = isCellInsidePersistentBaseBuildArea(
          relativeGridX,
          relativeGridY,
          DEFAULT_PERSISTENT_BASE_BUILD_AREA,
        );
        expect(inside).toBe(Math.abs(relativeGridX) <= 3 && Math.abs(relativeGridY) <= 3);
      }
    }
    expect(isCellInsidePersistentBaseBuildArea(3, 4, { kind: 'radius', radiusCells: 5 })).toBe(true);
  });

  it('accepts only supported integer stages and keeps the campaign storage boundary separate', () => {
    expect(PERSISTENT_BASE_AREA_STAGES).toEqual(Array.from({ length: PERSISTENT_BASE_MAX_AREA_STAGE + 1 }, (_, i) => i));
    for (const stage of PERSISTENT_BASE_AREA_STAGES) {
      expect(isPersistentBaseAreaStage(stage)).toBe(true);
      expect(isCampaignPersistentBaseAreaStage(stage)).toBe(stage <= 2);
    }
    for (const value of [-1, 12, 1.5, NaN, Infinity, '2', null, undefined, true]) {
      expect(isPersistentBaseAreaStage(value)).toBe(false);
      expect(isCampaignPersistentBaseAreaStage(value)).toBe(false);
    }
  });

  it('retains campaign and lobby reservations while accommodating the largest site', () => {
    expect(resolvePersistentBaseReservationRadiusCells()).toBe(12);
    expect(resolvePersistentBaseReservationRadiusCells(2)).toBe(12);
    expect(resolvePersistentBaseReservationRadiusCells(6)).toBe(12);
    expect(resolvePersistentBaseReservationRadiusCells(11)).toBe(17);
  });
});

describe('PersistentBaseCore – Vierteldrehungen', () => {
  // Der Host dreht die ganze Basis (PersistentBaseFrame). Das setzt voraus, dass Kern und
  // Baubereiche unter Vierteldrehungen deckungsgleich sind; sonst muesste die Fort-Grafik mitdrehen.
  const quarterTurn = (x: number, y: number) => ({ x: -y, y: x });

  it('haelt jede Kerndomain unter einer Vierteldrehung an ihrer Stelle', () => {
    expect(resolvePersistentBaseCoreCells({ gridX: 0, gridY: 0 })).toHaveLength(PERSISTENT_BASE_CORE_SIZE_CELLS ** 2);
    for (const cell of CANONICAL_PERSISTENT_BASE_CORE_CELLS) {
      const turned = quarterTurn(cell.relativeGridX, cell.relativeGridY);
      expect(resolvePersistentBaseCell({ gridX: 0, gridY: 0 }, turned.x, turned.y)?.domain,
        `${cell.relativeGridX}:${cell.relativeGridY}`).toBe(cell.domain);
    }
  });

  it('haelt jeden Baubereich unter einer Vierteldrehung deckungsgleich', () => {
    for (const stage of PERSISTENT_BASE_AREA_STAGES) {
      const area = resolvePersistentBaseBuildAreaForStage(stage);
      for (let y = -12; y <= 12; y += 1) {
        for (let x = -12; x <= 12; x += 1) {
          const turned = quarterTurn(x, y);
          expect(isCellInsidePersistentBaseBuildArea(turned.x, turned.y, area), `${stage} ${x}:${y}`)
            .toBe(isCellInsidePersistentBaseBuildArea(x, y, area));
        }
      }
    }
  });

  it('teilt den Kern in Bastionen, Hof, Eingaenge und die Feuerstelle', () => {
    const cells = resolvePersistentBaseCoreCells({ gridX: 40, gridY: 40 });
    for (const [domain, count] of [
      ['base-surface', 12],
      ['courtyard-build-area', 24],
      ['entrance', 12],
      ['hearth', 1],
    ] as const) {
      expect(cells.filter((cell) => cell.domain === domain), domain).toHaveLength(count);
    }
  });

  it('haelt die vier mittigen Eingangsseiten frei', () => {
    const entrances = resolvePersistentBaseCoreCells({ gridX: 40, gridY: 40 })
      .filter((cell) => cell.domain === 'entrance');
    expect(entrances.map((cell) => `${cell.gridX}:${cell.gridY}`).sort()).toEqual([
      '37:39', '37:40', '37:41',
      '39:37', '39:43',
      '40:37', '40:43',
      '41:37', '41:43',
      '43:39', '43:40', '43:41',
    ]);
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
    expect(getPersistentBaseCoreOrigin({ gridX: 24, gridY: 20 })).toEqual({ gridX: 21, gridY: 17 });
    // Die Shape-Offsets sind auf (0,0) normalisiert, damit sie zum Basisvertrag passen.
    const offsets = getPersistentBaseCoreSolidOffsets();
    // Zwoelf Bastionszellen und die Feuerstelle auf dem Anker.
    expect(offsets).toHaveLength(13);
    expect(offsets).toContainEqual({ gridX: 3, gridY: 3 });
    expect(Math.min(...offsets.map((offset) => offset.gridX))).toBe(0);
    expect(Math.min(...offsets.map((offset) => offset.gridY))).toBe(0);
    expect(Math.max(...offsets.map((offset) => offset.gridX))).toBe(6);
    expect(Math.max(...offsets.map((offset) => offset.gridY))).toBe(6);
  });
});

describe('PersistentBaseCore – Uebergang in den Basisvertrag', () => {
  const site = { baseId: 'core-under-test', anchor: { gridX: 30, gridY: 16 } } as const;

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
    expect(base.hpMax).toBe(PERSISTENT_BASE_INITIAL_HP);
    expect(base.faction).toBe('friendly');
    expect(base.role).toBe('main');
    expect(base.anchor).toEqual({ kind: 'grid', gridX: 27, gridY: 13 });
    expect(base.shape).toEqual({ kind: 'cells', cells: getPersistentBaseCoreSolidOffsets() });
  });

  it('loest den authored Anker unveraendert wieder auf', () => {
    const metrics = resolveWorldMetrics(getAuthoredWorldMetricsProfile(60, 33));
    const [resolved] = resolveWorldBases(worldWithCore(), metrics);

    // Die Bounding-Box ist immer die volle 7x7-Flaeche, ihre Mitte deshalb exakt die Ankerzelle.
    // Genau daran haengt, dass anker-relative Konstruktionen jede Map ueberleben.
    expect(resolved.region).toEqual({ minGridX: 27, maxGridX: 33, minGridY: 13, maxGridY: 19 });
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
