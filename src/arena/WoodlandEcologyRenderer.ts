import {getVisibleWorldView,createVisibleWorldView} from '../graphics/CameraWorldView';
import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import type { SunTuning } from '../effects/sunlight/SunTuning';
import type { WaterSurfaceRenderer } from './WaterSurfaceRenderer';
import { WOODLAND_ATLASES, type EcologyPlacement } from './WoodlandEcologyField';

/** World-owned atlas sprites. Same texture/depth per family lets Phaser batch them;
 * automatic scene registration restricts them to the World camera. */
export class WoodlandEcologyRenderer {
  private readonly cameraView=createVisibleWorldView();
  private readonly entries:{p:EcologyPlacement;image:Phaser.GameObjects.Image}[];
  constructor(private readonly scene:Phaser.Scene, placements:readonly EcologyPlacement[]) {
    this.entries=placements.map(p=>{
      const image=scene.add.image(p.x,p.y,WOODLAND_ATLASES[p.kind==='litter'?0:1].key,p.frame)
        .setDisplaySize(p.size,p.size).setRotation(p.rotation).setAlpha(p.alpha)
        .setDepth(p.kind==='litter'?DEPTH.GROUND_MACRO+.05:DEPTH.WATER+.05);
      registerGraphicsObject(scene,'woodlandEcology',image);
      return {p,image};
    });
  }
  update(tuning:SunTuning, water:WaterSurfaceRenderer|null, litter:boolean, pond:boolean,density=1):void {
    const view=getVisibleWorldView(this.scene.cameras.main,this.cameraView),time=water?.getPresentationTime()??0;
    for(const entry of this.entries) {
      const p=entry.p, image=entry.image,isLitter=p.kind==='litter';
      const visible=(isLitter?litter:pond)&&p.rank<(isLitter?tuning.litterDensity:tuning.pondFloraDensity)*density
        &&p.x+p.size>view.x&&p.y+p.size>view.y&&p.x-p.size<view.right&&p.y-p.size<view.bottom;
      image.setVisible(visible);
      if(visible&&p.floating) {
        const phase=p.x*.005+p.y*.007;
        image.setPosition(p.x+Math.sin(time*.21+phase)*.7,p.y+Math.cos(time*.17+phase)*.5);
        image.setRotation(p.rotation+Math.sin(time*.18+phase)*.025);
      }
    }
  }
  get count():number {return this.entries.length;}
  destroy():void {for(const entry of this.entries)entry.image.destroy();this.entries.length=0;}
}
