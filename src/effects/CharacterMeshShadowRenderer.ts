import * as Phaser from 'phaser';
import type { PlayerEntity } from '../entities/PlayerEntity';
import type { CharacterMeshData } from '../assets/CharacterMeshAssets';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { runWithScopedBlend } from '../graphics/PhaserScopedBlend';
import { CharacterMeshProjector } from './CharacterMeshProjector';
import { bodyMeshMatrix, extendMeshBounds, meshForHeldTexture, meshPose, meshShadowOpacity, meshShadowSoftness, weaponMeshMatrix } from './CharacterMeshModel';
import { CHARACTER_MESH_BLUR, CHARACTER_MESH_COMPOSITE, CHARACTER_MESH_MASK } from './characterMeshShaders';
import { CharacterShadowReceiver } from './CharacterShadowReceiver';
import { CHARACTER_SHADOW_CONFIG as config } from './ShadowConfig';
import { ownSunShader, SunRenderTarget, sunShaderName } from './sunlight/SunRenderTarget';
import { cloudDirectFactor, setCloudUniforms, type SunCloudState } from './sunlight/cloudShadow';
import { cloudShadowAt } from './sunlight/SunFieldModel';
import { registerGraphicsObject } from './EffectUtils';

/** Three reusable RGBA8 targets per visible player, no per-frame target allocation. */
class MeshSlot {
  readonly raw: SunRenderTarget;
  readonly horizontal: SunRenderTarget;
  readonly blurred: SunRenderTarget;
  readonly shader: Phaser.GameObjects.Shader;
  readonly bounds = [0, 0, 1, 1];
  readonly body = [0, 0, config.contactRadiusX as number, config.contactRadiusY as number];
  readonly inverse = [1, 0, 0, 1];
  readonly strength = [0, config.contactOpacity as number, 1, 0];
  readonly sun = [0, -1, 1];
  readonly model = new Float32Array(16);
  readonly weaponModel = new Float32Array(16);
  private readonly horizontalStep = [0, 0];
  private readonly verticalStep = [0, 0];
  weapon: CharacterMeshData | undefined;
  pose = 0;
  seen = false;
  solid = false;
  drawSubmissions = 0;
  constructor(scene: Phaser.Scene, readonly index: number, private readonly size: number,
    private readonly meshes: ReadonlyMap<string, CharacterMeshData>, private readonly projector: CharacterMeshProjector,
    private readonly clouds: SunCloudState, receiver: CharacterShadowReceiver) {
    this.raw = new SunRenderTarget(scene, 'CharacterMeshMask', CHARACTER_MESH_MASK, () => {});
    const context = this.raw.shader.drawingContext!;
    context.setAutoClear(true, false, false); context.setClearColor(0, 0, 0, 0);
    this.raw.shader.renderNode.run = context => {
      if (this.strength[0] <= 0 && !this.solid) return;
      projector.draw(context, meshes.get('badger')!, this.pose, this.model, this.bounds, this.sun);
      if (this.weapon) projector.draw(context, this.weapon, 0, this.weaponModel, this.bounds, this.sun);
    };
    this.horizontal = new SunRenderTarget(scene, 'CharacterMeshBlurH', CHARACTER_MESH_BLUR,
      set => { set('uMask', 0); set('uStep', this.horizontalStep); }, [this.raw.shader.texture!]);
    this.blurred = new SunRenderTarget(scene, 'CharacterMeshBlurV', CHARACTER_MESH_BLUR,
      set => { set('uMask', 0); set('uStep', this.verticalStep); }, [this.horizontal.shader.texture!]);
    const name = sunShaderName('CharacterMeshDisplay');
    this.shader = new Phaser.GameObjects.Shader(scene, { name, shaderName: name,
      fragmentSource: CHARACTER_MESH_COMPOSITE, setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uMask', 0); set('uReceiver', 1); set('uBounds', this.bounds); set('uBody', this.body);
        set('uBodyInverse', this.inverse); set('uStrength', this.strength); set('uReceiverWorld', receiver.world);
        set('uDebugSolid', Number(this.solid)); setCloudUniforms(set, clouds);
      } }, 0, 0, 1, 1, [this.blurred.shader.texture!, receiver.texture]);
    ownSunShader(this.shader, name);
    this.shader.setDepth(config.depth).setVisible(false);
    const node = this.shader.renderNode, run = node.run, slot = this;
    node.run = function(context, object, parent): void {
      runWithScopedBlend(this, run, context, slot.solid ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.MULTIPLY, object, parent);
      slot.drawSubmissions++;
    };
    scene.add.existing(this.shader); registerGraphicsObject(scene, 'dynamicShadows', this.shader);
  }
  update(player: PlayerEntity): number {
    const sprite = player.displayObject!, path = this.clouds.sunPath;
    this.pose = meshPose(sprite.frame.name); bodyMeshMatrix(sprite, this.model);
    this.body[0] = this.model[12]; this.body[1] = this.model[13];
    const det = this.model[0] * this.model[5] - this.model[1] * this.model[4];
    this.inverse[0] = this.model[5] / det; this.inverse[1] = -this.model[4] / det;
    this.inverse[2] = -this.model[1] / det; this.inverse[3] = this.model[0] / det;
    for (let i = 0; i < 3; i++) this.sun[i] = path?.sun[i] ?? [0, -Math.SQRT1_2, Math.SQRT1_2][i];
    this.strength[0] = meshShadowOpacity(path?.strength ?? 0, path?.elevation ?? 0);
    this.strength[2] = sprite.alpha;
    const weapon = player.getHeldItemDisplayObject();
    const spec = weapon?.active && weapon.visible && weapon.alpha > 0 && weapon.scaleX && weapon.scaleY
      ? meshForHeldTexture.get(weapon.texture.key) : undefined;
    this.weapon = spec ? this.meshes.get(spec.id) : undefined;
    if (this.weapon && weapon) weaponMeshMatrix(weapon, sprite, this.weaponModel);
    const scale = this.model[10];
    const radiusX = Math.hypot(this.model[0] * config.contactRadiusX, this.model[4] * config.contactRadiusY);
    const radiusY = Math.hypot(this.model[1] * config.contactRadiusX, this.model[5] * config.contactRadiusY);
    const b = this.bounds;
    b[0] = this.body[0] - radiusX; b[1] = this.body[1] - radiusY;
    b[2] = this.body[0] + radiusX; b[3] = this.body[1] + radiusY;
    if (this.strength[0] > 0 || this.solid) {
      extendMeshBounds(b, this.meshes.get('badger')!.spec, this.model, this.sun);
      if (this.weapon) extendMeshBounds(b, this.weapon.spec, this.weaponModel, this.sun);
    }
    // Larger penumbra at low sun. Four kernel steps of transparent gutter prevent edge clamping.
    const softness = meshShadowSoftness(scale, this.sun[2]), pad = softness * 4 + 1;
    b[2] = b[2] - b[0] + 2 * pad; b[3] = b[3] - b[1] + 2 * pad;
    b[0] -= pad; b[1] -= pad;
    this.horizontalStep[0] = softness / b[2]; this.verticalStep[1] = softness / b[3];
    this.raw.draw(this.size, this.size);
    let passes = 1;
    if (!this.solid && this.strength[0] > 0) { this.horizontal.draw(this.size, this.size); this.blurred.draw(this.size, this.size); passes += 2; }
    this.shader.textures[0] = this.solid || this.strength[0] <= 0 ? this.raw.shader.texture! : this.blurred.shader.texture!;
    this.shader.setPosition(b[0] + b[2] / 2, b[1] + b[3] / 2).setSize(b[2], b[3]).setOrigin(.5).setVisible(true);
    return passes;
  }
  destroy(): void { this.shader.destroy(); this.blurred.destroy(); this.horizontal.destroy(); this.raw.destroy(); }
}

