import { describe, expect, it } from 'vitest';
import {
  mergePersistentBaseComposite,
  type PersistentBaseCompositeMergeInput,
  type PersistentCompositeTool,
} from '../src/persistentBase/PersistentBaseComposite';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import type {
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from '../src/persistentBase/PersistentBaseTypes';

/**
 * Phase 3B – der Composite-Merge ist die eine Autoritaet ueber die sichtbare Basis.
 *
 * Abgesicherter Pflichtzustand:
 *
 *   - Prioritaet authored Geometrie, dann Host, dann Gaeste - und Gaeste deterministisch
 *     unabhaengig von ihrer Beitrittsreihenfolge.
 *   - Freischaltung und Kapazitaet gehoeren dem Besitzer, nicht dem Host.
 *   - Ein Konflikt materialisiert nicht, loescht aber nichts: Der Blueprint bleibt im Beitrag
 *     seines Besitzers stehen und erscheint im naechsten Raum moeglicherweise wieder.
 */

const anchor = { gridX: 20, gridY: 20 };
const buildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA;
function blueprint(
  persistentId: string,
  relativeGridX: number,
  relativeGridY: number,
  placementOrder = 0,
  toolId = 'rock_barrier',
): PersistentConstruction {
  return {
    persistentId,
    tool: { kind: 'construction', id: toolId },
    relativeGridX,
    relativeGridY,
    angle: 0,
    placementOrder,
  };
}

function contribution(
  ownerId: string,
  constructions: readonly PersistentConstruction[],
  revision = 1,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions,
  };
}

const singleCellTool: PersistentCompositeTool = { footprint: [{ dx: 0, dy: 0 }], capacityCost: 1 };

function merge(overrides: Partial<PersistentBaseCompositeMergeInput> = {}) {
  return mergePersistentBaseComposite({
    anchor,
    buildArea,
    hostContribution: null,
    resolveTool: () => singleCellTool,
    ...overrides,
  });
}

describe('PersistentBaseComposite – Prioritaet und Determinismus', () => {
  it('laesst den Host eine Zelle gegen jeden Gast gewinnen', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('host-1', 0, 0)]),
      guestContributions: [contribution('owner-guest', [blueprint('guest-1', 0, 0)])],
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['host-1']);
    expect(result.conflicts).toEqual([
      { ownerId: 'owner-guest', persistentId: 'guest-1', toolId: 'rock_barrier', reason: 'collision' },
    ]);
    // Der Gast verliert die Zelle, nicht seinen Besitz.
    expect(result.conflictsByOwner.get('owner-guest')).toHaveLength(1);
  });

  it('liefert dasselbe Ergebnis unabhaengig von der Beitrittsreihenfolge', () => {
    const guestB = contribution('owner-b', [blueprint('b-1', 0, 0)]);
    const guestA = contribution('owner-a', [blueprint('a-1', 0, 0)]);

    const first = merge({ guestContributions: [guestA, guestB] });
    const second = merge({ guestContributions: [guestB, guestA] });

    // Sortiert wird nach stabiler Besitzeridentitaet, nie nach Reihenfolge des Beitritts.
    expect(first.active.map((entry) => entry.blueprint.persistentId)).toEqual(['a-1']);
    expect(second.active.map((entry) => entry.blueprint.persistentId)).toEqual(['a-1']);
    expect(second.conflicts).toEqual(first.conflicts);
  });

  it('ordnet innerhalb eines Beitrags nach Bau-Reihenfolge', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [
        blueprint('later', 0, 0, 5),
        blueprint('earlier', 0, 0, 1),
      ]),
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['earlier']);
    expect(result.conflicts.map((entry) => entry.persistentId)).toEqual(['later']);
  });

  it('ignoriert einen Gast, der dieselbe Besitzeridentitaet wie der Host meldet', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('host-1', 1, 1)]),
      guestContributions: [contribution('owner-host', [blueprint('doppelgaenger', -1, -1)])],
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['host-1']);
  });
});
describe('PersistentBaseComposite – Baubereich ist die einzige Geometriequelle', () => {
  it('weist alles ausserhalb des Innenhofs ab', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [
        blueprint('inside', 1, 1, 0),
        blueprint('outside', 2, 0, 1),
      ]),
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['inside']);
    expect(result.conflicts).toEqual([
      { ownerId: 'owner-host', persistentId: 'outside', toolId: 'rock_barrier', reason: 'outside-build-area' },
    ]);
  });

  it('verlangt den ganzen Fussabdruck im Baubereich, nicht nur seinen Ursprung', () => {
    const wideTool: PersistentCompositeTool = {
      footprint: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }],
      capacityCost: 1,
    };
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('spills-out', 1, 0)]),
      resolveTool: () => wideTool,
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts[0]?.reason).toBe('outside-build-area');
  });

  it('folgt einer radiusbasierten Regel, ohne dass der Merge sich aendert', () => {
    const result = merge({
      buildArea: { kind: 'radius', radiusCells: 3 },
      hostContribution: contribution('owner-host', [blueprint('far', 3, 0)]),
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['far']);
  });

  it('bewahrt gespeicherte Konstruktionen ausserhalb der aktiven Area als Konflikt', () => {
    const saved = contribution('owner-host', [blueprint('future-expansion', 6, 0)]);
    const result = merge({
      buildArea: { kind: 'radius', radiusCells: 5 },
      hostContribution: saved,
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        ownerId: 'owner-host',
        persistentId: 'future-expansion',
        toolId: 'rock_barrier',
        reason: 'outside-build-area',
      },
    ]);
    expect(saved.constructions).toHaveLength(1);
  });

  it('behandelt authored Geometrie als eigene Kollisionsart', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('on-authored', 0, 0)]),
      isCellBlocked: (gridX, gridY) => gridX === anchor.gridX && gridY === anchor.gridY,
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts[0]?.reason).toBe('authored-collision');
  });
});
describe('PersistentBaseComposite – Freischaltung und Kapazitaet gehoeren dem Besitzer', () => {
  it('laesst ein Gast-Werkzeug erscheinen, das der Host nicht besitzt', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('host-locked', 1, 1, 0, 'fancy_tool')]),
      guestContributions: [contribution('owner-guest', [blueprint('guest-fancy', -1, -1, 0, 'fancy_tool')])],
      // Dasselbe Werkzeug, zwei Besitzer, zwei Antworten: Genau darum wird pro Besitzer aufgeloest.
      resolveTool: (ownerId) => (ownerId === 'owner-host'
        ? { ...singleCellTool, unavailableReason: 'locked' }
        : singleCellTool),
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['guest-fancy']);
    expect(result.conflicts).toEqual([
      { ownerId: 'owner-host', persistentId: 'host-locked', toolId: 'fancy_tool', reason: 'locked' },
    ]);
  });

  it('prueft Kapazitaet je Besitzer statt als gemeinsamen Basis-Pool', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [
        blueprint('host-1', 0, 0, 0),
        blueprint('host-2', 1, 0, 1),
      ]),
      guestContributions: [contribution('owner-guest', [blueprint('guest-1', -1, 0)])],
      capacityMaxByOwner: new Map([['owner-host', 1], ['owner-guest', 1]]),
    });

    // Der Host stoesst an seine eigene Grenze; die des Gastes bleibt davon unberuehrt.
    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['host-1', 'guest-1']);
    expect(result.conflicts).toEqual([
      { ownerId: 'owner-host', persistentId: 'host-2', toolId: 'rock_barrier', reason: 'capacity' },
    ]);
  });

  it('meldet ein unbekanntes Werkzeug als Konflikt statt es stillschweigend zu verwerfen', () => {
    const result = merge({
      hostContribution: contribution('owner-host', [blueprint('gone', 0, 0, 0, 'removed_tool')]),
      resolveTool: () => null,
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts[0]?.reason).toBe('unknown-tool');
  });
});

