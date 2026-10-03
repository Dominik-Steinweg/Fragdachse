import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from '../../effects/sunlight/cloudShadow';
import * as Phaser from 'phaser';
import { HORIZON_BLEND_GLSL } from './FormationHorizonTransition';
import { FORMATION, FORMATION_SIDE } from './RockFormationField';
import { FORMATION_RESPONSE_GLSL, MINERAL_CAVITY_GLSL } from './rockFormationShader';

/** Borrowed textures and mutable uniforms. The formation remains their sole owner. */
export interface FormationReceiverBinding {
  field: Phaser.Textures.Texture;
  lookup: Phaser.Textures.Texture;
  occlusion: Phaser.Textures.Texture;
  mineralHeight?: Phaser.Textures.Texture;
  frame: [number, number, number, number];
  sun: [number, number, number];
  options: [number, number, number, number];
  mineralResponse?: boolean;
  fineMineral?: boolean;
  clouds?: SunCloudState;
  horizonPrevious?: Phaser.Textures.Texture;
  horizonBlend?: Float32Array;
}
export type FormationReceiverProvider = () => FormationReceiverBinding | null;

export const FOLIAGE_HEADER = `
uniform sampler2D uFoliageField, uFoliageLookup, uFoliageOcclusion;
uniform vec4 uFoliageFrame, uFoliageChunk, uFoliageUV, uFoliageOptions;
uniform vec3 uFoliageSun;
${FORMATION_RESPONSE_GLSL}
${MINERAL_CAVITY_GLSL}
${HORIZON_BLEND_GLSL}
${CLOUD_SHADOW_GLSL}
vec3 foliageSample(vec2 world, bool centre, out vec3 surface, out float coverage) {
  surface=vec3(1.0);coverage=0.0;
  vec2 local = world-uFoliageFrame.xy;
  if (min(local.x,local.y)<0.0 || local.x>=uFoliageFrame.z || local.y>=uFoliageFrame.w) return vec3(1.0);
  vec2 cell = floor(local/${FORMATION.chunk}.0);
  vec2 lookupSize = ceil(uFoliageFrame.zw/${FORMATION.chunk}.0);
  float slot = floor(texture2D(uFoliageLookup,(cell+.5)/lookupSize).r*255.0+.5)-1.0;
  if (slot<0.0) return vec3(1.0);
  vec2 atlas = vec2(${FORMATION.atlasColumns}.0,${FORMATION.atlasRows}.0);
  vec2 uv = (vec2(mod(slot,atlas.x),floor(slot/atlas.x))*${FORMATION_SIDE}.0
    + mod(local,${FORMATION.chunk}.0)/${FORMATION.step}.0+${FORMATION.gutter}.0)/(atlas*${FORMATION_SIDE}.0);
  vec4 field = texture2D(uFoliageField,uv);
  vec4 shelter = texture2D(uFoliageOcclusion,uv);
  vec4 horizons=blendHorizons(vec4(field.b,shelter.gba),uv,slot);
  field.b=horizons.r;shelter.gb=horizons.gb;shelter.a=horizons.a;
  vec2 xy = field.rg*2.0-1.0;
  vec3 mineralNormal = normalize(vec3(xy,sqrt(max(.001,1.0-dot(xy,xy)))));
  // Overhanging leaves present many orientations. Colonies resting on mineral
  // inherit its full directional form light, including the lip and cavities.
  vec3 normal = normalize(mix(vec3(0.0,0.0,1.0),mineralNormal,.34));
  vec4 options=uFoliageOptions;options.x*=cloudFormStrength(world);
  if(centre) {
    coverage=field.a;
    surface=formationResponse(mineralNormal,field.b*1.570796327,
      vec4(shelter.r,shelter.gb*1.570796327,shelter.a),uFoliageSun,options,0.0);
    if(uFineMineral>.5 && options.z>.5) surface*=mineralCavity(local);
    if(coverage>=1.0) return surface;
  }
  return formationResponse(normal,field.b*1.570796327,
    vec4(shelter.r,shelter.gb*1.570796327,shelter.a),uFoliageSun,options,0.0);
}
vec3 foliageResponse(vec2 world) {
  vec3 surface,unusedSurface;float coverage,unusedCoverage;
  vec3 broad=foliageSample(world,true,surface,coverage);
  if(coverage>=1.0) return surface;
  broad*=.4;
  broad+=foliageSample(world+vec2(12.0,0.0),false,unusedSurface,unusedCoverage)*.15;
  broad+=foliageSample(world-vec2(12.0,0.0),false,unusedSurface,unusedCoverage)*.15;
  broad+=foliageSample(world+vec2(0.0,12.0),false,unusedSurface,unusedCoverage)*.15;
  broad+=foliageSample(world-vec2(0.0,12.0),false,unusedSurface,unusedCoverage)*.15;
  // Coverage selects form light, never opacity: one PMA colony draw across the
  // mineral contour. Sun-facing lips keep full form response; backfaces receive
  // the same shadow/sky response as the stone beneath, not an unlit alpha gap.
  return mix(broad,surface,coverage);
}
`;
export const ROCK_FOLIAGE_MATERIAL = { name: 'RockFoliageSingleCoverage', additions: {
  fragmentHeader: FOLIAGE_HEADER,
  fragmentProcess: `
    if (fragColor.a > 0.0) {
      vec2 foliageWorld = uFoliageChunk.xy+(outTexCoord-uFoliageUV.xy)/uFoliageUV.zw*uFoliageChunk.zw;
      fragColor.rgb *= foliageResponse(foliageWorld);
    }
  `,
} };

