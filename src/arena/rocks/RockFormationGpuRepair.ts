import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { ROCK_BASE_PHASES, ROCK_BASE_FRAME_MARGIN } from '../RockBaseConfig';
import { FogGpuTimer } from '../../effects/groundFog/FogGpuTimer';
import { filterDetail, formationNoise, FORMATION, FORMATION_SIDE, type FormationRock, type RockFormationSource } from './RockFormationField';
import type { RockRimGeometry } from './RockRimGeometry';
import { FORMATION_REPAIR_LIGHT, FORMATION_REPAIR_SHADERS, formationRepairLightTaps, REPAIR_PAD, REPAIR_SPAN, REPAIR_DISTANCE_PASSES } from './formationRepairShaders';

type Renderer = Phaser.Renderer.WebGL.WebGLRenderer;
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; width: number; height: number };
export interface FormationRepairChunk { cx: number; cy: number; slot: number }
export interface FormationRepairAtlas { field: WebGLTexture; occlusion: WebGLTexture }
const vertex = 'attribute vec2 aPosition; void main(){gl_Position=vec4(aPosition,0,1);}';

/** Private data-only GPU transaction. Does not draw into a camera target, read
 * scene colour, or alter blend/alpha. Publication is copy-to-atlas before the
 * world's draw; its asynchronous worker supplies the canonical CPU mirror of
 * the same revision, without a second delayed GPU publication.
 * No readPixels/finish/query wait is allowed on the destruction path.
 */
export class RockFormationGpuRepair {
  private readonly gl: WebGLRenderingContext;
  private readonly gl2: WebGL2RenderingContext | null;
  private readonly vaoExtension: OES_vertex_array_object | null;
  private vao: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null = null;
  private buffer: WebGLBuffer | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private readonly textures: WebGLTexture[] = [];
  private readonly programs: Program[] = [];
  private readonly passes = new Map<string,Program>();
  private readonly targets: Target[] = [];
  private occupancy!: Target;
  private skin!: Target;
  private detail!: Target;
  private noise!: Target;
  private taps!: Target;
  private readonly cells: Uint8Array;
  private readonly cellUpload = new Uint8Array(4);
  private readonly cols: number;
  private readonly rows: number;
  private timer: FogGpuTimer | null = null;
  private timingSample: number | null = null;
  private timingWaitFrames = 0;
  private angle = NaN;
  private ready = false;
  private verified = false;
  private destroyed = false;
  private readonly onLost = (): void => { this.ready=false;this.reason='WebGL context lost; requires world rebuild'; };
  reason: string | null = null;
  lastCpuMs = 0;
  maxCpuMs = 0;
  batches = 0;
  maxChannelError: number | null = null;
  verifiedChannels = 0;
  readonly channelErrors: Record<string, { max: number; actual: number; expected: number; x: number; y: number; count: number }> = {};
  textureBytes = 0;

