import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Legacy uncertainty is explicit; never invent the settings of an old Blender run. */
export async function exportProvenance(manifest) {
  const tools={};
  for(const name of ['export.mjs','export-v2.mjs','export-provenance.mjs'])
    tools[name]=createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex');
  return {schema:'fd-export-provenance',version:1,
    render:manifest.provenance??{versions:{blender:manifest.blenderVersion??null},
      seeds:{cycles:null,policy:'not recorded by legacy renderer; retained source is authoritative'},sources:manifest.sources},
    versions:{node:process.version,sharp:sharp.versions.sharp,vips:sharp.versions.vips},sources:tools};
}
