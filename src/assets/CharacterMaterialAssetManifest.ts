import manifest from './manifests/character-material-badger-player-material-r2-005.json';

export { manifest as CHARACTER_MATERIAL_MANIFEST };

/** Material pages only: the retired D shadow masks never enter the loader. */
export const CHARACTER_MATERIAL_PAGES = manifest.pages.flatMap((page, index) =>
  page.pass === 'albedo' || page.pass === 'normal'
    ? [{ ...page, key: `character-material:${manifest.revision}:${index}` }] : []);
const samples = manifest.samples;
function selection(size: number, pose: number) {
  const find = (pass: string) => {
    const sample = samples.find(s => s.pass === pass && s.sourceSize === size && s.pose === pose);
    if (!sample) throw new Error(`Missing character material ${pass}/${size}/${pose}`);
    const page = manifest.pages[sample.page], [x, y, w, h] = sample.rect;
    return { key: `character-material:${manifest.revision}:${sample.page}`,
      uv: [x / page.width, y / page.height, w / page.width, h / page.height] };
  };
  return { pose, albedo: find('albedo'), normal: find('normal') };
}
const materials = [64, 128].map(size => manifest.poses.map(pose => selection(size, pose.index)));
export function characterMaterialFrame(frame: string | number, high: boolean) {
  const pose = Number(frame);
  return materials[high ? 1 : 0][Number.isInteger(pose) && pose >= 0 && pose < manifest.poses.length ? pose : 0];
}