  static create(renderer: Renderer, width: number, height: number,
    states: readonly (FormationRock | undefined)[], source: RockFormationSource): RockFormationGpuRepair | null {
    // Canvas/test renderers, and WebGL implementations without float textures,
    // keep the existing worker path. Capability failure is reported by the owner.
    if (typeof renderer.gl?.getExtension !== 'function') return null;
    return new RockFormationGpuRepair(renderer,width,height,states,source);
  }
  private constructor(private readonly renderer: Renderer, width: number, height: number,
    states: readonly (FormationRock | undefined)[], source: RockFormationSource) {
    // Phaser installs core-named VAO/instancing shims on WebGL1. A VAO method is
    // therefore NOT evidence of WebGL2 or sized RGBA32F support.
    this.gl=renderer.gl;this.gl2='texStorage2D' in this.gl ? this.gl as WebGL2RenderingContext : null;
    this.vaoExtension=this.gl2?null:this.gl.getExtension('OES_vertex_array_object');
    this.cols=Math.ceil(width/CELL_SIZE);this.rows=Math.ceil(height/CELL_SIZE);
    this.cells=new Uint8Array(this.cols*this.rows*4);
    for(const s of states) if(s) this.writeCell(s);
    try {
      if(!this.gl2 && (!this.gl.getExtension('OES_texture_float') || !this.vaoExtension)) throw Error('Float textures/VAO unavailable');
      this.gl.getExtension(this.gl2?'EXT_color_buffer_float':'WEBGL_color_buffer_float');
      if(this.gl.getShaderPrecisionFormat(this.gl.FRAGMENT_SHADER,this.gl.HIGH_FLOAT)!.precision<23) throw Error('Fragment highp is not float32');
      this.scoped(()=>this.initialize(width,height,source));
      this.ready=true;
      this.timer=new FogGpuTimer(this.gl);
      renderer.canvas.addEventListener('webglcontextlost',this.onLost);
    } catch(error) { this.reason=String(error);this.release(); }
  }
  get available(): boolean { return this.ready && this.verified && !this.destroyed; }
  get needsValidation(): boolean { return this.ready && !this.verified; }
  get diagnostics() {
    return {available:this.available,reason:this.reason,validated:this.verified,maxChannelError:this.maxChannelError,
      verifiedChannels:this.verifiedChannels,channelErrors:this.channelErrors,lastCpuMs:this.lastCpuMs,maxCpuMs:this.maxCpuMs,
      gpuMs:this.timer?.ms??null,gpuSamples:this.timer?.sample??0,batches:this.batches,textureBytes:this.textureBytes};
  }
  private writeCell(s: FormationRock): void {
    if(s.gridX<0||s.gridY<0||s.gridX>=this.cols||s.gridY>=this.rows)return;
    this.cells[(s.gridY*this.cols+s.gridX)*4]=s.active&&s.material!=='walls'?s.frame+1:0;
  }
  change(states: readonly FormationRock[]): void {
    if(!this.ready)return;
    this.scoped(()=>{
      const gl=this.gl;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.occupancy.texture);
      for(const s of states) {
        this.writeCell(s);
        if(s.gridX<0||s.gridY<0||s.gridX>=this.cols||s.gridY>=this.rows)continue;
        this.cellUpload[0]=this.cells[(s.gridY*this.cols+s.gridX)*4];
        gl.texSubImage2D(gl.TEXTURE_2D,0,s.gridX,s.gridY,1,1,gl.RGBA,gl.UNSIGNED_BYTE,this.cellUpload);
      }
    });
  }
  /** Initial worker publication also exercises compilation, actual float FBOs,
   * texture orientation, and device arithmetic. A <=1/255 channel tolerance is
   * only for float32-vs-double rounding, never different occupancy or geometry.
   * Readback happens during preparation, never during an explosion.
   */
  validate(chunk:FormationRepairChunk,azimuth:number,solar:boolean,rim:RockRimGeometry|null,data:Uint8Array,occlusion:Uint8Array):void {
    if(!this.needsValidation)return;
    // An empty chunk cannot validate the height/horizon path.
    if(!data.some((v,i)=>i%4===3&&v>0))return;
    try {
      this.scoped(()=>{
        this.build(chunk,azimuth,solar,rim);
        const actual=new Uint8Array(data.length);
        let max=0;
        for(const [target,expected,names] of [[this.targets[6],data,['normalX','normalY','horizonCentre','coverage']],
          [this.targets[7],occlusion,['sky','horizonLeft','horizonRight','contact']]] as const) {
          this.attach(target);
          this.gl.readPixels(0,0,FORMATION_SIDE,FORMATION_SIDE,this.gl.RGBA,this.gl.UNSIGNED_BYTE,actual);
          for(let c=0;c<4;c++)this.channelErrors[names[c]]={max:0,actual:actual[c],expected:expected[c],x:0,y:0,count:0};
          for(let i=0;i<actual.length;i++) {
            const error=Math.abs(actual[i]-expected[i]),channel=this.channelErrors[names[i%4]];
            if(error>1)channel.count++;
            if(error>channel.max)Object.assign(channel,{max:error,actual:actual[i],expected:expected[i],x:(i>>2)%FORMATION_SIDE,y:Math.floor((i>>2)/FORMATION_SIDE)});
            max=Math.max(max,error);
          }
          this.verifiedChannels+=actual.length;
        }
        this.maxChannelError=max;
        if(max>1)throw Error(`GPU/worker formation parity failed: maximum byte error ${max}`);
        this.verified=true;
      });
    } catch(error) {this.ready=false;this.reason=String(error);}
  }
  repair(chunks:readonly FormationRepairChunk[],azimuth:number,solar:boolean,rim:RockRimGeometry|null,atlas:FormationRepairAtlas):boolean {
    if(!this.available||!chunks.length)return false;
    const start=performance.now();
    this.scoped(()=>{
      // Do not nest an elapsed query inside the optional frame-wide profiler.
      const extension=this.gl.getExtension(this.gl2?'EXT_disjoint_timer_query_webgl2':'EXT_disjoint_timer_query') as
        {TIME_ELAPSED_EXT:number;CURRENT_QUERY_EXT:number;getQueryEXT?:(target:number,key:number)=>unknown}|null;
      const occupiedQuery=extension && (this.gl2?this.gl2.getQuery(extension.TIME_ELAPSED_EXT,this.gl2.CURRENT_QUERY)
        :extension.getQueryEXT?.(extension.TIME_ELAPSED_EXT,extension.CURRENT_QUERY_EXT));
      const time=!occupiedQuery&&this.timingSample===null&&this.timer?.supported;
      if(time) {this.timingSample=this.timer!.sample;this.timingWaitFrames=0;this.timer!.begin();}
      try {
        for(const chunk of chunks) {
          this.build(chunk,azimuth,solar,rim);
          for(const [source,target] of [[this.targets[6],atlas.field],[this.targets[7],atlas.occlusion]] as const) {
            this.attach(source);this.gl.activeTexture(this.gl.TEXTURE0);this.gl.bindTexture(this.gl.TEXTURE_2D,target);
            this.gl.copyTexSubImage2D(this.gl.TEXTURE_2D,0,chunk.slot%FORMATION.atlasColumns*FORMATION_SIDE,
              Math.floor(chunk.slot/FORMATION.atlasColumns)*FORMATION_SIDE,0,0,FORMATION_SIDE,FORMATION_SIDE);
          }
        }
      } finally {if(time)this.timer!.end();}
    });
    this.lastCpuMs=performance.now()-start;this.maxCpuMs=Math.max(this.maxCpuMs,this.lastCpuMs);this.batches++;
    return true;
  }
  /** Poll only; starting an empty query would attribute unrelated frame work. */
  poll():void {
    if(this.timingSample===null||!this.timer)return;
    this.timer.poll();
    if(this.timer.sample>this.timingSample||++this.timingWaitFrames>120)this.timingSample=null;
  }
  private initialize(width:number,height:number,source:RockFormationSource):void {
    const gl=this.gl;
    this.framebuffer=gl.createFramebuffer();this.buffer=gl.createBuffer();
    this.vao=this.gl2?this.gl2.createVertexArray():this.vaoExtension!.createVertexArrayOES();this.bindVAO();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    for(const [name,fragment] of Object.entries({...FORMATION_REPAIR_SHADERS,light:FORMATION_REPAIR_LIGHT}))this.passes.set(name,this.compile(fragment));
    for(let i=0;i<8;i++) {
      const side=i>=6?FORMATION_SIDE:REPAIR_SPAN;
      const target=this.texture(side,side,i>=2&&i<=5,null);this.targets.push(target);this.attach(target);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('RGBA32F framebuffer unavailable');
    }
    this.occupancy=this.texture(this.cols,this.rows,false,this.cells);
    const skinWidth=ROCK_BASE_PHASES*(CELL_SIZE+2*ROCK_BASE_FRAME_MARGIN);
    this.skin=this.texture(skinWidth,source.alpha.length/skinWidth,false,source.alpha,true);
    const fine=filterDetail(source.detail),period=Math.sqrt(fine.length);
    this.detail=this.texture(period,period,true,fine,true);
    const nx=Math.ceil((width+REPAIR_SPAN*2)/39)+52,ny=Math.ceil((height+REPAIR_SPAN*2)/39)+32;
    const noise=new Float32Array(nx*ny);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)noise[y*nx+x]=formationNoise(x-16,y-16);
    this.noise=this.texture(nx,ny,true,noise,true);
    this.taps=this.texture(56,4,true,formationRepairLightTaps(135));this.angle=135;
  }
  private build(chunk:FormationRepairChunk,azimuth:number,solar:boolean,rim:RockRimGeometry|null):void {
    const gl=this.gl;
    this.bindVAO();gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.colorMask(true,true,true,true);
    if(this.angle!==azimuth) {
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.taps.texture);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,56,4,gl.RGBA,gl.FLOAT,formationRepairLightTaps(azimuth));this.angle=azimuth;
    }
    const origin=[chunk.cx*FORMATION.chunk-(REPAIR_PAD+1)*2,chunk.cy*FORMATION.chunk-(REPAIR_PAD+1)*2];
    this.draw('coverage',this.targets[0],[this.occupancy,this.skin],{uOrigin:origin,uSize:[this.cols,this.rows],uStride:this.skin.height});
    this.draw('support',this.targets[1],[this.targets[0]]);
    this.draw('distance',this.targets[2],[this.targets[1]],{uInit:1});
    let d=2;
    // Exact bounded octile metric: separable min-plus line convolutions in all
    // four lattice directions. Binary strides cover every offset through 63;
    // beyond 49 texels the reference height envelope is already clamped.
    for(const {direction,stride} of REPAIR_DISTANCE_PASSES) {
      const next=d===2?3:2;
      this.draw('distance',this.targets[next],[this.targets[d]],{uInit:0,uDirection:direction,uStride:stride});d=next;
    }
    let m=4;
    for(let pass=0;pass<6;pass++) {
      const next=m===4?5:4;
      this.draw('blur',this.targets[next],[pass===0?this.targets[1]:this.targets[m]],{uInit:Number(pass===0),uDirection:pass%2===0?[1,0]:[0,1]});m=next;
    }
    // The finished distance scratch may now be reused for height. Never sample
    // from the same texture that is currently attached for drawing.
    const height=d===2?3:2;
    this.draw('height',this.targets[height],[this.targets[1],this.targets[d],this.targets[m],this.detail,this.noise],
      {uOrigin:origin,uSize:[this.detail.width,this.detail.height],uNoiseSize:[this.noise.width,this.noise.height],
        uRim:rim?[rim.rockRimHeight,rim.rockRimWidth,rim.rockRimLip,1]:[0,0,0,0]});
    for(let output=0;output<2;output++)this.draw('light',this.targets[6+output],[this.targets[height],this.taps],{uInit:Number(solar),uOutput:output});
  }
  private draw(name:string,target:Target,inputs:readonly Target[],uniforms:Record<string,number|number[]>={}):void {
    const gl=this.gl,p=this.passes.get(name)!;this.attach(target);gl.viewport(0,0,target.width,target.height);gl.useProgram(p.program);
    inputs.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t.texture);gl.uniform1i(this.uniform(p,['uA','uB','uC','uD','uNoise'][i]),i);});
    for(const [key,value] of Object.entries(uniforms)) {
      const location=this.uniform(p,key);
      if(typeof value==='number')gl.uniform1f(location,value);
      else if(value.length===2)gl.uniform2f(location,value[0],value[1]);
      else gl.uniform4f(location,value[0],value[1],value[2],value[3]);
    }
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  private uniform(p:Program,key:string):WebGLUniformLocation|null {
    if(!p.uniforms.has(key))p.uniforms.set(key,this.gl.getUniformLocation(p.program,key));
    return p.uniforms.get(key)!;
  }
  private attach(target:Target):void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.framebuffer);
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER,this.gl.COLOR_ATTACHMENT0,this.gl.TEXTURE_2D,target.texture,0);
  }
  private texture(width:number,height:number,float:boolean,data:Uint8Array|Float32Array|null,scalar=false):Target {
    const gl=this.gl,texture=gl.createTexture()!;this.textures.push(texture);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
    // Immutable single-channel inputs are sampled only, never FBO attachments.
    const format=scalar?(this.gl2?this.gl2.RED:gl.LUMINANCE):gl.RGBA;
    const internal=this.gl2?(float?(scalar?this.gl2.R32F:this.gl2.RGBA32F):(scalar?this.gl2.R8:gl.RGBA)):format;
    gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,format,float?gl.FLOAT:gl.UNSIGNED_BYTE,data);
    this.textureBytes+=width*height*(scalar?1:4)*(float?4:1);
    return {texture,width,height};
  }
  private compile(fragment:string):Program {
    const gl=this.gl,program=gl.createProgram()!,shaders:WebGLShader[]=[];
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const) {
        const shader=gl.createShader(type)!;shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Repair shader failed');
        gl.attachShader(program,shader);
      }
      gl.bindAttribLocation(program,0,'aPosition');gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Repair link failed');
      const result={program,uniforms:new Map<string,WebGLUniformLocation|null>()};this.programs.push(result);return result;
    } catch(error) {gl.deleteProgram(program);throw error;}
    finally {for(const shader of shaders)gl.deleteShader(shader);}
  }
  private bindVAO():void {if(this.gl2)this.gl2.bindVertexArray(this.vao);else this.vaoExtension?.bindVertexArrayOES(this.vao);}
  private scoped<T>(run:()=>T):T {
    this.renderer.renderNodes.finishBatch();
    const dither=this.gl.isEnabled(this.gl.DITHER);
    // Raw private data passes intentionally do not mutate Phaser's state cache.
    // Re-apply that cache, including VAO, FBO, program, blend, masks and all texture
    // units in finally. No scene target or following ADD batch inherits our state.
    try {
      // Pixel-store flags apply to later texSubImage2D calls too, including typed
      // arrays in WebGL1. Phaser's last colour upload may leave PMA/flip enabled:
      // our RGBA float ray table has alpha zero, so inherited PMA erases all XYZ
      // taps on an azimuth update. Occupancy cells likewise carry data in RGB.
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL,0);
      return run();
    } finally {
      this.renderer.glTextureUnits.bindUnits(this.renderer.glTextureUnits.units,true);
      // ELEMENT_ARRAY_BUFFER belongs to the bound VAO. Phaser's cached global
      // binding can differ from the index buffer captured in its current VAO:
      // VAO.bind() deliberately only changes state.vao. Restore global bindings
      // on our private VAO FIRST, then rebind Phaser's VAO without overwriting its
      // index buffer. The default vao-first order corrupts subsequent quad draws.
      // Upload-only scopes (change) have not bound our VAO yet.
      this.bindVAO();
      this.renderer.glWrapper.update(undefined,true,true);
      if(dither)this.gl.enable(this.gl.DITHER);else this.gl.disable(this.gl.DITHER);
    }
  }
  private release():void {
    const gl=this.gl;
    this.timer?.destroy();this.timer=null;
    for(const p of this.programs)gl.deleteProgram(p.program);this.programs.length=0;
    for(const t of this.textures)gl.deleteTexture(t);this.textures.length=0;
    this.textureBytes=0;
    if(this.buffer)gl.deleteBuffer(this.buffer);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);
    if(this.gl2)this.gl2.deleteVertexArray(this.vao);else this.vaoExtension?.deleteVertexArrayOES(this.vao);
    this.buffer=null;this.framebuffer=null;this.vao=null;
  }
  destroy():void {
    if(this.destroyed)return;this.destroyed=true;this.ready=false;
    this.renderer.canvas.removeEventListener('webglcontextlost',this.onLost);this.release();
  }
}
