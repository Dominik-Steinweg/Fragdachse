import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
/** Resolve the exact imported idle+sheet hashes; never silently pick the newest authoring run. */
export async function selectedHeldSources(repo) {
  const registry=JSON.parse(await readFile(path.join(repo,'src/config/pipelineAssets.json')));
  const catalog=JSON.parse(await readFile(path.join(repo,'scripts/asset-pipeline/catalog-v2.json')));
  const expected=catalog.assets.filter(a=>['held-weapon','held-utility'].includes(a.recipe));
  const held=registry.assets.filter(a=>a.id.startsWith('held-'));
  if(expected.length!==held.length||expected.some(a=>!held.some(h=>h.id===a.id)))throw Error('Catalog/registry held coverage mismatch');
  const runs=path.join(repo,'art/poc/pipeline-v2/runs'),revisions=(await readdir(runs,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort();
  const result=[];
  for(const asset of held){const entry=expected.find(a=>a.id===asset.id);
    if(JSON.stringify(entry.gameIds)!==JSON.stringify(asset.gameIds))throw Error('Held game ID disagreement: '+asset.id);
    const candidates=[];
    for(const rev of revisions){const folder=path.join(runs,rev,asset.id);let s;
      try{s=JSON.parse(await readFile(path.join(folder,'selection.json')));}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(s.id===asset.id&&s.variant===asset.variant&&s.files[s.idle]===asset.hashes.idle&&s.files[s.sheet]===asset.hashes.sheet)candidates.push({folder,selection:s});
    }
    if(!candidates.length)throw Error('Missing source selection for imported held asset '+asset.id);
    const sourceHashes=new Set(candidates.map(c=>c.selection.files[`${c.selection.variant}/asset.blend`]));
    if(sourceHashes.size!==1)throw Error('Ambiguous held geometry behind same sprites: '+asset.id);
    result.push({id:asset.id,gameIds:asset.gameIds,folder:candidates[0].folder,recipe:entry.recipe,heldItem:asset.heldItem});
  }
  return result;
}
