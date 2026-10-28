import * as Phaser from 'phaser';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import {
  VOID_TAINT_CLOCK_MS, VOID_TAINT_TEXEL_ROWS, VOID_TAINT_TEXTURE_WIDTH, VoidTaintTrails, type VoidTaintFrame,
} from '../../arena/VoidTaint';
import { ownSunShader } from './SunRenderTarget';
import { VOID_TAINT_FRAGMENT, VOID_TAINT_SHADER_NAME, VOID_TAINT_VERTEX, VOID_TAINT_VERTEX_CAPACITY } from './VoidTaintShaders';

/** World margin around the camera, so warped samples and drifting fog never reach the target's edge. */
const VIEW_MARGIN_PX = 96;
/** Above this share of the stamps changed, one full upload is cheaper than a range. */
const FULL_UPLOAD_SHARE = .25;
const FLOATS_PER_STAMP = 24;

let nextTaintId = 0;

/**
 * The void trails of one World on the GPU (E12): a small render target that follows the camera,
 * R haze and G flare per texel, rasterized every frame from the trails' stamps with MAX blending.
 * Owned by the void creep presentation, which lends texture and view to every void layer and the
 * ground fog. Without MAX blending the trails stay off instead of failing the World.
 */
export class VoidTaintLayer {
  /** World rect the target covers: x, y, width, height. */
  readonly view = new Float32Array(4);
  /** 1 while the target holds trails; consumers skip it otherwise. */
  on = 0;
  private shader: Phaser.GameObjects.Shader | null = null;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly key = `__void_taint_${nextTaintId++}`;
  private readonly commandKey = `${this.key}_commands`;
  private commandWrapper: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
  private commandTexture: Phaser.Textures.Texture | null = null;
  private readonly visible = createVisibleWorldView();
  private maximum: number | undefined;
  private size = { width: 0, height: 0 };
  private uploadAll = true;
  private readonly onRestore = (): void => { this.uploadAll = true; };

