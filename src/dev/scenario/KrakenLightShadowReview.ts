import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { ShadowSystem } from '../../effects/ShadowSystem';
import type { WorldSunlightPresentation } from '../../effects/sunlight/WorldSunlightPresentation';
import { createKrakenResidencyPort, type KrakenPreparedPage } from '../../effects/kraken/KrakenAssetResidency';
import { KrakenSubmersion, krakenMaterialExposure } from '../../effects/kraken/submersionShader';
import { KrakenShadowRenderer } from '../../effects/kraken/KrakenShadowRenderer';
import { KRAKEN_PACKED_NORMAL_ENCODING, type KrakenShadowMesh } from '../../effects/kraken/KrakenLightShadowModel';
import { getGraphicsQualityController, type GraphicsQuality } from '../../graphics/GraphicsQuality';

interface Page { frameNames?: string[]; image: string; json: string; sha256: string; jsonSha256: string; width: number; height: number; gpuBytes: number }
interface BufferSpec { file: string; bytes: number; sha256: string }
interface Pose { frameName?: string; name: string; sourceFrame: number; gpuBytes: number; passes: Record<'color' | 'beauty' | 'elevation' | 'emission', Page>;
  mesh: { vertexCount: number; triangleCount: number; bounds: { min: number[]; max: number[] }; positions: BufferSpec; indices: BufferSpec } }
interface Asset { id: string; role: 'water' | 'land' | 'tentacle' | 'egg'; encoding: string; colorPass: string; emissionEncoding: string; size: number;
  tint?: number[]; saturation?: number; canvasWorld: number; worldPxPerBU: number; emissionRange: number; heightRange: [number, number]; pivot: [number, number]; poses: Pose[];
  exposureCalibration: { suggested: number } }
export interface KrakenLightShadowOptions { pilot: string; pose: string; azimuth: number; elevation: number; night: boolean;
  shore: boolean; quality: GraphicsQuality; exposure: number | null }
const defaults: KrakenLightShadowOptions = { pilot: 'kraken-ls-pilot-2', pose: 'abyssal-kraken-land/idle-0', azimuth: 0,
  elevation: 45, night: false, shore: false, quality: 'high', exposure: null };