let nextId = 0;

/** A shared material on the existing chunk quads, with no filter framebuffer.
 * Alpha is untouched: only leaf pixels receive light, including their overhang.
 * Default rendering is restored whenever the opt-in formation is unavailable. */
export class RockFoliageLighting {
  private readonly textures = new Set<Phaser.GameObjects.RenderTexture>();
  private provider: FormationReceiverProvider | null = null;
  private batch: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle | null = null;
  private submitter: Phaser.Renderer.WebGL.RenderNodes.RenderNode | null = null;
  private binding: FormationReceiverBinding | null = null;
  private currentTexture: Phaser.GameObjects.RenderTexture | null = null;
  private disposed = false;
  private readonly chunk = [0, 0, 0, 0];
  private readonly uv = [0, 0, 0, 0];
  private readonly neutralHorizonBlend = new Float32Array(64).fill(1);

  constructor(private readonly scene: Phaser.Scene) {}

  attach(texture: Phaser.GameObjects.RenderTexture): void {
    if (this.disposed || this.textures.has(texture)) return;
    this.textures.add(texture);
    if (this.submitter && this.provider) texture.setRenderNodeRole('Submitter', this.submitter);
  }

  setProvider(provider: FormationReceiverProvider | null): void {
    if (this.disposed) return;
    this.provider = provider;
    if (provider && !this.submitter) this.createNodes();
    if (this.submitter) for (const texture of this.textures) {
      if (texture.active) texture.setRenderNodeRole('Submitter', provider ? this.submitter : null);
    }
    if (!provider) this.binding = null;
  }

  private resolveBinding(): FormationReceiverBinding | null {
    let binding: FormationReceiverBinding | null;
    try { binding = this.provider?.() ?? null; } catch { return null; }
    if (!binding || binding.options[1] > .5) return null;
    for (const texture of [binding.field, binding.lookup, binding.occlusion]) {
      if (!texture?.source?.[0]?.glTexture?.webGLTexture) return null;
    }
    return binding;
  }

