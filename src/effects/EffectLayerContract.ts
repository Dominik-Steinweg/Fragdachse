/** Diagnostic sidecar only. Renderers must never derive depth/blend/light from this catalog.
 * Intended height describes the motif, not its current display-list order.
 */
export type EffectHeight = 'ground' | 'body' | 'high';
export type EffectLighting = 'material' | 'emissive' | 'mixed';
export type LayerProfile = 'G' | 'M' | 'K' | 'L' | 'E' | 'H' | 'C';
export type LayerBlend = 'NORMAL' | 'ADD' | 'MULTIPLY' | 'SCREEN';
export interface LayerIntent { readonly height: EffectHeight; readonly lighting: EffectLighting }
export interface LayerContract extends LayerIntent {
  readonly id: string;
  readonly owner: string;
  readonly component: string;
  readonly camera: 'world' | 'clarity';
  /** SharedGlow's two camera modes use different depths in the same factory. */
  readonly clarityDepths?: readonly number[];
  /** Multiple values mean authored variants / explicit input-domain samples, not random tuning. */
  readonly depths: readonly number[];
  readonly blends: readonly LayerBlend[];
  readonly profiles: readonly LayerProfile[];
  readonly role: 'effect' | 'ui' | 'surface' | 'pass' | 'delegate';
  readonly source?: { readonly expression: string; readonly selector: string };
}

/** Equal depths deliberately have BOTH possible profiles: insertion order is not a contract. */
export function layerProfiles(depth: number, camera: LayerContract['camera'] = 'world'): LayerProfile[] {
  if (!Number.isFinite(depth)) throw new Error('Non-finite layer depth');
  if (camera === 'clarity') return ['C'];
  if (depth === 14.5) return ['K', 'L'];
  if (depth === 20) return ['E', 'H'];
  if (depth < 5.3) return ['G'];
  if (depth < 9.14) return ['M'];
  if (depth < 14.5) return ['K'];
  if (depth < 19.5) return ['L'];
  // The lightmap / bleed are passes, not receivers. Reserve their exact depths.
  if (depth <= 19.501) return ['L', 'E'];
  if (depth < 20) return ['E'];
  return ['H'];
}

/** Stable IDs for the ordered findings in depth-analysis.md chapter 7. */
export const DEPTH_FINDINGS = {
  D01: 'Blood/death material above canopy and lighting',
  D02: 'Ordinary explosion body/smoke above canopy',
  D03: 'Ground/body motif in foreground band',
  D04: 'Blood stain shares enemy depth',
  D05: 'Stink ground component above actors',
  D06: 'Material / projectile family crosses sunlight boundary',
  D07: 'Equal depth at sun composite 14.5',
  D08: 'Equal depth at canopy 20',
  D09: 'Canopy readability only protects local player',
  D10: 'Emission response is owner-specific, not a uniform lighting contract',
  D11: 'World UI has inconsistent light/fog treatment',
  D12: 'Shadow receiver approximation',
  D13: 'High foreground needs explicit semantic justification',
  D14: 'Inline/material lighting requires separate verification',
} as const;
export type DepthFinding = keyof typeof DEPTH_FINDINGS;
export type LayerDeviation = 'ground-over-actors' | 'body-over-canopy' | 'material-outside-sun'
  | 'emission-under-lightmap' | 'sun-tie' | 'canopy-tie' | 'stain-over-actors';
export interface LayerException { readonly id: string; readonly deviation: LayerDeviation; readonly finding: DepthFinding }

/** Mechanical target checks; mixed motifs retain an explicit split decision for later rounds. */
export function layerDeviations(layer: LayerContract): LayerDeviation[] {
  if (layer.camera === 'clarity' || ['surface', 'pass', 'delegate'].includes(layer.role)) return [];
  const result = new Set<LayerDeviation>();
  for (const depth of layer.depths) {
    if (layer.clarityDepths?.includes(depth)) continue;
    if (depth === 14.5) result.add('sun-tie');
    if (depth === 20) result.add('canopy-tie');
    if (layer.role === 'ui') {
      if (depth < 19.501) result.add('emission-under-lightmap');
      continue;
    }
    if (layer.height === 'ground' && depth >= 9.95) result.add('ground-over-actors');
    if (layer.height === 'body' && depth >= 20) result.add('body-over-canopy');
    if (layer.lighting === 'material' && depth >= 14.5) result.add('material-outside-sun');
    if (layer.lighting === 'emissive' && depth < 19.501) result.add('emission-under-lightmap');
    if (/stain/i.test(layer.component) && depth >= 9.95) result.add('stain-over-actors');
  }
  return [...result].sort();
}

/** Both new violations AND obsolete exceptions fail. R1+ remove entries as they fix the motif. */
export function auditLayerContract(layers: readonly LayerContract[], exceptions: readonly LayerException[]): string[] {
  const expected = new Map(exceptions.map(e => [`${e.id}:${e.deviation}`, e]));
  const errors: string[] = [];
  if (expected.size !== exceptions.length) errors.push('Duplicate exception');
  if (new Set(layers.map(l => l.id)).size !== layers.length) errors.push('Duplicate layer ID');
  for (const layer of layers) for (const deviation of layerDeviations(layer)) {
    const key = `${layer.id}:${deviation}`;
    if (!expected.delete(key)) errors.push(`Unlisted: ${key}`);
  }
  for (const key of expected.keys()) errors.push(`Obsolete: ${key}`);
  return errors;
}
