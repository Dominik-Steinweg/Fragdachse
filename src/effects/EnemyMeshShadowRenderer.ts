import * as Phaser from 'phaser';
import { getEnemyMeshAssets, type EnemyMeshData } from '../assets/EnemyMeshAssets';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { runWithScopedBlend } from '../graphics/PhaserScopedBlend';
import type { CharacterShadowReceiver } from './CharacterShadowReceiver';
import { meshShadowOpacity, meshShadowSoftness } from './CharacterMeshModel';
import { CHARACTER_MESH_MASK } from './characterMeshShaders';
import { EnemyMeshGpu } from './EnemyMeshGpu';
import { ENEMY_MESH_VERTEX, ENEMY_MESH_BLUR, ENEMY_MESH_BLUR_VERTEX, ENEMY_MESH_DISPLAY_VERTEX, ENEMY_MESH_DISPLAY_FRAGMENT } from './enemyMeshShaders';
import { enemyMeshMatrix, enemyMeshPose, enemyShadowBounds, ENEMY_SHADOW_CAPACITY as CAPACITY,
  ENEMY_SHADOW_COLUMNS as COLUMNS, ENEMY_SHADOW_DEPTH, MOUNTED_SHADOW_DEPTH } from './EnemyMeshShadowModel';
import { SunRenderTarget, sunShaderName, ownSunShader } from './sunlight/SunRenderTarget';
import { setCloudUniforms, type SunCloudState } from './sunlight/cloudShadow';
import { registerGraphicsObject } from './EffectUtils';
import { registerEnemyMeshWarmup } from './EnemyMeshWarmup';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';

const MASK_WORDS = 13, DISPLAY_WORDS = 28;
const DISPLAY_ATTRIBUTES = ['inBounds', 'inTileAlpha', 'inFoot0', 'inFoot1', 'inFoot2', 'inFoot3', 'inPlane'].map(name => ({ name, size: 4 }));

/**
 * A sprite whose Blender mesh casts its sun shadow: enemies, and rigid pipeline assets such as turrets.
 * The mesh is found through the pipeline asset of the displayed image, the pose through the sprite frame.
 */
export interface MeshShadowCaster {
  readonly kind: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  getImageKey(): string;
  getHp(): number;
  isBurrowed(): boolean;
  getHopLiftScale(): number;
  /** 1 when the caster stands on a raised base surface whose top receives its shadow; ground casters omit it. */
  getShadowReceiverPlane?(): number;
  /** Mounted casters (turrets) are drawn below the figures: their shadow lies just under their own sprite. */
  readonly mountedShadow?: boolean;
}
const MASK_ATTRIBUTES = [{ name: 'inMatrix', size: 4 }, { name: 'inTranslation', size: 3 }, { name: 'inBounds', size: 4 }, { name: 'inTile', size: 2 }];
interface Group { gpu: EnemyMeshGpu; data: Float32Array; count: number }

/** One isolated union tile per enemy, one instanced mask draw per type/pose, two atlas blur passes,
 * one instanced composite. Capacity and RGBA target pixels are bounded independently of enemy count. */
