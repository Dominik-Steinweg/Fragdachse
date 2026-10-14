import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getClarityCameraRegistry, promoteToClarityCamera } from '../../scenes/arena/ClarityCameraRegistry';
import { getTextResolution } from '../../graphics/RenderResolution';
import { getEmissiveScale } from '../EmissiveScale';
import { MARKER_LIMITS, type MarkerFrame, type MarkerRenderer } from './MarkerTypes';
import { acquireMarkerGlyphAtlas, markerGlyphUvs } from './MarkerGlyphAtlas';
import { MarkerGpuBuffer, MARKER_GPU_VERTICES, MARKER_GPU_WORDS } from './MarkerGpuBuffer';
import { MARKER_GPU_FRAGMENT, MARKER_GPU_VERTEX } from './MarkerGpuShader';
import { writeMarkerGpuView } from './MarkerGpuCamera';

// Clarity already composites above ALL world depths. Stay below LOCAL_UI as well as
// OVERLAY, so low-depth HUD surfaces such as the radial menu still cover the badges.
export const MARKER_GPU_DEPTHS = { ground: DEPTH.GROUND_FOG - .1, world: DEPTH.LOCAL_UI - 2, edge: DEPTH.LOCAL_UI - 1 } as const;
export interface MarkerGpuRendererOptions {
  /** The composition owner can explicitly disable presentation even with a live WebGL scene. */
  readonly presentation?: 'none' | 'preview' | 'interactive';
  readonly worldCamera?: Phaser.Cameras.Scene2D.Camera;
  /** Geometry has its own count, independent of badge visibility/layout limits. */
  readonly groundCapacity?: number;
}
type Role = keyof typeof MARKER_GPU_DEPTHS;
interface Pass { image: Phaser.GameObjects.Image; buffer: MarkerGpuBuffer; dispose(): void }

/** Pure presentation, three bounded SDF draws + at most six reused text objects.
 * World coordinates remain in the vertex buffer; Clarity submission projects them with
 * the World camera matrix, while the edge pass uses the Clarity design-pixel matrix.
 * Construct after ClarityCameraRegistry.install(); a single-camera dev scene also works.
 */
export class MarkerGpuRenderer implements MarkerRenderer {
  private readonly passes: Partial<Record<Role, Pass>> = {};
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private atlas: ReturnType<typeof acquireMarkerGlyphAtlas> | null = null;
  private uv: ReturnType<typeof markerGlyphUvs> | null = null;
  private texture: Phaser.Textures.Texture | null = null;
  private destroyed = false;
  private time = 0;
  private readonly worldCamera: Phaser.Cameras.Scene2D.Camera | null;

  constructor(private readonly scene: Phaser.Scene, options: MarkerGpuRendererOptions = {}) {
    this.worldCamera = options.worldCamera ?? scene.cameras?.main ?? null;
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (options.presentation === 'none' || !renderer?.gl || !this.worldCamera) return;
    this.atlas = acquireMarkerGlyphAtlas(scene);
    this.texture = this.atlas.texture(); this.uv = markerGlyphUvs(this.texture);
    const capacity = { world: MARKER_LIMITS.worldBadges, edge: MARKER_LIMITS.edgeArrows,
      ground: Math.max(1, Math.min(1024, Math.floor(options.groundCapacity ?? 128))) };
    for (const role of ['ground', 'world', 'edge'] as const) {
      const image = scene.add.image(0, 0, '__WHITE').setDepth(MARKER_GPU_DEPTHS[role]).setVisible(false);
      image.setName(`markers-${role}`).setBlendMode(Phaser.BlendModes.NORMAL);
      if (role !== 'ground') promoteToClarityCamera(scene, image);
      else getClarityCameraRegistry(scene)?.demote(image);
      const buffer = new MarkerGpuBuffer(capacity[role]);
      const batch = createMarkerBatch(renderer, image, role, buffer, this.worldCamera, () => this.texture!, () => this.time, scene);
      this.passes[role] = { image, buffer, dispose: () => batch.dispose() };
      const manager = renderer.renderNodes;
      class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
        constructor() { super(`SubmitterMarkers-${role}`, manager); }
        run(context: Phaser.Renderer.WebGL.DrawingContext): void {
          manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
        }
      }
      image.setRenderNodeRole('Submitter', new Submitter());
      image.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  sync(frame: MarkerFrame, nowMs: number, lowQuality: boolean): void {
    if (this.destroyed || !this.atlas) return;
    this.time = Number.isFinite(nowMs) ? nowMs % (MARKER_LIMITS.pulsePeriodMs * 1024) : 0;
    const texture = this.atlas.texture();
    if (texture !== this.texture) { this.texture = texture; this.uv = markerGlyphUvs(texture); }
    for (const [role, badges] of [['world', frame.worldBadges], ['edge', frame.edgeBadges]] as const) {
      const { buffer, image } = this.passes[role]!;
      buffer.begin();
      for (const badge of badges) buffer.badge(badge, this.uv!, lowQuality);
      buffer.end(); image.setVisible(buffer.count > 0);
    }
    const ground = this.passes.ground!;
    ground.buffer.begin();
    for (const ring of frame.groundRings) ground.buffer.ring(ring);
    ground.buffer.end(); ground.image.setVisible(ground.buffer.count > 0);
    let index = 0;
    for (const badge of frame.edgeBadges.slice(0, MARKER_LIMITS.edgeArrows)) {
      if (!(badge.alpha > 0 && badge.scale > 0)) continue;
      const label = [badge.count && badge.count > 1 ? `${badge.count}×` : '', badge.distanceLabel ?? ''].filter(Boolean).join(' · ');
      if (!label) continue;
      let text = this.labels[index];
      if (!text) {
        text = this.scene.add.text(0, 0, '', { fontFamily: 'Chakra Petch', fontSize: '11px', fontStyle: 'bold',
          color: '#f5ebcc', stroke: '#20150e', strokeThickness: 3, padding: { x: 2, y: 1 } })
          .setOrigin(.5, 0).setScrollFactor(0).setDepth(MARKER_GPU_DEPTHS.edge + .01);
        promoteToClarityCamera(this.scene, text); this.labels.push(text);
      }
      const belowPointer = Math.max(0, Math.sin(badge.pointerAngle)) * 8;
      text.setText(label).setPosition(badge.x, badge.y + (badge.diameter / 2 + belowPointer + 3) * badge.scale)
        .setAlpha(badge.alpha).setScale(badge.scale).setResolution(getTextResolution(this.scene.scale)).setVisible(true);
      index++;
    }
    for (; index < this.labels.length; index++) this.labels[index].setVisible(false);
  }

  getDiagnostics() {
    return { draws: Object.values(this.passes).filter(p => p.image.visible).length,
      world: this.passes.world?.buffer.count ?? 0, edge: this.passes.edge?.buffer.count ?? 0,
      ground: this.passes.ground?.buffer.count ?? 0, labels: this.labels.length, atlas: this.texture?.key ?? null };
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events?.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const pass of Object.values(this.passes)) { pass.dispose(); pass.image.destroy(); }
    delete this.passes.ground; delete this.passes.world; delete this.passes.edge;
    for (const text of this.labels) text.destroy();
    this.labels.length = 0; this.atlas?.release(); this.atlas = null; this.texture = null; this.uv = null;
  }
}

