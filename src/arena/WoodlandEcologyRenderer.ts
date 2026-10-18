import {getVisibleWorldView,createVisibleWorldView} from '../graphics/CameraWorldView';
import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';
import type { SunTuning } from '../effects/sunlight/SunTuning';
import type { WaterSurfaceRenderer } from './WaterSurfaceRenderer';
import { WOODLAND_ATLASES, type EcologyPlacement } from './WoodlandEcologyField';
import { VOID_LILY_ATLAS } from './VoidFloraAssets';
import { floatingMotion } from './FloatingBob';

type EcologyKind=EcologyPlacement['kind'];
interface EcologyPage {
  readonly kind:EcologyKind;
  readonly layer:Phaser.GameObjects.SpriteGPULayer;
  readonly placements:readonly EcologyPlacement[];
  readonly floating:boolean;
  readonly left:number;readonly top:number;readonly right:number;readonly bottom:number;
  threshold:number;members:number;
  /** Void art page: members draw their `voidFrame`. */
  readonly overlay:boolean;
}

/** World pages, large enough for few layers and small enough to cull most of a large map. */
const PAGE_PX=2048;
/** Water time wraps here before it reaches float precision limits inside the shader. */
const TIME_WRAP_MS=3_600_000;
const SHORE_TINT=0xc5c6b8;
/** Void lilies stay in the value range of the natural pads: sunlight must not push plum into pink. */
const VOID_LILY_SHADE=0xa496a8;



/** World-owned atlas quads in static GPU layers: placement, thinning, culling and the floating
 * bob cost no per-sprite CPU work per frame. Same texture/depth per family keeps the former
 * batching; automatic scene registration restricts the layers to the World camera. */
export class WoodlandEcologyRenderer {
  private readonly cameraView=createVisibleWorldView();
  private readonly pages:EcologyPage[]=[];
  private readonly placementCount:number;
  constructor(private readonly scene:Phaser.Scene, placements:readonly EcologyPlacement[]) {
    this.placementCount=placements.length;
    const groups=new Map<string,EcologyPlacement[]>();
    const add=(key:string,p:EcologyPlacement):void=>{let group=groups.get(key);if(!group)groups.set(key,group=[]);group.push(p);};
    for(const p of placements) {
      const page=`${Math.floor(p.x/PAGE_PX)}:${Math.floor(p.y/PAGE_PX)}`;
      // Void art replaces the natural plant on its own atlas page (same size, rotation and bob).
      add(p.kind==='pond'&&p.voidFrame?`${p.kind}:void:${page}`:`${p.kind}::${page}`,p);
    }
    for(const [groupKey,group] of groups) {
      const kind=group[0].kind,natural=WOODLAND_ATLASES[kind==='litter'?0:kind==='pond'?1:2].key;
      const overlay=groupKey.includes(':void:');
      const atlas=overlay?VOID_LILY_ATLAS.key:natural;
      const layer=scene.add.spriteGPULayer(scene.textures.get(atlas),group.length)
        // Embedded shore material shares the ground macro shade; ground cover can
        // overgrow its dry edge and water still covers the submerged stone faces.
        .setDepth(kind==='litter'?DEPTH.GROUND_MACRO+.05:kind==='shore'?DEPTH.DIRT+.03:DEPTH.WATER+(overlay?.051:.05))
        .setVisible(false);
      configureGpuLayerCameraTransform(layer);
      // The bob follows the water's presentation clock, which may freeze; never Phaser's own.
      layer.setTimerPaused(true);
      registerGraphicsObject(scene,'woodlandEcology',layer);
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const p of group) {
        left=Math.min(left,p.x-p.size);top=Math.min(top,p.y-p.size);
        right=Math.max(right,p.x+p.size);bottom=Math.max(bottom,p.y+p.size);
      }
      this.pages.push({kind,layer,placements:group,floating:group.some(p=>p.floating),left,top,right,bottom,threshold:NaN,members:0,overlay});
    }
  }
  update(tuning:SunTuning, water:WaterSurfaceRenderer|null, litter:boolean, pond:boolean,density=1):void {
    const view=getVisibleWorldView(this.scene.cameras.main,this.cameraView),time=water?.getPresentationTime()??0;
    const timeMs=((time*1000)%TIME_WRAP_MS+TIME_WRAP_MS)%TIME_WRAP_MS;
    for(const page of this.pages) {
      const enabled=page.kind==='shore'||(page.kind==='litter'?litter:pond);
      const amount=page.kind==='shore'?1:page.kind==='litter'?tuning.litterDensity:tuning.pondFloraDensity;
      const threshold=enabled?amount*density:-Infinity;
      if(threshold!==page.threshold)this.rebuild(page,threshold);
      const visible=page.members>0
        &&page.right>view.x&&page.bottom>view.y&&page.left<view.right&&page.top<view.bottom;
      page.layer.setVisible(visible);
      if(visible&&page.floating)page.layer.resetTimer(timeMs);
    }
  }
  /** Thinning changes only with tuning or quality: rewrite the page's members in rank order. */
  private rebuild(page:EcologyPage,threshold:number):void {
    page.threshold=threshold;
    const layer=page.layer,frames=layer.texture;
    layer.memberCount=0;
    for(const p of page.placements) {
      if(!(p.rank<threshold))continue;
      const name=page.overlay?p.voidFrame!:p.frame;
      const frame=frames.get(name),scaleX=p.size/frame.realWidth,scaleY=p.size/frame.realHeight;
      layer.addMember({frame:name,scaleX,scaleY,alpha:p.alpha,creationTime:0,
        ...(p.floating?floatingMotion(p):{x:p.x,y:p.y,rotation:p.rotation}),
        ...(page.kind==='shore'?{tintBlend:1,tintTopLeft:SHORE_TINT,tintTopRight:SHORE_TINT,
          tintBottomLeft:SHORE_TINT,tintBottomRight:SHORE_TINT}:{}),
        ...(page.overlay?{tintBlend:1,tintTopLeft:VOID_LILY_SHADE,tintTopRight:VOID_LILY_SHADE,
          tintBottomLeft:VOID_LILY_SHADE,tintBottomRight:VOID_LILY_SHADE}:{})});
    }
    page.members=layer.memberCount;
  }
  get count():number {return this.placementCount;}
  destroy():void {for(const page of this.pages)page.layer.destroy();this.pages.length=0;}
}
