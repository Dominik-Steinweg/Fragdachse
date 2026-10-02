import * as Phaser from 'phaser';
import { getEnemyMeshAssets, type EnemyMeshData } from '../assets/EnemyMeshAssets';
import type { EnemyEntity } from '../entities/EnemyEntity';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { runWithScopedBlend } from '../graphics/PhaserScopedBlend';
import type { CharacterShadowReceiver } from './CharacterShadowReceiver';
import { meshShadowOpacity } from './CharacterMeshModel';
import { CHARACTER_MESH_MASK } from './characterMeshShaders';
import { EnemyMeshGpu } from './EnemyMeshGpu';
import { ENEMY_MESH_VERTEX, ENEMY_MESH_BLUR, ENEMY_MESH_DISPLAY_VERTEX, ENEMY_MESH_DISPLAY_FRAGMENT } from './enemyMeshShaders';
import { enemyMeshMatrix, enemyMeshPose, enemyShadowBounds, ENEMY_SHADOW_CAPACITY as CAPACITY,
  ENEMY_SHADOW_COLUMNS as COLUMNS, ENEMY_SHADOW_DEPTH } from './EnemyMeshShadowModel';
import { SunRenderTarget, sunShaderName, ownSunShader } from './sunlight/SunRenderTarget';
import { setCloudUniforms, type SunCloudState } from './sunlight/cloudShadow';
import { registerGraphicsObject } from './EffectUtils';
import { registerEnemyMeshWarmup } from './EnemyMeshWarmup';