/** Kept lazy: importing the renderer in headless tests never evaluates Phaser GPU classes. */
function createMarkerBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, image: Phaser.GameObjects.Image,
  role: Role, buffer: MarkerGpuBuffer, worldCamera: Phaser.Cameras.Scene2D.Camera,
  texture: () => Phaser.Textures.Texture, time: () => number, scene: Phaser.Scene) {
  class MarkerBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private uploadedVersion = -1;
    private disposed = false;
    private readonly view = new Float32Array(9);
    private readonly pixelScale = new Float32Array(2);
    private readonly onRestore = (): void => { this.uploadedVersion = -1; };
    constructor() {
      super(renderer.renderNodes, { name: `BatchHandlerMarkers-${role}`, shaderName: 'MARKER_GPU',
        instancesPerBatch: buffer.capacity, verticesPerInstance: MARKER_GPU_VERTICES, indicesPerInstance: MARKER_GPU_VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: MARKER_GPU_VERTEX, fragmentSource: MARKER_GPU_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: ['inCenterCorner', 'inGeometry', 'inColor', 'inState', 'inExtra', 'inUv']
          .map(name => ({ name, size: 4 })) } });
      renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore);
    }
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * MARKER_GPU_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext): void {
      if (this.disposed || !buffer.count) return;
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        if (this.uploadedVersion !== buffer.version) {
          const data = buffer.data.subarray(0, buffer.count * MARKER_GPU_VERTICES * MARKER_GPU_WORDS);
          this.vertexBufferLayout.buffer.viewF32!.set(data);
          this.vertexBufferLayout.buffer.update(data.byteLength, 0); this.uploadedVersion = buffer.version;
        }
        const camera = role === 'edge' ? context.camera! : worldCamera;
        // Clarity consumes world positions AFTER the world camera composites. Its external
        // viewport is therefore needed even if the world itself used an offscreen framebuffer.
        writeMarkerGpuView(this.view, camera, role === 'world', context.useCanvas);
        const clarity = getClarityCameraRegistry(scene)?.getClarityCamera();
        const designScale = clarity?.zoomX ?? 1;
        this.pixelScale.set([designScale, clarity?.zoomY ?? 1]);
        renderer.setProjectionMatrixFromDrawingContext(context);
        program.setUniform('uProjectionMatrix', renderer.projectionMatrix.val);
        program.setUniform('uViewMatrix', this.view);
        program.setUniform('uPixelScale', this.pixelScale);
        program.setUniform('uRadiusScale', role === 'edge' ? 1 : camera.zoomX / designScale);
        program.setUniform('uTime', time()); program.setUniform('uGlyphs', 0);
        // Counterbalance night attenuation in the existing world material band without
        // raising ground geometry over figures. The scene's composites still own lighting.
        program.setUniform('uGroundStrength', 1 + getEmissiveScale() * .65);
        program.applyUniforms(suite.program);
        renderer.drawElements(context, [texture().source[0].glTexture!], suite.program, suite.vao,
          buffer.count * MARKER_GPU_VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
    }
    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      renderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore);
      (this.manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      // Shader programs are renderer-shared; these VAOs and buffers belong only to this batch.
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      this.programManager.programs = {}; renderer.deleteBuffer(this.indexBuffer); renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new MarkerBatch();
}