export function krakenLightShadowOptions(raw: Record<string, unknown>, previous = defaults): KrakenLightShadowOptions {
  const o = { ...previous };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'action') continue;
    if (!(key in defaults)) throw Error(`Unknown lighting pilot option: ${key}`);
    Object.assign(o, { [key]: value });
  }
  if (!/^(?:kraken-ls-pilot-\d+|kraken-v\d+)$/.test(o.pilot) || !/^abyssal-kraken(?:-land|-tentacle|-egg)?\/[\w-]+$/.test(o.pose)) throw Error('Invalid pilot/pose');
  if (![o.azimuth, o.elevation].every(Number.isFinite) || o.elevation <= 0 || o.elevation > 90
    || o.exposure !== null && (!Number.isFinite(o.exposure) || o.exposure <= 0 || o.exposure > 4)) throw Error('Invalid light/exposure');
  if (typeof o.night !== 'boolean' || typeof o.shore !== 'boolean' || !['high','medium','low'].includes(o.quality)) throw Error('Invalid quality/shore/night');
  return o;
}
let serial = 0;
/** Opt-in pilot within krakenReview. Only one selected pose is resident; Beauty is explicit review overhead. */
export class KrakenLightShadowReview {
  private abort = new AbortController();
  private keys: string[] = [];
  private prepared: KrakenPreparedPage[] = [];
  private views: { sprite: Phaser.GameObjects.Sprite; submersion: KrakenSubmersion; shadow: KrakenShadowRenderer }[] = [];
  private mesh: KrakenShadowMesh | null = null;
  private asset: Asset | null = null;
  private pose: Pose | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private disposed = false;
  private pagesBytes = 0;
  private knownGpuPeakBytes = 0;
  private priorQuality: GraphicsQuality | undefined;
  readonly focus: { x: number; y: number };
  constructor(private readonly scene: Phaser.Scene, public options: KrakenLightShadowOptions,
    private readonly shadowSystem: ShadowSystem, private readonly sunlight: WorldSunlightPresentation,
    private readonly center: { x: number; y: number }, private readonly shore: { x: number; y: number },
    private readonly waterAt: (x: number, y: number) => number) { this.focus = { ...center }; }
  async initialize(): Promise<void> {
    this.priorQuality = getGraphicsQualityController(this.scene)?.getLevel();
    const root = `/art/poc/pipeline-v2/runs/${this.options.pilot}/`;
    const response = await fetch(root + 'ls-pilot.json', { signal: this.abort.signal });
    if (!response.ok) throw Error('Lighting pilot not exported: ' + response.status);
    const manifest = await response.json() as { version: number; assets: Asset[] };
    const [id, name] = this.options.pose.split('/'), asset = manifest.assets.find(a => a.id === id), pose = asset?.poses.find(p => p.name === name);
    if (manifest.version !== 1 || !asset || !pose || asset.encoding !== KRAKEN_PACKED_NORMAL_ENCODING
      || asset.colorPass !== 'srgb-albedo-baked-cavity-v1' || asset.emissionEncoding !== 'linear-rgb-unorm8-scaled-v1') throw Error('Unsupported/incomplete lighting pilot contract');
    this.asset = asset; this.pose = pose;
    const base = root + id + '/standard/', port = createKrakenResidencyPort(this.scene, error => { throw Error(error.message); });
    for (const pass of ['color', 'elevation', 'emission', 'beauty'] as const) {
      const p = pose.passes[pass];
      const prepared = await port.prepare({ ...p, image: base + p.image, json: base + p.json,
        gpuBytesRGBA8: p.gpuBytes, frameNames: p.frameNames ?? [pose.name] }, this.abort.signal);
      if (this.disposed) { prepared.dispose(); throw Error('Pilot disposed'); }
      this.prepared.push(prepared);
      const key = `kraken-light-pilot-${serial++}`; this.keys.push(key); prepared.register(key); this.pagesBytes += p.gpuBytes;
    }
    const load = async (spec: BufferSpec) => {
      const r = await fetch(base + spec.file, { signal: this.abort.signal }); if (!r.ok) throw Error('Missing pilot mesh');
      const b = await r.arrayBuffer(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(v => v.toString(16).padStart(2,'0')).join('');
      if (b.byteLength !== spec.bytes || hash !== spec.sha256) throw Error('Pilot mesh hash/bytes mismatch'); return b;
    };
    const [positions, indices] = await Promise.all([load(pose.mesh.positions), load(pose.mesh.indices)]);
    if (this.disposed) throw Error('Pilot disposed');
    const packed = new DataView(positions), p = new Float32Array(pose.mesh.vertexCount * 3), b = pose.mesh.bounds;
    if (positions.byteLength !== p.length * 2 || indices.byteLength !== pose.mesh.triangleCount * 6) throw Error('Pilot mesh geometry mismatch');
    for (let i = 0; i < p.length; i++) p[i] = b.min[i % 3] + packed.getUint16(i * 2, true) / 65535 * (b.max[i % 3] - b.min[i % 3]);
    const ix = new Uint16Array(indices); if (ix.some(i => i >= pose.mesh.vertexCount) || p.some(v => !Number.isFinite(v))) throw Error('Invalid pilot geometry');
    this.mesh = { id: this.options.pose, positions: p, indices: ix, bounds: b };
    const frameName = pose.frameName ?? name;
    const elevation = this.scene.textures.getFrame(this.keys[1], frameName);
    for (const [i,key] of [this.keys[3],this.keys[0]].entries()) {
      const sprite = this.scene.add.sprite(0,0,key,frameName).setDepth(DEPTH.PLAYERS).setOrigin(...asset.pivot).setDisplaySize(asset.canvasWorld,asset.canvasWorld);
      const submersion = new KrakenSubmersion(sprite,elevation,{min:asset.heightRange[0],max:asset.heightRange[1]},this.waterAt,1);
      if (i === 1) submersion.filter.material = { clouds: this.sunlight.clouds, emission: this.scene.textures.getFrame(this.keys[2],frameName), emissionRange: asset.emissionRange, tint: asset.tint, saturation: asset.saturation, highlightRollOff: asset.role !== 'egg', highlightRole: asset.role === 'tentacle' ? 'tentacle' : 'body' };
      this.views.push({ sprite, submersion, shadow: new KrakenShadowRenderer(this.scene,this.shadowSystem) });
      this.labels.push(this.scene.add.text(0,0,i===0?'Beauty (gleiche Pose)':'Albedo + Normal + Emission',{fontSize:'14px',color:'#ffffff',backgroundColor:'#16201f'}).setDepth(DEPTH.PLAYERS+1).setOrigin(.5));
    }
    this.configure(this.options);
    this.scene.events.on('postupdate',this.update,this);
  }
  configure(options: KrakenLightShadowOptions): void {
    this.options = options;
    getGraphicsQualityController(this.scene)?.setLevel(options.quality);
    this.sunlight.setFigureReviewSun({azimuth:options.azimuth,elevation:options.elevation,strength:options.night?0:1});
    const location = options.shore ? this.shore : this.center;
    Object.assign(this.focus, location); this.update();
  }
  private update(): void {
    if (this.disposed || !this.asset || !this.pose || !this.mesh) return;
    const asset = this.asset, level = asset.role === 'water' ? .38 : 0;
    for (const [i,v] of this.views.entries()) {
      v.sprite.setPosition(this.focus.x+(i-.5)*(asset.canvasWorld+70),this.focus.y);
      v.submersion.filter.params.exposure = i===1?(this.options.exposure??krakenMaterialExposure(asset.id,asset.exposureCalibration.suggested)):asset.role==='water'?.55:1;
      v.submersion.update(this.scene.textures.getFrame(this.keys[1],this.pose.frameName ?? this.pose.name),level,0);
      v.shadow.update(v.sprite,this.mesh,asset.canvasWorld,asset.worldPxPerBU,level,asset.role);
      this.labels[i].setPosition(v.sprite.x,v.sprite.y-asset.canvasWorld*.5-18);
    }
    this.knownGpuPeakBytes = Math.max(this.knownGpuPeakBytes, this.knownGpuBytes());
  }
  private knownGpuBytes(): number { return this.pagesBytes + this.views.reduce((sum,v)=>sum+v.shadow.gpuBytes+128*128*4,0); }
  status() { return { options:this.options,pose:this.pose?.sourceFrame,encoding:this.asset?.encoding,
    pagesBytes:this.pagesBytes,reviewOnlyBeautyBytes:this.pose?.passes.beauty.gpuBytes??0,
    knownGpuBytes:this.knownGpuBytes(),knownGpuPeakBytes:this.knownGpuPeakBytes,
    accountingExcludes:'shared Phaser filter pool, existing World receiver, driver padding',
    materialExposure:this.options.exposure??(this.asset ? krakenMaterialExposure(this.asset.id,this.asset.exposureCalibration.suggested) : undefined),
    cpuMeshBytes:(this.mesh?.positions.byteLength??0)+(this.mesh?.indices.byteLength??0),
    shadows:this.views.map(v=>v.shadow.inspect()),focus:this.focus,ready:this.views.length===2 }; }
  destroy(): void {
    if(this.disposed)return;this.disposed=true;this.abort.abort();this.scene.events.off('postupdate',this.update,this);
    for(const v of this.views){v.shadow.destroy();v.submersion.destroy();v.sprite.destroy();}this.views=[];
    for(const label of this.labels)label.destroy();this.labels=[];
    for(const key of this.keys)if(this.scene.textures.exists(key))this.scene.textures.remove(key);this.keys=[];
    for(const p of this.prepared)p.dispose();this.prepared=[];
    if(this.priorQuality)getGraphicsQualityController(this.scene)?.setLevel(this.priorQuality);
    this.sunlight.setFigureReviewSun(null);this.mesh=null;
  }
}