describe('PersistentBaseComposite – erneuter Merge auf einer laufenden Welt', () => {
  const standing = contribution('owner-host', [blueprint('standing', 0, 0)]);

  it('kollidiert mit sich selbst, wenn die eigenen Zellen als statisch gelten', () => {
    // Genau der Fehlerfall, den der Aufrufer verhindern muss: Die bereits materialisierte
    // Konstruktion belegt ihre Zelle im PlacementSystem. Reicht der Aufrufer das ungefiltert
    // als statische Geometrie weiter, verdraengt sich jeder stehende Eintrag selbst - und keine
    // Prioritaet koennte je greifen.
    const result = merge({
      hostContribution: standing,
      isCellBlocked: (gridX, gridY) => gridX === anchor.gridX && gridY === anchor.gridY,
    });

    expect(result.active).toEqual([]);
    expect(result.conflicts[0]).toMatchObject({ persistentId: 'standing', reason: 'authored-collision' });
  });

  it('liefert unveraendert dasselbe Ergebnis, wenn die eigenen Zellen ausgenommen sind', () => {
    const ownCells = new Set([`${anchor.gridX}:${anchor.gridY}`]);
    const result = merge({
      hostContribution: standing,
      isCellBlocked: (gridX, gridY) => !ownCells.has(`${gridX}:${gridY}`)
        && gridX === anchor.gridX && gridY === anchor.gridY,
    });

    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['standing']);
    expect(result.conflicts).toEqual([]);
  });

  it('verdraengt einen stehenden Eintrag, sobald ein hoeher priorisierter Besitzer dazukommt', () => {
    const ownCells = new Set([`${anchor.gridX}:${anchor.gridY}`]);
    const isCellBlocked = (gridX: number, gridY: number): boolean => !ownCells.has(`${gridX}:${gridY}`);

    // Erst steht nur der Gast auf der Zelle ...
    const before = merge({ guestContributions: [contribution('owner-b', [blueprint('b-1', 0, 0)])], isCellBlocked });
    expect(before.active.map((entry) => entry.blueprint.persistentId)).toEqual(['b-1']);

    // ... dann betritt der Host den Raum und hat Vorrang.
    const after = merge({
      hostContribution: contribution('owner-host', [blueprint('host-1', 0, 0)]),
      guestContributions: [contribution('owner-b', [blueprint('b-1', 0, 0)])],
      isCellBlocked,
    });
    expect(after.active.map((entry) => entry.blueprint.persistentId)).toEqual(['host-1']);
    expect(after.conflicts).toEqual([
      { ownerId: 'owner-b', persistentId: 'b-1', toolId: 'rock_barrier', reason: 'collision' },
    ]);
  });
});
