import type * as Phaser from 'phaser';
import type { RockVegetationPlacement } from '../RockVegetationField';
import { ROCK_CONTACT_ASSETS, ROCK_CONTACT_ATLAS } from './RockEcologyAssets';
export const ROCK_COLONY_CONTACT_REACH=32;

/** Colour remains opaque; palette blending never exposes the rock through leaves. */
export function rockColonyTint(blend:number):number {
  const b=Math.max(0,Math.min(1,blend));
  return (Math.round(255-15*b)<<16)|(255<<8)|Math.round(255-7*b);
}
export function rockColonyContactAlpha(amount:number,cavity:number):number {
  return Math.max(0,Math.min(.5,amount*(1+Math.max(0,Math.min(1,cavity))*.6)));
}
/** Authored alpha dilation + blur, baked once with exactly the colony transform.
 * The subsequent mineral silhouette clips contact and colony together. */
export function stampRockColonyContact(scene:Phaser.Scene,target:Phaser.GameObjects.RenderTexture,
  colonies:readonly RockVegetationPlacement[],x:number,y:number,amount:number,height?: (x:number,y:number)=>number):void {
  if(amount<=0)return;
  for(const p of colonies){
    const a=ROCK_CONTACT_ASSETS.get(String(p.frame));if(!a||!scene.textures.getFrame(ROCK_CONTACT_ATLAS.key,p.frame))continue;
    const h=height?.(p.worldX,p.worldY)??0;
    const bowl=height?Math.max(0,((height(p.worldX-8,p.worldY)+height(p.worldX+8,p.worldY)
      +height(p.worldX,p.worldY-8)+height(p.worldX,p.worldY+8))*.25-h)/8):0;
    target.stamp(ROCK_CONTACT_ATLAS.key,p.frame,p.worldX+x,p.worldY+y,{
      alpha:rockColonyContactAlpha(amount,bowl),rotation:p.rotation,
      scaleX:p.lengthPx*a.scaleX/a.width*(p.mirrorX?-1:1),scaleY:p.bandPx*a.scaleY/a.height,
    });
  }
}