export class EnemyMeshShadowRenderer {
  private readonly assets;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly raw: SunRenderTarget;
  private readonly horizontal: SunRenderTarget;
  private readonly blurred: SunRenderTarget;
  private readonly display: Phaser.GameObjects.Shader;
  private readonly mountedDisplay: Phaser.GameObjects.Shader;
  private readonly composite: EnemyMeshGpu;
  private readonly blurGpu: EnemyMeshGpu;
  private readonly groups = new Map<string, Group>();
  private readonly prepared = new Map<string, number>();
  private readonly active = new Set<MeshShadowCaster>();
  private readonly assignments = new Map<MeshShadowCaster, number>();
  private readonly free = Array.from({ length: CAPACITY }, (_, i) => CAPACITY - 1 - i);
  private readonly displayData = new Float32Array(CAPACITY * DISPLAY_WORDS);
  private readonly matrix = new Float32Array(16);
  private readonly bounds = [0, 0, 1, 1];
  private readonly sun = [0, -Math.SQRT1_2, Math.SQRT1_2];
  private readonly view = createVisibleWorldView();
  private readonly grid = [COLUMNS, CAPACITY / COLUMNS];
  private readonly programNames: string[] = [];
  private strength = 0;
  private solid = false;
  private count = 0;
  /** Instances before this index composite in the figure band, the rest in the mounted band. */
  private figureCount = 0;
  private draws = 0;
  private triangles = 0;
  private cpuMs = 0;
  private destroyed = false;
  private atlasAllocated = false;
  private warmupStep = 0;
  private warmupFrame = -1;
  private geometryFrame = -1;
  private readonly projectionProbe: EnemyMeshGpu;
  private readonly releaseWarmup: () => void;
  readonly width: number;
  readonly height: number;
  constructor(private readonly scene: Phaser.Scene, private readonly clouds: SunCloudState,
    private readonly receiver: CharacterShadowReceiver, readonly tileSize: number) {
    this.assets = getEnemyMeshAssets(scene); this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    this.width = COLUMNS * tileSize; this.height = this.grid[1] * tileSize;
    this.raw = new SunRenderTarget(scene, 'EnemyMeshMaskAtlas', CHARACTER_MESH_MASK, () => {});
    this.raw.shader.drawingContext!.setAutoClear(true, false, false);
    this.raw.shader.drawingContext!.setClearColor(0, 0, 0, 0);
    this.raw.shader.renderNode.run = context => {
      for (const group of this.groups.values()) if (group.count && (this.strength > 0 || this.solid)) {
        if (group.gpu.draw(context, group.data.subarray(0, group.count * MASK_WORDS), group.count, [], set => {
          set('uSun', this.sun); set('uGrid', this.grid);
        })) { this.draws++; this.triangles += group.gpu.indexCount / 3 * group.count; }
      }
    };
    this.horizontal = new SunRenderTarget(scene, 'EnemyMeshBlurH', CHARACTER_MESH_MASK, () => {});
    this.blurred = new SunRenderTarget(scene, 'EnemyMeshBlurV', CHARACTER_MESH_MASK, () => {});
    const name = sunShaderName('EnemyMeshComposite'); this.programNames.push(name);
    this.composite = new EnemyMeshGpu(this.renderer, name, ENEMY_MESH_DISPLAY_VERTEX, ENEMY_MESH_DISPLAY_FRAGMENT,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2, new Uint16Array([0, 1, 2, 0, 2, 3]),
      DISPLAY_ATTRIBUTES, CAPACITY);
    // Display-list entries delegate to the instanced composite; no per-enemy objects/filters. Figures and
    // mounted casters share the atlas but composite in their own depth band.
    const displayName = sunShaderName('EnemyMeshDisplayEntry');
    const owner = this;
    const entry = (band: 'figures' | 'mounted'): Phaser.GameObjects.Shader => {
      const display = new Phaser.GameObjects.Shader(scene, { name: displayName, shaderName: displayName, fragmentSource: CHARACTER_MESH_MASK }, 0, 0, 1, 1);
      ownSunShader(display, displayName);
      display.renderNode.run = function(context, object, parent): void {
        runWithScopedBlend(this, () => owner.drawComposite(context, band), context, owner.solid ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.MULTIPLY, object, parent);
      };
      display.setVisible(false);
      scene.add.existing(display); registerGraphicsObject(scene, 'dynamicShadows', display);
      return display;
    };
    this.display = entry('figures').setDepth(ENEMY_SHADOW_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY).setName('enemy-mesh-shadows');
    this.mountedDisplay = entry('mounted').setDepth(MOUNTED_SHADOW_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY).setName('mounted-mesh-shadows');
    const projectionName = sunShaderName('EnemyMeshProjection'); this.programNames.push(projectionName);
    this.projectionProbe = new EnemyMeshGpu(this.renderer, projectionName, ENEMY_MESH_VERTEX, CHARACTER_MESH_MASK,
      new Float32Array([0, 0, 0]), 3, new Uint16Array([0, 0, 0]), MASK_ATTRIBUTES, 1);
    const blurName = sunShaderName('EnemyMeshWorldBlur'); this.programNames.push(blurName);
    this.blurGpu = new EnemyMeshGpu(this.renderer, blurName, ENEMY_MESH_BLUR_VERTEX, ENEMY_MESH_BLUR,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2, new Uint16Array([0, 1, 2, 0, 2, 3]),
      DISPLAY_ATTRIBUTES, CAPACITY);
    for (const [axis, target, source] of [[0, this.horizontal, this.raw], [1, this.blurred, this.horizontal]] as const) {
      target.shader.drawingContext!.setAutoClear(true, false, false);
      target.shader.drawingContext!.setClearColor(0, 0, 0, 0);
      target.shader.renderNode.run = context => {
        this.blurGpu.draw(context, this.displayData.subarray(0, this.count * DISPLAY_WORDS), this.count,
          [source.shader.texture!.get().source.glTexture!], set => {
            set('uMask', 0); set('uGrid', this.grid); set('uTexel', [1 / this.width, 1 / this.height]);
            set('uAxis', axis === 0 ? [1, 0] : [0, 1]);
          });
      };
    }
    this.releaseWarmup = registerEnemyMeshWarmup(scene, () => this.preparePrograms());
  }
  private preparePrograms(): boolean {
    if (this.destroyed || this.warmupStep >= 4) return true;
    if (this.warmupFrame === this.scene.game.loop.frame) return false;
    this.warmupFrame = this.scene.game.loop.frame;
    if (this.warmupStep === 0) { if (this.projectionProbe.prepare()) this.warmupStep++; }
    else if (this.warmupStep === 1) { if (this.composite.prepare()) this.warmupStep++; }
    else {
      const target = this.warmupStep === 2 ? this.horizontal : this.blurred;
      target.draw(3, 3);
      if (this.blurGpu.prepare()) this.warmupStep++;
    }
    return this.warmupStep >= 4;
  }
  /** One resident pose VBO and its bounded instance stream per frame, outside the first-use draw. */
  private prepare(types: ReadonlySet<string>): void {
    if (this.geometryFrame === this.scene.game.loop.frame) return;
    this.geometryFrame = this.scene.game.loop.frame;
    for (const [id, mesh] of this.assets.ready) {
      if (!types.has(id)) continue;
      const pose = this.prepared.get(id) ?? 0; if (pose >= mesh.asset.poses.length) continue;
      const key = `${id}:${pose}`;
      let group = this.groups.get(key);
      if (!group) {
        const name = this.programNames[1] ?? sunShaderName('EnemyMeshProjection');
        if (this.programNames.length === 1) this.programNames.push(name);
        const size = mesh.asset.mesh.vertexCount * 3;
        group = { count: 0, data: new Float32Array(CAPACITY * MASK_WORDS), gpu: new EnemyMeshGpu(this.renderer, name,
          ENEMY_MESH_VERTEX, CHARACTER_MESH_MASK, mesh.positions.subarray(pose * size, (pose + 1) * size), 3, mesh.indices,
          MASK_ATTRIBUTES, CAPACITY) };
        this.groups.set(key, group);
      }
      if (group.gpu.prepare() && this.composite.prepare()) this.prepared.set(id, pose + 1);
      return;
    }
  }
  private readonly typesScratch = new Set<string>();
  private readonly liveScratch = new Set<MeshShadowCaster>();
  sync(enemies: readonly MeshShadowCaster[], visible: boolean): void {
    if (this.destroyed) return;
    const start = performance.now(); this.active.clear(); this.count = this.draws = this.triangles = 0;
    this.display.setVisible(false); this.mountedDisplay.setVisible(false); this.figureCount = 0;
    for (const group of this.groups.values()) group.count = 0;
    // Scratch collections: this runs per frame for every enemy in large hordes.
    const types = this.typesScratch; types.clear();
    for (const enemy of enemies) if (enemy.getHp() > 0) types.add(meshIdOf(enemy));
    this.assets.prefetch(types); this.assets.pump(this.scene.game.loop.frame);
    if (!this.preparePrograms()) { this.releaseUnseen(); return; }
    this.prepare(types);
    if (!visible) { this.releaseUnseen(); return; }
    const path = this.clouds.sunPath;
    for (let i = 0; i < 3; i++) this.sun[i] = path?.sun[i] ?? this.sun[i];
    this.strength = meshShadowOpacity(path?.strength ?? 0, path?.elevation ?? 0);
    const view = getVisibleWorldView(this.scene.cameras.main, this.view, 0);
    // Release dead, burrowed and departed entities before admitting replacements in a full atlas.
    const live = this.liveScratch; live.clear();
    for (const enemy of enemies) live.add(enemy);
    for (const [enemy, slot] of this.assignments) if (!live.has(enemy) || !this.eligible(enemy)) {
      this.assignments.delete(enemy); this.free.push(slot);
    }
    live.clear();
    // Figures first, then mounted casters: each band composites one contiguous instance range.
    for (let band = 0; band < 2; band++) {
    if (band === 1) this.figureCount = this.count;
    for (const enemy of enemies) {
      if (!this.eligible(enemy) || Number(!!enemy.mountedShadow) !== band) continue;
      const asset = getPipelineAssetForTexture(enemy.getImageKey()), meshId = asset?.id ?? enemy.kind;
      const mesh = this.assets.ready.get(meshId); if (!mesh || this.prepared.get(meshId) !== mesh.asset.poses.length) continue;
      // A mesh belongs to the sheet revision it was baked from; a newer sheet (draft) keeps the ellipse.
      if (asset?.revision !== mesh.asset.revision) continue;
      const s = enemy.sprite, pose = enemyMeshPose(s.frame.name, mesh); if (pose < 0) continue;
      enemyMeshMatrix(s, mesh.asset.coordinates.canvasWorldPx, this.matrix, enemy.getHopLiftScale());
      enemyShadowBounds(mesh, this.matrix, this.sun, this.tileSize, this.bounds);
      const b = this.bounds;
      if (b[0] > view.right || b[1] > view.bottom || b[0] + b[2] < view.x || b[1] + b[3] < view.y) {
        // No ellipse for a ready mesh whose projected bounds are outside the camera.
        const previous = this.assignments.get(enemy);
        if (previous !== undefined) { this.assignments.delete(enemy); this.free.push(previous); }
        this.active.add(enemy); continue;
      }
      let slot = this.assignments.get(enemy);
      if (slot === undefined) { slot = this.free.pop(); if (slot === undefined) continue; this.assignments.set(enemy, slot); }
      this.active.add(enemy); this.writeInstance(mesh, pose, slot, s.alpha, enemy.getShadowReceiverPlane?.() ?? 0);
    }
    }
    this.releaseUnseen();
    if (this.count) {
      this.raw.draw(this.width, this.height); this.horizontal.draw(this.width, this.height); this.blurred.draw(this.width, this.height);
      this.atlasAllocated = true;
      // Phaser culls the entries against the camera; their instance positions are already world-space.
      for (const [display, count] of [[this.display, this.figureCount], [this.mountedDisplay, this.count - this.figureCount]] as const) {
        display.setPosition(view.x + view.width / 2, view.y + view.height / 2).setSize(view.width, view.height).setVisible(count > 0);
      }
    }
    this.cpuMs = performance.now() - start;
  }
  private eligible(enemy: MeshShadowCaster): boolean {
    const s = enemy.sprite;
    return s.active && s.visible && s.alpha > 0 && !!s.scaleX && !!s.scaleY && enemy.getHp() > 0 && !enemy.isBurrowed();
  }
  private releaseUnseen(): void {
    for (const [enemy, slot] of this.assignments) if (!this.active.has(enemy)) { this.assignments.delete(enemy); this.free.push(slot); }
  }
  private writeInstance(mesh: EnemyMeshData, pose: number, slot: number, alpha: number, plane: number): void {
    const group = this.groups.get(`${mesh.asset.id}:${pose}`)!, m = this.matrix, b = this.bounds;
    const tx = slot % COLUMNS, ty = Math.floor(slot / COLUMNS), offset = group.count++ * MASK_WORDS;
    const data = group.data, display = this.displayData;
    data[offset] = m[0]; data[offset + 1] = m[1]; data[offset + 2] = m[4]; data[offset + 3] = m[5];
    data[offset + 4] = m[12]; data[offset + 5] = m[13]; data[offset + 6] = m[10];
    data[offset + 7] = b[0]; data[offset + 8] = b[1]; data[offset + 9] = b[2]; data[offset + 10] = b[3];
    data[offset + 11] = tx; data[offset + 12] = ty;
    const d = this.count++ * DISPLAY_WORDS;
    // Same world-space penumbra as the player, independent of tile size or projected bounds.
    const softness = meshShadowSoftness(m[10], this.sun[2]);
    display[d] = b[0]; display[d + 1] = b[1]; display[d + 2] = b[2]; display[d + 3] = b[3];
    display[d + 4] = tx; display[d + 5] = ty; display[d + 6] = alpha; display[d + 7] = softness;
    // A pooled tile may switch from a quadruped to a biped; clear unused contacts.
    display.fill(0, d + 8, d + DISPLAY_WORDS);
    display[d + 24] = plane;
    const feet = mesh.asset.contacts[pose].feet;
    for (let i = 0; i < feet.length; i++) {
      const foot = feet[i], p = foot.position, f = d + 8 + i * 4;
      display[f] = m[0] * p[0] + m[4] * p[1] + m[12]; display[f + 1] = m[1] * p[0] + m[5] * p[1] + m[13];
      display[f + 2] = 2.5 * m[10]; display[f + 3] = foot.groundWeight;
    }
  }
  private drawComposite(context: Phaser.Renderer.WebGL.DrawingContext, band: 'figures' | 'mounted'): void {
    // Camera targets apply their viewport when composited, matching SpriteGPULayer's transform.
    const camera = context.camera!.getViewMatrix(!context.useCanvas); this.renderer.setProjectionMatrixFromDrawingContext(context);
    const first = band === 'figures' ? 0 : this.figureCount, count = band === 'figures' ? this.figureCount : this.count - this.figureCount;
    this.composite.draw(context, this.displayData.subarray(first * DISPLAY_WORDS, (first + count) * DISPLAY_WORDS), count,
      [(this.solid ? this.raw : this.blurred).shader.texture!.get().source.glTexture!, this.receiver.texture.get().source.glTexture!], set => {
        set('uProjectionMatrix', this.renderer.projectionMatrix.val);
        set('uViewMatrix', [camera.a, camera.b, 0, camera.c, camera.d, 0, camera.tx, camera.ty, 1]);
        set('uGrid', this.grid); set('uMask', 0); set('uReceiver', 1); set('uReceiverWorld', this.receiver.world);
        set('uStrength', this.strength); set('uDebugSolid', Number(this.solid)); setCloudUniforms(set, this.clouds);
      });
  }
  handles(enemy: MeshShadowCaster): boolean { return this.active.has(enemy); }
  setDebugSolid(value: boolean): void { this.solid = value; }
  get activeCount(): number { return this.count; }
  setVisible(value: boolean): void {
    this.display.setVisible(value && this.figureCount > 0); this.mountedDisplay.setVisible(value && this.count > this.figureCount);
  }
  inspect() { return { activeInstances: this.count, allocatedSlots: this.assignments.size, tileSize: this.tileSize,
    readyTypes: [...this.assets.ready].filter(([id, data]) => this.prepared.get(id) === data.asset.poses.length).map(([id]) => id),
    prepared: Object.fromEntries(this.prepared), assets: this.assets.inspect(), costs: { cpuMs: this.cpuMs,
      geometryDraws: this.draws, triangles: this.triangles, targetPasses: this.count ? 3 : 0,
      targetBytes: this.atlasAllocated ? this.width * this.height * 4 * 3 : 3 * 3 * 4 * 3,
      targetPixelBudget: this.width * this.height * 3,
      geometryBytes: [...this.groups.values()].reduce((n, g) => n + g.gpu.bytes, this.composite.bytes + this.projectionProbe.bytes + this.blurGpu.bytes),
      stencilBytes: (this.renderer.config as { stencil?: boolean } | undefined)?.stencil ? (this.atlasAllocated ? this.width * this.height : 9) * 3 : 0,
      uploadedBytes: this.count * (MASK_WORDS + 3 * DISPLAY_WORDS) * 4, gpuMs: null } }; }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    this.releaseWarmup(); this.projectionProbe.destroy();
    this.display.destroy(); this.mountedDisplay.destroy(); this.composite.destroy(); this.blurGpu.destroy(); for (const g of this.groups.values()) g.gpu.destroy();
    this.groups.clear(); this.assignments.clear(); this.active.clear();
    this.blurred.destroy(); this.horizontal.destroy(); this.raw.destroy();
    const programs = this.renderer.shaderProgramFactory.programs as Record<string, Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>;
    for (const key of Object.keys(programs)) if (this.programNames.some(n => key === n || key.startsWith(n + '_'))) {
      this.renderer.deleteProgram(programs[key]); delete programs[key];
    }
    // Receiver lifetime belongs exclusively to ShadowSystem.
  }
}

/** Mesh families are keyed by their runtime asset; an enemy kind resolves through the image it shows. */
function meshIdOf(enemy: MeshShadowCaster): string {
  return getPipelineAssetForTexture(enemy.getImageKey())?.id ?? enemy.kind;
}
