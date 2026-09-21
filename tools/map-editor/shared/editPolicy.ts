import { object, stable, type JsonObject } from './json';

type Rule = true | { [key: string]: Rule } | { $items: Rule; $mutable: boolean; $id?: string };
const point: Rule = { gridX: true, gridY: true };
const rect: Rule = { ...point as object, widthCells: true, heightCells: true };
const trigger: Rule = { type: true, atMs: true, encounterId: true, checkpointId: true, defenseId: true, eventId: true, phase: true, baseId: true };
const group: Rule = { enemyKind: true, count: true, delayMs: true, spawnStaggerMs: true, front: true, spawnArea: rect };
const policy: Rule = {
  arenaWidthCells: true, arenaHeightCells: true, rockFillRatio: true, treeCount: true,
  rockField: { fillMode: true, corridorRadiusCells: true, corridorRadiusVarianceCells: true, corridorWanderCells: true,
    waypointJitterCells: true, rockDensityScale: true,
    corridors: { $items: { id: true, radiusCells: true, points: { $items: point, $mutable: true } }, $mutable: true, $id: 'id' } },
  water: { $items: point, $mutable: true }, waterAreas: { $items: rect, $mutable: true },
  rockWalls: { $items: { ...rect as object, id: true }, $mutable: true, $id: 'id' },
  tutorialAnchor: point, tutorialSteps: { $items: { anchor: point }, $mutable: false, $id: 'id' },
  persistentBase: { anchor: point },
  bases: { $items: { anchor: { kind: true, gridX: true, gridY: true, dxCells: true, dyCells: true, edgeInsetCells: true } }, $mutable: false, $id: 'id' },
  missionProgress: { startArea: { ...point as object, radiusCells: true },
    checkpoints: { $items: { ...point as object, radiusCells: true }, $mutable: false, $id: 'id' } },
  secondaryObjectives: { $items: { carry: { spawnZone: rect, deliveryZone: rect } }, $mutable: false, $id: 'id' },
  encounters: { $items: { id: true, start: trigger, restAfterMs: true, groups: { $items: group, $mutable: true } }, $mutable: true, $id: 'id' },
  boss: { enemyKind: true, spawnAtMs: true },
};

/** Whether a scalar belongs to the editor's supported authoring surface. */
export function isEditableMapField(path: readonly string[]): boolean {
  let rule: Rule | undefined = policy;
  for (const part of path) {
    if (!rule || rule === true) return false;
    rule = '$items' in rule ? rule.$items as Rule : rule[part];
  }
  return rule === true;
}

/** Protects fields outside the supported authoring surface, including unknown extension fields. */
export function assertSupportedMapEdit(before: JsonObject, after: JsonObject): void {
  const check = (old: unknown, next: unknown, rule: Rule | undefined, path: string): void => {
    if (stable(old) === stable(next) || rule === true) return;
    if (!rule) throw Error(`Schreibgeschütztes Feld geändert: ${path}`);
    if ('$items' in rule) {
      const listRule = rule as { $items: Rule; $mutable: boolean; $id?: string };
      const a = Array.isArray(old) ? old : [], b = Array.isArray(next) ? next : [];
      if (!listRule.$mutable && (a.length !== b.length || a.some((e, i) => listRule.$id && object(e)[listRule.$id] !== object(b[i])[listRule.$id]))) {
        throw Error(`Die Objektliste ist schreibgeschützt: ${path}`);
      }
      b.forEach((entry, index) => {
        const exact = listRule.$id ? a.find(e => object(e)[listRule.$id!] === object(entry)[listRule.$id!]) : a[index];
        if (!listRule.$mutable) return check(exact, entry, listRule.$items, `${path}/${index}`);
        // New copies may retain extension fields from any source object; invented extension fields may not be written.
        const candidates = exact !== undefined && listRule.$id ? [exact] : exact !== undefined ? [exact, ...a, undefined] : [...a, undefined];
        let failure: unknown;
        for (const candidate of candidates) {
          try { check(candidate, entry, listRule.$items, `${path}/${index}`); return; } catch (error) { failure = error; }
        }
        throw failure;
      });
      return;
    }
    const a = object(old), b = object(next);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) check(a[key], b[key], rule[key], `${path}/${key}`);
  };
  check(before, after, policy, '');
  // Existing mission objects may move, but may not be newly authored through spatial subfields.
  for (const key of ['missionProgress', 'persistentBase'] as const) {
    if (before[key] === undefined && after[key] !== undefined) throw Error(`Keine Neuanlage von ${key} in V1`);
  }
}