  constructor(private readonly scene: Phaser.Scene, private readonly trails: VoidTaintTrails, private readonly world: VoidTaintFrame) {
    this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = this.renderer.gl;
    this.maximum = 'MAX' in gl ? (gl as WebGL2RenderingContext).MAX : gl.getExtension('EXT_blend_minmax')?.MAX_EXT;
    this.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore);
  }

  /** False where the GPU cannot unite trails (no MAX blending); the World then shows none. */
  get supported(): boolean { return this.maximum !== undefined; }

  /** The trails' texture this frame, or null without trails; valid until the next update. */
  get texture(): Phaser.Textures.Texture | null { return this.on && this.shader ? this.shader.texture : null; }

  /**
   * Rasters the trails around the camera at `nowMs` on a target whose long side has `texels`.
   * Call once per frame before the fog and the void layers draw.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera, nowMs: number, texels: number): void {
    this.on = 0;
    if (!this.supported || this.trails.size <= 0) return;
    const view = getVisibleWorldView(camera, this.visible, VIEW_MARGIN_PX / Math.max(.05, camera.zoom) + 64);
    const aspect = view.width / Math.max(1, view.height);
    const width = Math.max(8, Math.round(aspect >= 1 ? texels : texels * aspect)), height = Math.max(8, Math.round(aspect >= 1 ? texels / aspect : texels));
    if (!this.shader || Math.abs(width - this.size.width) > 1 || Math.abs(height - this.size.height) > 1) this.makeTarget(width, height);
    // Snap the rect to whole texels, so the field stands still while the camera glides.
    const tx = view.width / this.size.width, ty = view.height / this.size.height;
    this.view[0] = Math.floor(view.x / tx) * tx; this.view[1] = Math.floor(view.y / ty) * ty;
    this.view[2] = this.size.width * tx; this.view[3] = this.size.height * ty;
    this.upload();
    this.draw(nowMs);
    this.on = 1;
  }

  destroy(): void {
    this.renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore);
    this.shader?.destroy(); this.shader = null;
    if (this.commandTexture) { this.scene.textures.remove(this.commandKey); this.commandTexture = null; this.commandWrapper = null; }
    this.on = 0;
  }

  /** Lab readout of one world point (R haze, G flare in 0..1); synchronizes the GPU, never in a frame. */
  readTaint(x: number, y: number): [number, number] {
    const shader = this.shader; if (!shader || !this.on) return [0, 0];
    const gl = this.renderer.gl, pixel = new Uint8Array(4);
    const px = Math.floor((x - this.view[0]) / this.view[2] * this.size.width);
    const py = this.size.height - 1 - Math.floor((y - this.view[1]) / this.view[3] * this.size.height);
    if (px < 0 || py < 0 || px >= this.size.width || py >= this.size.height) return [0, 0];
    // use() auto-clears this render target; a diagnostic must only bind it.
    shader.drawingContext!.beginDraw();
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    this.renderer.glWrapper.update({ blend: { enabled: true } });
    return [pixel[0] / 255, pixel[1] / 255];
  }

  private makeTarget(width: number, height: number): void {
    this.shader?.destroy();
    const shader = new Phaser.GameObjects.Shader(this.scene, {
      name: VOID_TAINT_SHADER_NAME, shaderName: VOID_TAINT_SHADER_NAME,
      fragmentSource: VOID_TAINT_FRAGMENT, vertexSource: VOID_TAINT_VERTEX, setupUniforms: () => {},
    }, 0, 0, width, height, ['__DEFAULT']);
    ownSunShader(shader, VOID_TAINT_SHADER_NAME, true);
    try {
      shader.setRenderToTexture(this.key);
      const camera = shader.drawingContext!.camera;
      shader.once('destroy', () => camera?.destroy());
      shader.drawingContext!.state.blend = { ...shader.drawingContext!.state.blend, enabled: true, equation: [this.maximum!, this.maximum!] };
      shader.texture!.setFilter(Phaser.Textures.FilterMode.LINEAR);
      shader.renderNode.vertexBufferLayout.buffer.resize(VOID_TAINT_VERTEX_CAPACITY * 4 * 4);
    } catch (error) { shader.destroy(); throw error; }
    this.shader = shader; this.size = { width, height };
    this.uploadAll = true;
  }

  private upload(): void {
    const trails = this.trails, gl = this.renderer.gl;
    if (!this.commandWrapper) {
      this.commandWrapper = this.renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
        gl.RGBA, trails.commands, VOID_TAINT_TEXTURE_WIDTH, VOID_TAINT_TEXEL_ROWS, false, false, false);
      this.commandTexture = this.scene.textures.addGLTexture(this.commandKey, this.commandWrapper);
      this.uploadAll = true;
    }
    const all = this.uploadAll || (trails.dirtyMax - trails.dirtyMin + 1) > trails.used * FULL_UPLOAD_SHARE;
    if (!all && trails.dirtyMax < trails.dirtyMin) return;
    const first = all ? 0 : trails.dirtyMin, last = all ? Math.max(0, trails.used - 1) : trails.dirtyMax;
    // Commands: whole blocks of five rows hold the changed stamps.
    const row0 = Math.floor(first / VOID_TAINT_TEXTURE_WIDTH) * 5, row1 = all ? VOID_TAINT_TEXEL_ROWS : (Math.floor(last / VOID_TAINT_TEXTURE_WIDTH) + 1) * 5;
    this.renderer.glTextureUnits.bind(this.commandWrapper, 0);
    this.renderer.glWrapper.updateTexturing({ texturing: { flipY: false, premultiplyAlpha: false } });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row0, VOID_TAINT_TEXTURE_WIDTH, row1 - row0, gl.RGBA, gl.UNSIGNED_BYTE,
      trails.commands.subarray(row0 * VOID_TAINT_TEXTURE_WIDTH * 4, row1 * VOID_TAINT_TEXTURE_WIDTH * 4));
    // Vertices: the changed slot range.
    const buffer = this.shader!.renderNode.vertexBufferLayout.buffer;
    const from = first * FLOATS_PER_STAMP, to = (last + 1) * FLOATS_PER_STAMP;
    buffer.viewF32!.set(trails.vertices.subarray(from, to), from);
    buffer.update((to - from) * 4, from * 4);
    trails.markClean(); this.uploadAll = false;
  }

  private draw(nowMs: number): void {
    const shader = this.shader!, node = shader.renderNode, renderer = node.renderer, gl = renderer.gl;
    const context = shader.drawingContext!;
    node.manager.startStandAloneRender();
    context.use();
    const manager = node.programManager;
    const suite = manager.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
      vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
    if (suite) {
      manager.setUniform('uViewOrigin', [this.view[0] - this.world.offsetX, this.view[1] - this.world.offsetY]);
      manager.setUniform('uViewSize', [this.view[2], this.view[3]]);
      manager.setUniform('uWorldSize', [this.world.width, this.world.height]);
      manager.setUniform('uCommands', 0);
      manager.setUniform('uNow', ((nowMs % VOID_TAINT_CLOCK_MS) + VOID_TAINT_CLOCK_MS) % VOID_TAINT_CLOCK_MS);
      manager.applyUniforms(suite.program);
      context.beginDraw(); suite.program.bind(); suite.vao.bind();
      renderer.glTextureUnits.bindUnits([this.commandTexture!.get().source.glTexture!]);
      gl.drawArrays(gl.TRIANGLES, 0, this.trails.used * 6);
    }
    context.release();
    renderer.glWrapper.update({ blend: { enabled: true, equation: [gl.FUNC_ADD, gl.FUNC_ADD] } });
  }
}
