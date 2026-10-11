import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({targets:[] as any[],shaders:[] as any[],gpus:[] as any[],quality:'high',ready:true}));
vi.mock('phaser',()=>({BlendModes:{MULTIPLY:3},GameObjects:{Shader:class{
  renderNode:any={};visible=false;destroy=vi.fn();constructor(...args:any[]){this.config=args[1];state.shaders.push(this);}config:any;
  setDepth(){return this;}setVisible(v:boolean){this.visible=v;return this;}setPosition(){return this;}setSize(){return this;}
}}}));
vi.mock('../src/graphics/GraphicsQuality',()=>({getGraphicsQualityProfile:()=>({level:state.quality})}));
vi.mock('../src/effects/sunlight/SunRenderTarget',()=>({ownSunShader(){},sunShaderName:(s:string)=>s,
 SunRenderTarget:class{
  shader:any;destroy=vi.fn();draws=0;
  constructor(){this.shader={drawingContext:{setAutoClear(){},setClearColor(){}},renderNode:{run(){}},
    glTexture:{webGLTexture:{}},texture:{get:()=>({source:{glTexture:{}}})}};state.targets.push(this);}
  draw(){this.draws++;this.shader.renderNode.run(this.shader.drawingContext);}
 }}));
vi.mock('../src/effects/EnemyMeshGpu',()=>({EnemyMeshGpu:class{
 bytes=100;destroy=vi.fn();draw=vi.fn(()=>state.ready);constructor(){state.gpus.push(this);}
}}));
import { KrakenShadowRenderer } from '../src/effects/kraken/KrakenShadowRenderer';
import type { KrakenShadowMesh } from '../src/effects/kraken/KrakenLightShadowModel';
beforeEach(()=>{state.targets=[];state.shaders=[];state.gpus=[];state.quality='high';state.ready=true;});
function fixture(){
 const receiver={revision:1,sample:()=>1,destroy:vi.fn(),world:[0,0,2000,1000],texture:{get:()=>({source:{glTexture:{}}})}};
 const clouds={sunPath:{sun:[1,0,1],strength:1,elevation:Math.PI/4}},release=vi.fn();let handoff=()=>{};
 const shadows={borrowFigureEnvironment:(callback:()=>void)=>{handoff=callback;return {receiver,clouds,release};}};
 const scene:any={sys:{renderer:{config:{stencil:true},shaderProgramFactory:{programs:{}},deleteProgram(){}}},add:{existing(){}},
   cameras:{main:{width:1000,height:1000,originX:0,originY:0,scrollX:0,scrollY:0,zoom:1}}};
 const renderer=new KrakenShadowRenderer(scene,shadows as any),sprite:any={x:200,y:200,displayWidth:448,displayHeight:448,originX:.5,originY:.5,
  rotation:0,flipX:false,flipY:false,visible:true,active:true,alpha:1};
 const mesh:KrakenShadowMesh={id:'pose',positions:new Float32Array(9),indices:new Uint16Array([0,1,2]),bounds:{min:[-50,-50,0],max:[50,50,258]}};
 return {renderer,receiver,clouds,release,handoff:()=>handoff(),sprite,mesh,update:(role:'water'|'land'|'tentacle'|'egg'='land')=>renderer.update(sprite,mesh,448,40,.38,role)};
}
it('retries shader compilation, caches still poses and invalidates on receiver change',()=>{
 const f=fixture();state.ready=false;f.update();expect(state.targets[0].draws).toBe(1);
 state.ready=true;f.update();expect(state.targets[0].draws).toBe(2);f.update();expect(state.targets[0].draws).toBe(2);
 f.receiver.revision++;f.update();expect(state.targets[0].draws).toBe(3);
 f.clouds.sunPath.sun[0]=-1;f.update();expect(state.targets[0].draws).toBe(4);
 expect(state.gpus[0].draw).toHaveBeenCalledTimes(8);f.renderer.destroy();
});
it('culls projected bounds and releases every own resource before rebinding after World handoff',()=>{
 const f=fixture();f.sprite.x=1200;f.update();expect(f.renderer.inspect().visible).toBe(true);
 f.sprite.x=2000;f.update();expect(f.renderer.inspect().visible).toBe(false);f.handoff();
 for(const t of state.targets)expect(t.destroy).toHaveBeenCalledTimes(1);expect(state.gpus[0].destroy).toHaveBeenCalledTimes(1);
 expect(f.release).toHaveBeenCalledTimes(1);expect(f.receiver.destroy).not.toHaveBeenCalled();expect(f.renderer.gpuBytes).toBe(0);
 f.sprite.x=200;f.update();expect(f.renderer.inspect().visible).toBe(true);f.renderer.destroy();f.renderer.destroy();
 expect(f.release).toHaveBeenCalledTimes(2);for(const t of state.targets)expect(t.destroy).toHaveBeenCalledTimes(1);
});
it('Low and egg contact allocate no mesh and hide entirely submerged casters',()=>{
 const f=fixture();state.quality='low';f.update();expect(state.gpus).toHaveLength(0);expect(f.renderer.inspect().analytic).toBe(true);
 expect(f.renderer.gpuBytes).toBe(135);f.receiver.sample=()=>.45;
 (f.mesh.bounds.max as number[])[2]=-1;f.update('water');expect(f.renderer.inspect().visible).toBe(false);
 (f.mesh.bounds.max as number[])[2]=20;state.quality='high';f.update('egg');expect(state.gpus).toHaveLength(0);
 expect(f.renderer.inspect().visible).toBe(true);f.renderer.destroy();
});
