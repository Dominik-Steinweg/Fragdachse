// Technical production options follow repository classification, never an author label.
export const isMusic = entry => entry.repository?.kind === 'music';
export const durationLimit = entry => isMusic(entry) ? 380 : 47;
export const cutLimit = entry => isMusic(entry) ? 380000 : 24000;
export const allowedModels = (entry, models) => models.filter(model => !isMusic(entry) || model.name === 'medium');
export const allowedProfiles = (entry, profiles) => Object.keys(profiles).filter(profile => isMusic(entry) ? profile === 'music_loop' : profile !== 'music_loop');
export function matchesCategory(entry, category) {
  if (!category) return true;
  if (category === 'kind:music') return isMusic(entry);
  if (category === 'kind:sfx') return !isMusic(entry);
  return !isMusic(entry) && category === `category:${entry.category}`;
}
