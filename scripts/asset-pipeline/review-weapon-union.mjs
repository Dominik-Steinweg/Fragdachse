import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {safeFile,hash} from './mesh-shadow-contract.mjs';

/** Source vs quantized union evidence, independent of the body hiding weapon errors. */
export async function reviewWeaponUnions(root,destination,manifest){
  const files=[],summary=[];
  for(const mesh of manifest.meshes.filter(m=>m.budget)){
    const qa=mesh.audit.qualityReport,bytes=await readFile(path.join(root,safeFile(qa.file)));
    if(hash(bytes)!==qa.sha256)throw Error('Changed weapon QA');
    const q=JSON.parse(bytes),l=q.layout,labels=q.rows.map((r,i)=>`<text x="${i%l.columns*l.cellWidth+3}" y="${Math.floor(i/l.columns)*l.cellHeight+15}" font-family="Arial" font-size="10" fill="white">L${r.azimuth}/${r.elevation} IoU ${(r.iou*100).toFixed(1)}%</text>`).join('');
    const input=await readFile(path.join(root,safeFile(q.image.file)));
    if(hash(input)!==q.image.sha256)throw Error('Changed weapon QA image');
    const labelled=await sharp(input).composite([{input:Buffer.from(`<svg width="${l.width}" height="${l.height}">${labels}</svg>`),left:0,top:0}]).png().toBuffer();
    const file=`weapon-source-proxy-${mesh.id}.png`,width=Math.max(280,l.width);
    await sharp({create:{width,height:l.height+40,channels:3,background:'#222'}}).composite([
      {input:Buffer.from(`<svg width="${width}" height="40"><text x="4" y="15" font-size="12" fill="white">${mesh.id}</text><text x="4" y="32" font-size="10" fill="white">grey overlap / red source only / cyan proxy only</text></svg>`),left:0,top:0},
      {input:labelled,left:0,top:40}]).png().toFile(path.join(destination,file));files.push(file);
    summary.push({id:mesh.id,vertices:mesh.vertexCount,triangles:mesh.triangleCount,budget:mesh.budget,minimumIou:q.minimumIou,attempts:q.attempts});
  }
  if(summary.length){const file='weapon-union-summary.json';await writeFile(path.join(destination,file),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});files.push(file);}
  return files;
}