export class CharacterMeshShadowRenderer {
  private readonly assignments = new Map<PlayerEntity, MeshSlot>();
  private readonly pool: MeshSlot[] = [];
  private readonly projector: CharacterMeshProjector;
  private readonly view = createVisibleWorldView();
  private solid = false;
  private cpuMs = 0;
  private targetPasses = 0;
  constructor(private readonly scene: Phaser.Scene, private readonly clouds: SunCloudState,
    readonly receiver: CharacterShadowReceiver, private readonly meshes: ReadonlyMap<string, CharacterMeshData>,
    private readonly targetSize: number) { this.projector = new CharacterMeshProjector(scene); }
  get count(): number { return this.pool.length; }
  get activeCount(): number { return this.pool.filter(slot => slot.shader.visible).length; }
  sync(players: readonly PlayerEntity[], visible: boolean): void {
    const start = performance.now(), view = getVisibleWorldView(this.scene.cameras.main, this.view, 220);
    this.projector.resetCosts(); this.targetPasses = 0;
    for (const [player] of this.assignments) if (!players.includes(player)) this.assignments.delete(player);
    for (const slot of this.pool) { slot.seen = false; slot.shader.setVisible(false); }
    for (const player of players) {
      const sprite = player.displayObject, phase = player.getBurrowPhase();
      if (!visible || !sprite?.active || !sprite.visible || sprite.alpha <= 0 || !sprite.scaleX || !sprite.scaleY
        || player.isDecoyStealthedVisual() || phase === 'underground' || phase === 'trapped'
        || sprite.x < view.x || sprite.y < view.y || sprite.x > view.right || sprite.y > view.bottom) continue;
      let slot = this.assignments.get(player);
      if (!slot) {
        const used = new Set(this.assignments.values());
        slot = this.pool.find(item => !used.has(item));
        if (!slot && this.pool.length < config.maxPlayers) {
          slot = new MeshSlot(this.scene, this.pool.length, this.targetSize, this.meshes, this.projector, this.clouds, this.receiver);
          this.pool.push(slot);
        }
        if (slot) this.assignments.set(player, slot);
      }
      if (slot) { slot.seen = true; slot.solid = this.solid; this.targetPasses += slot.update(player); }
    }
    this.cpuMs = performance.now() - start;
  }
  setVisible(value: boolean): void { for (const slot of this.pool) slot.shader.setVisible(value && slot.seen); }
  setDebugSolid(value: boolean): void { this.solid = value; for (const slot of this.pool) slot.solid = value; }
  inspect() {
    return { mode: 'mesh', activeInstances: this.activeCount, allocatedSlots: this.pool.length, targetSize: this.targetSize,
      costs: { cpuMs: this.cpuMs, geometryDraws: this.projector.draws, triangles: this.projector.triangles,
        uploadedBytes: this.projector.uploadedBytes, targetPasses: this.targetPasses,
        targetBytes: this.pool.length * this.targetSize ** 2 * 4 * 3,
        stencilBytes: ((this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).config as { stencil?: boolean }).stencil
          ? this.pool.length * this.targetSize ** 2 * 3 : 0, gpuMs: null },
      instances: [...this.assignments].map(([player, slot]) => {
        const cloud = cloudDirectFactor(cloudShadowAt(slot.body[0], slot.body[1], this.clouds), this.clouds.tuning.cloudDensity, this.clouds.strength);
        const receiver = this.receiver.sample(slot.body[0], slot.body[1]);
        return { playerId: player.id, slot: slot.index, pose: slot.pose, weapon: slot.weapon?.spec.id ?? null,
          sun: [...slot.sun], visible: slot.shader.visible, solid: slot.solid, depth: slot.shader.depth,
          bounds: [...slot.bounds], drawSubmissions: slot.drawSubmissions,
          coreDarkeningEstimate: slot.strength[0] * cloud * receiver * slot.strength[2] * (1 - .2126 * config.colour[0] - .7152 * config.colour[1] - .0722 * config.colour[2]),
          opacityAtBody: { direct: slot.strength[0], cloud, receiver, sprite: slot.strength[2], contact: slot.strength[1] } };
      }) };
  }
  destroy(): void {
    for (const slot of this.pool) slot.destroy(); this.pool.length = 0; this.assignments.clear();
    this.projector.destroy(); this.receiver.destroy();
  }
}
