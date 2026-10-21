import { REACTIVE_PROP_KINDS } from '../../../../src/config/reactiveProps/reactivePropKinds';

const KIND_LABELS: Readonly<Record<string, string>> = {
  explosive_barrel: 'Explosives Fass',
  spore_puffball: 'Riesenbovist',
  bee_hive: 'Strohkorb (Bienen)',
};
const VARIANT_LABELS: Readonly<Record<string, string>> = {
  rusted: 'Rostfass', toxic: 'Radioaktiv (giftgrün)', meadow: 'Wiese', void: 'Void (violett)', straw: 'Stroh',
};

/** Defaults for a new seeded scatter of one kind (strategic, at chokepoints). */
export const REACTIVE_PROP_SCATTER_DEFAULTS: Readonly<Record<string, { clusters: number; clusterSize: [number, number]; minSpacingCells: number }>> = {
  explosive_barrel: { clusters: 3, clusterSize: [2, 3], minSpacingCells: 12 },
  spore_puffball: { clusters: 3, clusterSize: [1, 2], minSpacingCells: 12 },
  bee_hive: { clusters: 2, clusterSize: [1, 1], minSpacingCells: 16 },
};

export const reactivePropKindIds = (): readonly string[] => [...REACTIVE_PROP_KINDS.keys()];
export const reactivePropKindLabel = (kind: unknown): string => KIND_LABELS[String(kind)] ?? String(kind);

export function reactivePropVariantOptions(kind: unknown): { value: string; label: string }[] {
  return [{ value: '', label: 'Standard der Kind-Registry' },
    ...(REACTIVE_PROP_KINDS.get(String(kind))?.visual.variantIds ?? []).map(value => ({ value, label: VARIANT_LABELS[value] ?? value }))];
}