  private createNodes(): void {
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer.gl || renderer.maxTextures < 6) return;
    const manager = renderer.renderNodes, name = `RockFoliage${nextId++}`;
    const batch = new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(manager, { name });
    this.batch = batch;
    // ProgramFactory owns programs by shader/addition names. Keep the material
    // key stable across World lifetimes; only its per-node VAO/buffers are ours.
    batch.programManager.addAddition(ROCK_FOLIAGE_MATERIAL);
    const setCloud=(name:string,value:unknown)=>batch.programManager.setUniform(name,value);
    const setup = batch.setupUniforms;
    batch.setupUniforms = (context): void => {
      setup.call(batch, context);
      const binding = this.binding, texture = this.currentTexture;
      if (!binding || !texture) return;
      // Read live frame/position, never allocation-time coordinates: the chunk
      // pool reuses these targets at different positions and clipped edge sizes.
      const frame = texture.frame;
      this.chunk[0] = texture.x; this.chunk[1] = texture.y;
      this.chunk[2] = frame.cutWidth; this.chunk[3] = frame.cutHeight;
      this.uv[0] = frame.u0; this.uv[1] = frame.v0;
      this.uv[2] = frame.u1-frame.u0; this.uv[3] = frame.v1-frame.v0;
      setCloudUniforms(setCloud,binding.clouds);
      const programs = batch.programManager;
      programs.setUniform('uFoliageFrame', binding.frame);
      programs.setUniform('uFoliageSun', binding.sun);
      programs.setUniform('uFoliageOptions', binding.options);
      programs.setUniform('uMineralResponse', Number(binding.mineralResponse===true));
      programs.setUniform('uFineMineral', Number(binding.fineMineral===true));
      programs.setUniform('uFoliageChunk', this.chunk);
      programs.setUniform('uFoliageUV', this.uv);
      programs.setUniform('uFoliageField', 1);
      programs.setUniform('uFoliageLookup', 2);
      programs.setUniform('uFoliageOcclusion', 3);
      programs.setUniform('uMineralHeight', 4);
      programs.setUniform('uHorizonPrevious',5);
      programs.setUniform('uHorizonBlend[0]',binding.horizonBlend??this.neutralHorizonBlend);
      renderer.glTextureUnits.bind((binding.horizonPrevious??binding.field).source[0].glTexture,5);
      renderer.glTextureUnits.bind(binding.field.source[0].glTexture, 1);
      renderer.glTextureUnits.bind(binding.lookup.source[0].glTexture, 2);
      renderer.glTextureUnits.bind(binding.occlusion.source[0].glTexture, 3);
      renderer.glTextureUnits.bind((binding.mineralHeight??binding.field).source[0].glTexture, 4);
      // Bind a valid neutral-path texture even when the optional mask has gone
      // away. The zero-strength shader branch performs no transmission lookup.
    };
    const submitter = new Phaser.Renderer.WebGL.RenderNodes.RenderNode(`${name}Submitter`, manager);
    this.submitter = submitter;
    submitter.run = (...args: Parameters<Phaser.Renderer.WebGL.RenderNodes.SubmitterQuad['run']>): void => {
      const texture = args[1] as Phaser.GameObjects.RenderTexture;
      // RenderTexture delegates to ImageWebGLRenderer, whose default role is
      // SubmitterQuad; Phaser's declaration leaves the role map as bare object.
      const fallback = (texture.defaultRenderNodes as {
        Submitter: Phaser.Renderer.WebGL.RenderNodes.SubmitterQuad;
      }).Submitter;
      const binding = this.resolveBinding();
      if (!binding) { fallback.run(...args); return; }
      // One shared material, one draw per visible chunk. Immediate submission
      // keeps per-chunk uniforms correct and reserves texture units 1–4.
      manager.finishBatch();
      this.binding = binding;
      this.currentTexture = texture;
      texture.setRenderNodeRole('BatchHandler', batch);
      try {
        fallback.run(...args);
        manager.finishBatch();
      } finally {
        texture.setRenderNodeRole('BatchHandler', null);
        this.binding = null;
        this.currentTexture = null;
      }
    };
  }

  destroy(): void {
    if (this.disposed) return;
    this.setProvider(null);
    this.disposed = true;
    this.textures.clear();
    const batch = this.batch;
    if (!batch) return;
    const manager = batch.manager, renderer = manager.renderer;
    if (manager.currentBatchNode === batch) manager.finishBatch();
    // 4.2.1 RenderNodeManager extends eventemitter3 in source, but its public
    // declaration omits that inheritance. Match the base BatchHandler listener.
    (manager as unknown as Phaser.Events.EventEmitter).off(
      Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, batch.updateTextureCount, batch,
    );
    renderer.off(Phaser.Renderer.Events.RESIZE, batch.resize, batch);
    for (const suite of Object.values(batch.programManager.programs)) {
      Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao);
      suite.vao.destroy();
    }
    batch.programManager.programs = {};
    renderer.deleteBuffer(batch.vertexBufferLayout.buffer);
    renderer.deleteBuffer(batch.indexBuffer);
    this.batch = null;
    this.submitter = null;
  }
}
