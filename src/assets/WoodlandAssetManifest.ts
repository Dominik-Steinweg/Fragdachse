import mineral from '../../public/assets/environment/woodland/rock/mineral.json';
import colonies from '../../public/assets/environment/woodland/ecology/rock-colonies.json';
import litter from '../../public/assets/environment/woodland/ecology/ground-litter.json';
import lilies from '../../public/assets/environment/woodland/ecology/lilies.json';
import transmission from '../../public/assets/environment/woodland/sun/transmission.json';
import { CANOPY_ATLASES, CANOPY_FRAMES } from '../arena/trees/CanopyAssets';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
import runtimeColours from '../../public/assets/runtime-colours.json';

export const WOODLAND_ROCK_COLOUR_KEY = 'woodland-rock-colour';
export const WOODLAND_ROCK_HEIGHT_KEY = 'woodland-rock-height';
/** CPU alpha cache, never a GPU texture or a world-owned transfer buffer. */
export const WOODLAND_ROCK_COVERAGE_KEY = 'woodland-rock-coverage';
export const WOODLAND_TRANSMISSION_KEY = 'woodland-sun-transmission';
export interface WoodlandAsset {
  key: string; url: string; width: number; height: number; downloadBytes: number;
  sha256?: string;
  kind: 'image' | 'atlas' | 'sheet' | 'data' | 'coverage';
  frames?: object; scale?: number; linear?: boolean;
}
const root = './assets/environment/woodland/';
const woodlandRockScale = (maxTextureSize: number): 1 | 2 => maxTextureSize >= 4352 ? 2 : 1;
/** One immutable boot contract, with exactly one colour resolution per device. */
export function woodlandAssetFiles(maxTextureSize: number): WoodlandAsset[] {
  const scale = woodlandRockScale(maxTextureSize), colour = mineral.assets[scale - 1], height = mineral.assets[2];
  const files: WoodlandAsset[] = [
    {...colour,key:WOODLAND_ROCK_COLOUR_KEY,url:root+'rock/'+colour.file,kind:'sheet',scale},
    {...height,key:WOODLAND_ROCK_HEIGHT_KEY,url:root+'rock/'+height.file,kind:'image'},
    {...mineral.coverage,key:WOODLAND_ROCK_COVERAGE_KEY,url:root+'rock/'+mineral.coverage.file,kind:'coverage'},
    ...CANOPY_ATLASES.map((a,i):WoodlandAsset=>({...a,url:root+'canopy/'+a.file,kind:i===0?'atlas':'data',frames:CANOPY_FRAMES,linear:true})),
    ...[[colonies.atlas,'woodland-rock-colonies'],[colonies.contactAtlas,'woodland-rock-contact'],
      [litter.atlas,'woodland-ground-litter'],[lilies.atlas,'woodland-lilies']].map(([a,key]):WoodlandAsset=> {
        const atlas=a as typeof colonies.atlas;
        return {...atlas,key:key as string,url:root+'ecology/'+atlas.file,kind:'atlas'};
      }),
    {key:WOODLAND_TRANSMISSION_KEY,url:root+'sun/transmission.png',width:512,height:512,downloadBytes:transmission.downloadBytes,sha256:transmission.sha256,kind:'image',linear:true},
  ];
  const published: Record<string, { downloadBytes: number; file: string; sha256: string }> = runtimeColours.assets;
  return files.map(asset => {
    const runtime = published[asset.url.replace(/^\.\//, '')];
    return { ...asset, ...(runtime ? { file: runtime.file.slice(runtime.file.lastIndexOf('/') + 1),
      sha256: runtime.sha256, downloadBytes: runtime.downloadBytes } : {}), url: runtimeAssetUrl(asset.url) };
  });
}
export function woodlandAssetBytes(maxTextureSize: number) {
  const files=woodlandAssetFiles(maxTextureSize);
  return {download:files.reduce((n,a)=>n+a.downloadBytes,0),
    residentRGBA:files.reduce((n,a)=>n+(a.kind==='coverage'?0:a.width*a.height*4),0),
    coverageCPU:mineral.coverage.width*mineral.coverage.height};
}
