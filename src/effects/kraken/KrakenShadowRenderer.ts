import * as Phaser from 'phaser';
import type { ShadowSystem } from '../ShadowSystem';
import { EnemyMeshGpu } from '../EnemyMeshGpu';
import { meshShadowOpacity, meshShadowSoftness } from '../CharacterMeshModel';
import { CHARACTER_MESH_BLUR, CHARACTER_MESH_COMPOSITE, CHARACTER_MESH_MASK } from '../characterMeshShaders';
import { CHARACTER_SHADOW_CONFIG } from '../ShadowConfig';
import { ownSunShader, SunRenderTarget, sunShaderName } from '../sunlight/SunRenderTarget';
import { setCloudUniforms } from '../sunlight/cloudShadow';
import { runWithScopedBlend } from '../../graphics/PhaserScopedBlend';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import { krakenMeshMatrix, krakenProjectedBounds, type KrakenShadowMesh } from './KrakenLightShadowModel';

const VERTEX = `precision highp float;
attribute vec3 inPosition;
attribute float inZOffset;
uniform mat4 uModel; uniform vec3 uSun; uniform vec4 uBounds; uniform float uPlane;
varying vec3 sourceWorld; varying vec2 receiverWorld;
void main(){sourceWorld=(uModel*vec4(inPosition,1.0)).xyz;sourceWorld.z+=inZOffset;
receiverWorld=sourceWorld.xy-uSun.xy*max(0.0,sourceWorld.z-uPlane)/max(.05,uSun.z);
vec2 uv=(receiverWorld-uBounds.xy)/uBounds.zw;
gl_Position=vec4(uv.x*2.0-1.0,1.0-uv.y*2.0,0,1);}`;
const MASK = `precision highp float;
uniform sampler2D uReceiver; uniform vec4 uReceiverWorld; uniform float uWetPass,uWaterLevel;
varying vec3 sourceWorld; varying vec2 receiverWorld;
float response(vec2 p){vec2 uv=(p-uReceiverWorld.xy)/uReceiverWorld.zw;
if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 0.0;
return texture2D(uReceiver,uv).r;}
void main(){float source=response(sourceWorld.xy),target=response(receiverWorld);
float wet=step(.01,target)*(1.0-step(.7,target));
float sourcePlane=(source>.01&&source<.7)?uWaterLevel:0.0;
if(target<=.0||abs(wet-uWetPass)>.1||sourceWorld.z<sourcePlane||sourceWorld.z<uWetPass*uWaterLevel)discard;
gl_FragColor=vec4(1);}`;
// Reuse the exact common finish; only the coverage producer differs on Low.
const COMPOSITE = CHARACTER_MESH_COMPOSITE
  .replace('uniform float uDebugSolid;', 'uniform float uDebugSolid,uAnalytic; uniform vec4 uEllipse;')
  .replace('float mask=texture2D(uMask,outTexCoord).r;', `float mask=texture2D(uMask,outTexCoord).r;
  if(uAnalytic>.5)mask=1.0-smoothstep(.7,1.0,length((world-uEllipse.xy)/uEllipse.zw));`);
type Environment = NonNullable<ReturnType<ShadowSystem['borrowFigureEnvironment']>>;

