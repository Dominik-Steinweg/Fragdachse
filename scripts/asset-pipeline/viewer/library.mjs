/** Pure selection and playback rules, shared by the viewer and asset tests. */
export const categoryLabels = { character: 'Spielfiguren', enemy: 'Gegner', turret: 'Türme', weapon: 'Waffen', utility: 'Utilities' };
/** A loadout icon without a reference grip cannot be composed into the player's hands. */
export function supportsHeldView(asset, original = false) {
  return Boolean(asset.heldItem && (!original || asset.heldItem.referenceGrip));
}
export function models(library, category = '', query = '') {
  const found = new Map();
  for (const construction of library.constructions) for (const asset of construction.assets) {
    if (!found.has(asset.id)) found.set(asset.id, asset);
  }
  const needle = query.trim().toLocaleLowerCase('de');
  return [...found.values()].filter(asset => (!category || asset.category === category)
    && `${asset.label} ${asset.id}`.toLocaleLowerCase('de').includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}
export function constructionsFor(library, id) {
  return library.constructions.filter(construction => construction.assets.some(asset => asset.id === id));
}
export function resolveSource(library, choice) {
  const available = constructionsFor(library, choice.id);
  const construction = available.find(c => c.key === choice.construction) ?? available[0];
  const asset = construction?.assets.find(a => a.id === choice.id);
  if (!asset?.variants.length) return null;
  const variant = asset.variants.find(v => v.variant === choice.variant)
    ?? asset.variants.find(v => v.variant === asset.preferred?.variant) ?? asset.variants[0];
  const source = variant.sources.find(s => s.size === choice.size)
    ?? variant.sources.find(s => s.size === asset.preferred?.size)
    ?? [...variant.sources].sort((a, b) => b.size - a.size)[0];
  if (!source) return null;
  return { construction, asset, variant, source, key: `${construction.key}/${asset.id}/${variant.variant}/${source.size}` };
}
export function sampleFrame(resolved, clipName, elapsed, idle, referenceClip) {
  const clip = resolved.variant.clips?.find(c => c.name === clipName);
  if (idle || !clip || !referenceClip) return resolved.variant.idleFrame ?? 0;
  // Equal normalized phases across constructions with different sample counts.
  const duration = referenceClip.frames.length / referenceClip.frameRate;
  const phase = Math.min(.999999, elapsed / duration);
  return clip.frames[Math.min(clip.frames.length - 1, Math.floor(phase * clip.frames.length))];
}
