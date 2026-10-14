import type { FireControlConstructionFacts } from './FireControlCopyPlan';
import { classifyFireControlSource } from './FireControlEligibility';
import { orderFireControlTypes } from './FireControlSourceSelection';

export type HoloTemplate = FireControlConstructionFacts & { readonly constructionId: string };

interface Pool { ids: number[]; cursor: number }

/** Preserve the next surviving member, including when the member at the cursor disappears. */
function survivingCursor<T>(previous: readonly T[], cursor: number, current: readonly T[]): number {
  for (let offset = 0; offset < previous.length; offset++) {
    const index = current.indexOf(previous[(cursor + offset) % previous.length]);
    if (index >= 0) return index;
  }
  return 0;
}

/** Deployment-local rotation; movement never reorders originals already admitted to a pool. */
export class HoloTemplateSelection {
  private readonly pools = new Map<string, Pool>();
  private types: string[] = [];
  private typeCursor = 0;

  /** A selection consumes one turn, even if placement subsequently fails. */
  next(ownerId: string, owner: { x: number; y: number }, constructions: readonly FireControlConstructionFacts[],
    slotOrder: readonly string[]): HoloTemplate | null {
    const eligible = new Map<number, HoloTemplate>();
    for (const source of constructions) {
      // Construction facts contain originals only; manning and relay pauses are deliberately ignored.
      if (!eligible.has(source.id) && classifyFireControlSource({ ...source, requesterId: ownerId,
        isCopy: false, pausedByCopies: false }).copyable) {
        eligible.set(source.id, { ...source, constructionId: source.constructionId! });
      }
    }
    const byType = new Map<string, HoloTemplate[]>();
    for (const source of eligible.values()) {
      const group = byType.get(source.constructionId) ?? [];
      group.push(source);
      byType.set(source.constructionId, group);
    }
    for (const type of this.pools.keys()) if (!byType.has(type)) this.pools.delete(type);
    for (const [type, sources] of byType) {
      const pool = this.pools.get(type) ?? { ids: [], cursor: 0 };
      const present = new Set(sources.map(source => source.id));
      const retained = pool.ids.filter(id => present.has(id));
      const known = new Set(pool.ids);
      const distance = (source: HoloTemplate) => (source.x - owner.x) ** 2 + (source.y - owner.y) ** 2;
      const added = sources.filter(source => !known.has(source.id))
        .sort((a, b) => distance(a) - distance(b) || a.id - b.id);
      const ids = [...retained, ...added.map(source => source.id)];
      this.pools.set(type, { ids, cursor: survivingCursor(pool.ids, pool.cursor, ids) });
    }
    const types = orderFireControlTypes(slotOrder, byType.keys()).filter(type => byType.has(type));
    this.typeCursor = survivingCursor(this.types, this.typeCursor, types);
    this.types = types;
    if (!types.length) return null;
    const pool = this.pools.get(types[this.typeCursor])!;
    this.typeCursor = (this.typeCursor + 1) % types.length;
    const selected = eligible.get(pool.ids[pool.cursor])!;
    pool.cursor = (pool.cursor + 1) % pool.ids.length;
    return selected;
  }
}