/** Activity-owned caster; the World owns sun and receiver. No asset/page ownership. */
export class KrakenShadowRenderer {
  private environment: Environment | null = null;
  private raw: SunRenderTarget | null = null;
  private horizontal: SunRenderTarget | null = null;
  private blurred: SunRenderTarget | null = null;
  private display: Phaser.GameObjects.Shader | null = null;
  private gpu: EnemyMeshGpu | null = null;
  private mesh: KrakenShadowMesh | null = null;
  private program = '';
  private readonly matrix = new Float32Array(16);
  private bounds = [0, 0, 1, 1];
  private readonly sun = [0, -1, 1];
  private readonly body = [0, 0, 1, 1];
  private readonly inverse = [1, 0, 0, 1];
  private readonly strength = [0, 0, 1, 0];
  private readonly ellipse = [0, 0, 1, 1];
  private readonly stepH = [0, 0];
  private readonly stepV = [0, 0];
  private readonly instance = new Float32Array([0]);
  private lastTexture: WebGLTexture | null | undefined;
  private maskDraws = 0;
  private readonly view = createVisibleWorldView();
  private waterHeight = 0;
  private analytic = false;
  private destroyed = false;
  private pixels = 0;
  private signature = '';
  constructor(private readonly scene: Phaser.Scene, private readonly shadows: ShadowSystem) {}
  private bind(): boolean {
    if (this.environment) return true;
    this.environment = this.shadows.borrowFigureEnvironment(() => this.releaseResources());
    if (!this.environment) return false;
    const env = this.environment;
    this.raw = new SunRenderTarget(this.scene, 'KrakenMask', CHARACTER_MESH_MASK, () => {});
    this.raw.shader.drawingContext!.setAutoClear(true, false, false);
    this.raw.shader.drawingContext!.setClearColor(0, 0, 0, 0);
    this.raw.shader.renderNode.run = context => {
      this.maskDraws = 0;
      if (!this.gpu || this.strength[0] <= 0) return;
      for (const wet of [0, 1]) if (this.gpu.draw(context, this.instance, 1,
        [env.receiver.texture.get().source.glTexture!], set => {
          set('uModel', this.matrix); set('uSun', this.sun); set('uBounds', this.bounds);
          set('uPlane', wet * this.waterHeight); set('uWetPass', wet); set('uWaterLevel', this.waterHeight);
          set('uReceiver', 0); set('uReceiverWorld', env.receiver.world);
        })) this.maskDraws++;
    };
    this.horizontal = new SunRenderTarget(this.scene, 'KrakenBlurH', CHARACTER_MESH_BLUR,
      set => { set('uMask', 0); set('uStep', this.stepH); }, [this.raw.shader.texture!]);
    this.blurred = new SunRenderTarget(this.scene, 'KrakenBlurV', CHARACTER_MESH_BLUR,
      set => { set('uMask', 0); set('uStep', this.stepV); }, [this.horizontal.shader.texture!]);
    const name = sunShaderName('KrakenShadowComposite');
    this.display = new Phaser.GameObjects.Shader(this.scene, { name, shaderName: name, fragmentSource: COMPOSITE,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uMask', 0); set('uReceiver', 1); set('uReceiverWorld', env.receiver.world);
        set('uBounds', this.bounds); set('uBody', this.body); set('uBodyInverse', this.inverse); set('uStrength', this.strength);
        set('uDebugSolid', 0); set('uAnalytic', Number(this.analytic)); set('uEllipse', this.ellipse); setCloudUniforms(set, env.clouds);
      } }, 0, 0, 1, 1, [this.blurred.shader.texture!, env.receiver.texture]);
    ownSunShader(this.display, name);
    this.display.setDepth(CHARACTER_SHADOW_CONFIG.depth).setVisible(false);
    const node = this.display.renderNode, run = node.run;
    node.run = function(context, object, parent) { runWithScopedBlend(this, run, context, Phaser.BlendModes.MULTIPLY, object, parent); };
    this.scene.add.existing(this.display);
    return true;
  }
  update(sprite: Phaser.GameObjects.Sprite, mesh: KrakenShadowMesh, canvas: number, worldPxPerBU: number,
    waterLevel: number, role: 'water' | 'land' | 'tentacle' | 'egg'): void {
    if (this.destroyed) return;
    if (!sprite.visible || !sprite.active || sprite.alpha <= 0 || !this.bind()) { this.hide(); return; }
    const path = this.environment!.clouds.sunPath;
    for (let i = 0; i < 3; i++) this.sun[i] = path?.sun[i] ?? this.sun[i];
    krakenMeshMatrix(sprite, canvas, this.matrix);
    this.waterHeight = waterLevel * worldPxPerBU * this.matrix[10];
    const quality = getGraphicsQualityProfile(this.scene).level;
    this.analytic = quality === 'low' || role === 'egg';
    this.strength[0] = role === 'egg' ? 0 : meshShadowOpacity(path?.strength ?? 0, path?.elevation ?? 0);
    this.strength[1] = role === 'water' || role === 'tentacle' ? 0 : CHARACTER_SHADOW_CONFIG.contactOpacity;
    this.strength[2] = sprite.alpha;
    this.body[0] = this.matrix[12]; this.body[1] = this.matrix[13];
    const c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation);
    this.inverse[0] = c; this.inverse[1] = s; this.inverse[2] = -s; this.inverse[3] = c;
    const radius = role === 'egg' ? canvas * .12 : canvas * .16;
    this.body[2] = radius * this.matrix[10]; this.body[3] = radius * .7 * this.matrix[10];
    const receiver = this.environment!.receiver.sample(this.body[0], this.body[1]);
    const sourcePlane = receiver > .01 && receiver < .7 ? this.waterHeight : 0;
    if (this.analytic && mesh.bounds.max[2] * this.matrix[10] < sourcePlane) { this.hide(); return; }
    const height = Math.max(0, (mesh.bounds.max[2] * this.matrix[10] + Math.max(sourcePlane, mesh.bounds.min[2] * this.matrix[10])) * .5 - sourcePlane);
    const mx = (mesh.bounds.min[0] + mesh.bounds.max[0]) * .5, my = (mesh.bounds.min[1] + mesh.bounds.max[1]) * .5;
    const rx = (mesh.bounds.max[0] - mesh.bounds.min[0]) * .45, ry = (mesh.bounds.max[1] - mesh.bounds.min[1]) * .45;
    const halfHeight = Math.max(0, mesh.bounds.max[2] * this.matrix[10] - sourcePlane - height);
    this.ellipse[0] = this.body[0] + this.matrix[0] * mx + this.matrix[4] * my - this.sun[0] * height / Math.max(.05, this.sun[2]);
    this.ellipse[1] = this.body[1] + this.matrix[1] * mx + this.matrix[5] * my - this.sun[1] * height / Math.max(.05, this.sun[2]);
    this.ellipse[2] = Math.max(3, Math.abs(this.matrix[0]) * rx + Math.abs(this.matrix[4]) * ry + Math.abs(this.sun[0]) * halfHeight / Math.max(.05, this.sun[2]));
    this.ellipse[3] = Math.max(3, Math.abs(this.matrix[1]) * rx + Math.abs(this.matrix[5]) * ry + Math.abs(this.sun[1]) * halfHeight / Math.max(.05, this.sun[2]));
    const softness = meshShadowSoftness(this.matrix[10], this.sun[2]);
    this.bounds = krakenProjectedBounds(mesh, this.matrix, this.sun, softness * 4 + 3);
    const [x, y, w, h] = this.bounds, view = getVisibleWorldView(this.scene.cameras.main, this.view, 0);
    if (x > view.right || y > view.bottom || x + w < view.x || y + h < view.y) { this.hide(); return; }
    if (!this.analytic && this.mesh !== mesh) {
      if (!this.gpu?.updateGeometry(mesh.positions, mesh.indices)) {
        this.releaseGpu();
        this.program = sunShaderName('KrakenProjection');
        this.gpu = new EnemyMeshGpu(this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, this.program, VERTEX, MASK,
          new Float32Array(Math.max(mesh.positions.length, 24000 * 3)), 3,
          new Uint16Array(Math.max(mesh.indices.length, 24000)), [{ name: 'inZOffset', size: 1 }], 1);
        this.gpu.updateGeometry(mesh.positions, mesh.indices);
      }
      this.mesh = mesh;
      this.signature = '';
    }
    const size = role === 'tentacle' ? quality === 'high' ? 256 : 128 : quality === 'high' ? 512 : 256;
    const width = Math.max(16, Math.ceil(size * w / Math.max(w, h))), heightPx = Math.max(16, Math.ceil(size * h / Math.max(w, h)));
    const signature = [mesh.id, quality, this.environment!.receiver.revision, ...this.matrix, ...this.sun, ...this.bounds, this.waterHeight, this.strength[0] > 0].join('|');
    if (this.lastTexture !== this.raw!.shader.glTexture?.webGLTexture) this.signature = '';
    if (!this.analytic && (signature !== this.signature || !this.signature)) {
      this.stepH[0] = softness / w; this.stepV[1] = softness / h;
      this.raw!.draw(width, heightPx); this.horizontal!.draw(width, heightPx); this.blurred!.draw(width, heightPx);
      this.pixels = width * heightPx;
      // A compiling program must be retried rather than caching a blank first frame.
      this.lastTexture = this.raw!.shader.glTexture?.webGLTexture;
      this.signature = this.strength[0] <= 0 || this.maskDraws === 2 ? signature : '';
    }
    this.display!.setPosition(x + w / 2, y + h / 2).setSize(w, h).setOrigin(.5).setVisible(true);
  }
  hide(): void { this.display?.setVisible(false); }
  get gpuBytes(): number {
    // DrawingContext allocates STENCIL_INDEX8 when the renderer enables stencil.
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const pixels = this.raw ? Math.max(9, this.pixels) * 3 : 0;
    return pixels * ((renderer.config as { stencil?: boolean }).stencil ? 5 : 4) + (this.gpu?.bytes ?? 0);
  }
  inspect() { return { visible: this.display?.visible ?? false, analytic: this.analytic, gpuBytes: this.gpuBytes,
    meshGpuBytes: this.gpu?.bytes ?? 0, maskPixels: this.pixels, receiverRevision: this.environment?.receiver.revision, bounds: [...this.bounds] }; }
  private releaseGpu(): void {
    this.gpu?.destroy(); this.gpu = null; this.mesh = null;
    if (!this.program) return;
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const programs = renderer.shaderProgramFactory.programs as Record<string, Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>;
    for (const key of Object.keys(programs)) if (key === this.program || key.startsWith(this.program + '_')) {
      renderer.deleteProgram(programs[key]); delete programs[key];
    }
    this.program = '';
  }
  private releaseResources(): void {
    this.display?.destroy(); this.display = null;
    this.releaseGpu(); this.blurred?.destroy(); this.horizontal?.destroy(); this.raw?.destroy();
    this.raw = this.horizontal = this.blurred = null; this.pixels = 0; this.signature = '';
    this.environment?.release(); this.environment = null;
  }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.releaseResources(); }
}
