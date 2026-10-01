import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { packEcologyAtlas } from './lib/ecology-atlas.mjs';
import { ROCK_ECOLOGY_RECIPE, exportRockEcology, exportRockContact } from './lib/rock-ecology-v8-export.mjs';
const source = 'tools/source-art/rock-ecology-v8', output = 'public/assets/environment/woodland/ecology';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [], contacts = [], images = new Map();
await mkdir(output, { recursive: true });
for (const recipe of ROCK_ECOLOGY_RECIPE.filter(r => r.surfaceFinish)) {
  const input = await readFile(`${source}/${recipe.name}.png`), metadata = await sharp(input).metadata();
  if (!metadata.hasAlpha) throw new Error('Authored alpha is required');
  const bytes = await exportRockEcology(input, recipe), file = `rock-ecology-v8-${recipe.name}.png`;
  images.set(file, bytes);
  if(recipe.surfaceFinish){
    const contact=await exportRockContact(bytes),file=`rock-ecology-v8-contact-${recipe.name}.png`;
    images.set(file, contact.bytes);
    contacts.push({name:recipe.name,file,width:contact.width,height:contact.height,
      scaleX:contact.scaleX,scaleY:contact.scaleY,sha256:hash(contact.bytes),rgbaBytes:contact.width*contact.height*4});
  }
  assets.push({ ...recipe, file, source: `${recipe.name}.png`, sourceSha256: hash(input), sha256: hash(bytes),
    sourceWidth: metadata.width, sourceHeight: metadata.height, rgbaBytes: recipe.width*recipe.height*4 });
}
const atlas = await packEcologyAtlas(output, 'rock-colonies', assets, 256, a => images.get(a.file));
const contactAtlas=await packEcologyAtlas(output,'rock-contact',contacts,128,a => images.get(a.file));
for(const a of [...assets,...contacts]) { a.pixelSha256=hash(await sharp(images.get(a.file)).ensureAlpha().raw().toBuffer()); delete a.file; delete a.sha256; }
await writeFile(`${output}/rock-colonies.json`, JSON.stringify({ version: 8, source, atlas,
  contactAtlas, contacts, contactRecipe:'96px colour alpha + 16px guard, dilate 3px, blur sigma 3px; dark neutral green; runtime opacity',
  recipe: 'scripts/export-rock-ecology-v8.mjs', alphaCleanup: 'legacy moss/creeper: smoothstep(64,208,alpha); preserveAlpha variants: authored alpha; all: transparent 4px margin',
  orientation: 'orthographic overhead; diffuse albedo; runtime formation lighting', assets }, null, 2)+'\n');
console.log(`Exported ${assets.length} ecology assets, ${assets.reduce((n,a)=>n+a.rgbaBytes,0)} RGBA bytes.`);
