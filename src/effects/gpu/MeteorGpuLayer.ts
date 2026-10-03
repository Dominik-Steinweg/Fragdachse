import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { METEOR_FRAGMENT, METEOR_VERTEX } from './MeteorShader';
import { registerGraphicsObject } from '../EffectUtils';

/** Fixed bounded batch: three draws regardless of strike count. No per-meteor GameObjects. */
export const METEOR_BATCH_CAPACITY = 256;
const WORDS = 9, VERTICES = 6;
const CORNERS = [-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1];
export interface MeteorGpuItem { x: number; y: number; radius: number; progress: number; seed: number; void: boolean; age: number }

export class MeteorGpuLayer {
  private readonly data = new Float32Array(METEOR_BATCH_CAPACITY * VERTICES * WORDS);
  private count = 0;
  private version = 0;
  private readonly passes: { image: Phaser.GameObjects.Image; batch: MeteorBatchPort }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!renderer?.gl) return;
    // Ground before water (5.2), sunlight, fog and canopy. Only thin information and the
    // incandescent airborne body clear canopy; no unlit dust/material goes into these bands.
    for (const [pass, depth] of [5.12, 20.4, 20.6].entries()) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      image.name = `armageddon-${['ground','warning','flight'][pass]}`;
      registerGraphicsObject(scene, 'meteorEffects', image);
      const batch = createMeteorBatch(renderer, image, pass, this);
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterMeteor${pass}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
      this.passes.push({ image, batch });
    }
  }

  begin(): void { this.count = 0; }
  add(item: MeteorGpuItem): boolean {
    if (this.count >= METEOR_BATCH_CAPACITY) return false;
    let offset = this.count++ * VERTICES * WORDS;
    for (let i=0;i<VERTICES;i++) {
      this.data[offset++]=item.x; this.data[offset++]=item.y;
      this.data[offset++]=CORNERS[i*2]; this.data[offset++]=CORNERS[i*2+1];
      this.data[offset++]=item.radius; this.data[offset++]=item.progress;
      this.data[offset++]=item.seed; this.data[offset++]=item.void?1:0; this.data[offset++]=item.age;
    }
    return true;
  }
  flush(): void {
    this.version++;
    for (const {image} of this.passes) image.setVisible(this.count > 0);
  }
  clear(): void { this.begin(); this.flush(); }
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    context.renderer.renderNodes.startStandAloneRender();
    return this.passes.map(({batch})=>batch.run(context,true)).every(Boolean);
  }
  destroy(): void { for (const {image} of this.passes) image.destroy(); this.passes.length=0; }
  get frame() { return { data:this.data, count:this.count, version:this.version,
    detail:getGraphicsQualityProfile(this.scene).level==='low'?0:1 }; }
}

interface MeteorBatchPort { run(context:Phaser.Renderer.WebGL.DrawingContext,preparing?:boolean):boolean; dispose():void }
// Lazy like GpuFlightRibbonLayer: importing presentation must also work in headless runtime tests.
function createMeteorBatch(renderer:Phaser.Renderer.WebGL.WebGLRenderer,image:Phaser.GameObjects.Image,
  pass:number,owner:MeteorGpuLayer):MeteorBatchPort {
class MeteorBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
  private uploadedVersion=-1;
  private disposed=false;
  constructor(private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    private readonly image: Phaser.GameObjects.Image, private readonly pass:number, private readonly owner:MeteorGpuLayer) {
    super(renderer.renderNodes, { name:`BatchHandlerMeteor${pass}`,shaderName:'ARMAGEDDON_GPU',
      instancesPerBatch:METEOR_BATCH_CAPACITY, verticesPerInstance:VERTICES,indicesPerInstance:VERTICES,
      topology:renderer.gl.TRIANGLES,vertexSource:METEOR_VERTEX,fragmentSource:METEOR_FRAGMENT,
      vertexBufferLayout:{usage:'DYNAMIC_DRAW',layout:[{name:'inCenter',size:2},{name:'inCorner',size:2},
        {name:'inState',size:4},{name:'inAge',size:1}]},
    });
  }
  _generateElementIndices(instances:number):ArrayBuffer {
    const indices=new Uint16Array(instances*VERTICES);for(let i=0;i<indices.length;i++)indices[i]=i;return indices.buffer;
  }
  run(context:Phaser.Renderer.WebGL.DrawingContext,preparing=false):boolean {
    const frame=this.owner.frame;
    if (!preparing && !frame.count) return false;
    this.onRunBegin(context);
    const program=this.programManager;
    const suite=program.getCurrentProgramSuite() as {program:Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
      vao:Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper}|null;
    if(suite) {
      if(this.uploadedVersion!==frame.version) {
        const data=frame.data.subarray(0,Math.max(1,frame.count)*VERTICES*WORDS);
        this.vertexBufferLayout.buffer.viewF32!.set(data);
        this.vertexBufferLayout.buffer.update(data.byteLength,0);this.uploadedVersion=frame.version;
      }
      const m=context.camera!.getViewMatrix();
      this.renderer.setProjectionMatrixFromDrawingContext(context);
      program.setUniform('uProjectionMatrix',this.renderer.projectionMatrix.val);
      program.setUniform('uViewMatrix',[m.a,m.b,0,m.c,m.d,0,m.tx,m.ty,1]);
      program.setUniform('uPass',this.pass);program.setUniform('uDetail',frame.detail);
      program.setUniform('uZoom',context.camera!.zoom);program.setUniform('uAlpha',this.image.alpha);
      program.applyUniforms(suite.program);
      this.renderer.drawElements(context,[],suite.program,suite.vao,Math.max(preparing?1:0,frame.count)*VERTICES,0,this.topology);
    }
    this.onRunEnd(context);return !!suite;
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    (this.manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS,this.updateTextureCount,this);
    for(const suite of Object.values(this.programManager.programs)) {
      Phaser.Utils.Array.Remove(this.renderer.glVAOWrappers,suite.vao);suite.vao.destroy();
    }
    this.programManager.programs={};this.renderer.deleteBuffer(this.indexBuffer);this.renderer.deleteBuffer(this.vertexBufferLayout.buffer);
  }
}
return new MeteorBatch(renderer,image,pass,owner);
}