const MASK_WORDS = 13, DISPLAY_WORDS = 24;
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
  private readonly composite: EnemyMeshGpu;
  private readonly groups = new Map<string, Group>();
  private readonly prepared = new Map<string, number>();
  private readonly active = new Set<EnemyEntity>();
  private readonly assignments = new Map<EnemyEntity, number>();
  private readonly free = Array.from({ length: CAPACITY }, (_, i) => CAPACITY - 1 - i);
  private readonly displayData = new Float32Array(CAPACITY * DISPLAY_WORDS);
  private readonly matrix = new Float32Array(16);
  private readonly bounds = [0, 0, 1, 1];
  private readonly sun = [0, -Math.SQRT1_2, Math.SQRT1_2];
  private readonly view = createVisibleWorldView();
  private readonly grid = [COLUMNS, CAPACITY / COLUMNS];
  private readonly programNames: string[] = [];
  private strength = 0;
  private count = 0;
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
      for (const group of this.groups.values()) if (group.count && this.strength > 0) {
        if (group.gpu.draw(context, group.data.subarray(0, group.count * MASK_WORDS), group.count, [], set => {
          set('uSun', this.sun); set('uGrid', this.grid);
        })) { this.draws++; this.triangles += group.gpu.indexCount / 3 * group.count; }
      }
    };
    const blur = (axis: number) => (set: (name: string, value: unknown) => void) => {
      set('uMask', 0); set('uGrid', this.grid); set('uTexel', [1 / this.width, 1 / this.height]);
      set('uStep', axis === 0 ? [1 / this.width, 0] : [0, 1 / this.height]);
    };
    this.horizontal = new SunRenderTarget(scene, 'EnemyMeshBlurH', ENEMY_MESH_BLUR, blur(0), [this.raw.shader.texture!]);
    this.blurred = new SunRenderTarget(scene, 'EnemyMeshBlurV', ENEMY_MESH_BLUR, blur(1), [this.horizontal.shader.texture!]);
    const name = sunShaderName('EnemyMeshComposite'); this.programNames.push(name);
    this.composite = new EnemyMeshGpu(this.renderer, name, ENEMY_MESH_DISPLAY_VERTEX, ENEMY_MESH_DISPLAY_FRAGMENT,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2, new Uint16Array([0, 1, 2, 0, 2, 3]),
      ['inBounds', 'inTileAlpha', 'inFoot0', 'inFoot1', 'inFoot2', 'inFoot3'].map(name => ({ name, size: 4 })), CAPACITY);
    // Display-list entry delegates to the instanced composite; no per-enemy objects/filters.
    const displayName = sunShaderName('EnemyMeshDisplayEntry');
    this.display = new Phaser.GameObjects.Shader(scene, { name: displayName, shaderName: displayName, fragmentSource: CHARACTER_MESH_MASK }, 0, 0, 1, 1);
    ownSunShader(this.display, displayName);
    const owner = this;
    this.display.renderNode.run = function(context, object, parent): void {
      runWithScopedBlend(this, () => owner.drawComposite(context), context, Phaser.BlendModes.MULTIPLY, object, parent);
    };
    this.display.setDepth(ENEMY_SHADOW_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false).setName('enemy-mesh-shadows');
    scene.add.existing(this.display); registerGraphicsObject(scene, 'dynamicShadows', this.display);
    const projectionName = sunShaderName('EnemyMeshProjection'); this.programNames.push(projectionName);
    this.projectionProbe = new EnemyMeshGpu(this.renderer, projectionName, ENEMY_MESH_VERTEX, CHARACTER_MESH_MASK,
      new Float32Array([0, 0, 0]), 3, new Uint16Array([0, 0, 0]), MASK_ATTRIBUTES, 1);
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
      if (target.shader.renderNode.programManager.getCurrentProgramSuite()) this.warmupStep++;
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
  sync(enemies: readonly EnemyEntity[], visible: boolean): void {
    if (this.destroyed) return;
    const start = performance.now(); this.active.clear(); this.count = this.draws = this.triangles = 0;
    this.display.setVisible(false); for (const group of this.groups.values()) group.count = 0;
    const types = new Set(enemies.filter(e => e.getHp() > 0).map(e => e.kind));
    this.assets.prefetch(types); this.assets.pump(this.scene.game.loop.frame);
    if (!this.preparePrograms()) { this.releaseUnseen(); return; }
    this.prepare(types);
    if (!visible) { this.releaseUnseen(); return; }
    const path = this.clouds.sunPath;
    for (let i = 0; i < 3; i++) this.sun[i] = path?.sun[i] ?? this.sun[i];
    this.strength = meshShadowOpacity(path?.strength ?? 0, path?.elevation ?? 0);
    const view = getVisibleWorldView(this.scene.cameras.main, this.view, 0);
    // Release dead, burrowed and departed entities before admitting replacements in a full atlas.
    const live = new Set(enemies);
    for (const [enemy, slot] of this.assignments) if (!live.has(enemy) || !this.eligible(enemy)) {
      this.assignments.delete(enemy); this.free.push(slot);
    }
    for (const enemy of enemies) {
      if (!this.eligible(enemy)) continue;
      const mesh = this.assets.ready.get(enemy.kind); if (!mesh || this.prepared.get(enemy.kind) !== mesh.asset.poses.length) continue;
      const s = enemy.sprite, pose = enemyMeshPose(s.frame.name, mesh); if (pose < 0) continue;
      enemyMeshMatrix(s, mesh.asset.coordinates.canvasWorldPx, this.matrix);
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
      this.active.add(enemy); this.writeInstance(mesh, pose, slot, s.alpha);
    }
    this.releaseUnseen();
    if (this.count) {
      this.raw.draw(this.width, this.height); this.horizontal.draw(this.width, this.height); this.blurred.draw(this.width, this.height);
      this.atlasAllocated = true;
      // Phaser culls the entry against the camera; its instance positions are already world-space.
      this.display.setPosition(view.x + view.width / 2, view.y + view.height / 2).setSize(view.width, view.height).setVisible(true);
    }
    this.cpuMs = performance.now() - start;
  }
  private eligible(enemy: EnemyEntity): boolean {
    const s = enemy.sprite;
    return s.active && s.visible && s.alpha > 0 && !!s.scaleX && !!s.scaleY && enemy.getHp() > 0 && !enemy.isBurrowed();
  }
  private releaseUnseen(): void {
    for (const [enemy, slot] of this.assignments) if (!this.active.has(enemy)) { this.assignments.delete(enemy); this.free.push(slot); }
  }
  private writeInstance(mesh: EnemyMeshData, pose: number, slot: number, alpha: number): void {
    const group = this.groups.get(`${mesh.asset.id}:${pose}`)!, m = this.matrix, b = this.bounds;
    const tx = slot % COLUMNS, ty = Math.floor(slot / COLUMNS), offset = group.count++ * MASK_WORDS;
    group.data.set([m[0], m[1], m[4], m[5], m[12], m[13], m[10], ...b, tx, ty], offset);
    const d = this.count++ * DISPLAY_WORDS;
    this.displayData.set([...b, tx, ty, alpha, 0], d);
    for (const [i, foot] of mesh.asset.contacts[pose].feet.entries()) {
      const p = foot.position;
      this.displayData.set([m[0] * p[0] + m[4] * p[1] + m[12], m[1] * p[0] + m[5] * p[1] + m[13],
        2.5 * m[10], foot.groundWeight], d + 8 + i * 4);
    }
  }
  private drawComposite(context: Phaser.Renderer.WebGL.DrawingContext): void {
    // Camera targets apply their viewport when composited, matching SpriteGPULayer's transform.
    const camera = context.camera!.getViewMatrix(!context.useCanvas); this.renderer.setProjectionMatrixFromDrawingContext(context);
    this.composite.draw(context, this.displayData.subarray(0, this.count * DISPLAY_WORDS), this.count,
      [this.blurred.shader.texture!.get().source.glTexture!, this.receiver.texture.get().source.glTexture!], set => {
        set('uProjectionMatrix', this.renderer.projectionMatrix.val);
        set('uViewMatrix', [camera.a, camera.b, 0, camera.c, camera.d, 0, camera.tx, camera.ty, 1]);
        set('uGrid', this.grid); set('uMask', 0); set('uReceiver', 1); set('uReceiverWorld', this.receiver.world);
        set('uStrength', this.strength); setCloudUniforms(set, this.clouds);
      });
  }
  handles(enemy: EnemyEntity): boolean { return this.active.has(enemy); }
  get activeCount(): number { return this.count; }
  setVisible(value: boolean): void { this.display.setVisible(value && this.count > 0); }
  inspect() { return { activeInstances: this.count, allocatedSlots: this.assignments.size, tileSize: this.tileSize,
    prepared: Object.fromEntries(this.prepared), assets: this.assets.inspect(), costs: { cpuMs: this.cpuMs,
      geometryDraws: this.draws, triangles: this.triangles, targetPasses: this.count ? 3 : 0,
      targetBytes: this.atlasAllocated ? this.width * this.height * 4 * 3 : 3 * 3 * 4 * 3,
      targetPixelBudget: this.width * this.height * 3,
      geometryBytes: [...this.groups.values()].reduce((n, g) => n + g.gpu.bytes, this.composite.bytes + this.projectionProbe.bytes),
      stencilBytes: (this.renderer.config as { stencil?: boolean } | undefined)?.stencil ? (this.atlasAllocated ? this.width * this.height : 9) * 3 : 0,
      uploadedBytes: this.count * (MASK_WORDS + DISPLAY_WORDS) * 4, gpuMs: null } }; }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    this.releaseWarmup(); this.projectionProbe.destroy();
    this.display.destroy(); this.composite.destroy(); for (const g of this.groups.values()) g.gpu.destroy();
    this.groups.clear(); this.assignments.clear(); this.active.clear();
    this.blurred.destroy(); this.horizontal.destroy(); this.raw.destroy();
    const programs = this.renderer.shaderProgramFactory.programs as Record<string, Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>;
    for (const key of Object.keys(programs)) if (this.programNames.some(n => key === n || key.startsWith(n + '_'))) {
      this.renderer.deleteProgram(programs[key]); delete programs[key];
    }
    // Receiver lifetime belongs exclusively to CharacterMeshShadowRenderer.
  }
}
