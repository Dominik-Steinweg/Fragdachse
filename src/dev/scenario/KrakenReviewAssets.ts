import * as Phaser from 'phaser';

export interface ReviewAssetSource {
  run: string;
  asset: string;
  size: number;
  /** Optional filename relative to standard/. false forces the regular sheet. */
  atlas?: string | false;
  elevationAtlas?: string;
  /** Read-only authoring preview: keep authored clip clocks/markers, display this static frame. */
  previewFrame?: number;
}
export interface ReviewClip { name: string; frames: (number | string)[]; frameRate: number; loop: boolean;
  markers?: Record<string, number>; start?: 'rest' | 'free'; end?: 'rest' | 'free' | 'terminal'; next?: string }
interface AtlasClip { pages: { json: string }[]; frameNames: string[]; sourceFrames: (number | string)[] }
type Elevation = { min: number; max: number; previewWaterLevel?: number };
export interface ReviewPose { key: string; frame: string | number; elevationKey?: string; elevationFrame?: string | number }
interface ExportMetadata {
  manifest: { targetSize: number; pivot: [number, number]; clips: ReviewClip[]; idleFrame?: number; elevation?: Elevation;
    sockets?: Record<string, [number, number]> };
  sheets: Record<string, { frameWidth: number; frameHeight: number; margin: number; spacing: number; frameCount: number }>;
  atlases?: Record<string, { color: Record<string, AtlasClip>; elevation?: Record<string, AtlasClip> }>;
}
export interface LoadedReviewAsset {
  key: string;
  elevationKey?: string;
  format: 'atlas' | 'sheet';
  clips: ReviewClip[];
  pivot: [number, number];
  scale: number;
  elevation?: Elevation;
  sockets: Record<string, [number, number]>;
  pose(clip: string, index: number): ReviewPose;
  sourceUrl(key: string): string;
  frame(id: number | string): number | string;
}

let serial = 0;
/** Owns only fixture textures and its own loader, never resets the scene's gameplay loader. */
export class KrakenReviewAssets {
  private readonly abort = new AbortController();
  private readonly keys: string[] = [];
  constructor(private readonly scene: Phaser.Scene) {}

  private async json(url: string, optional = false): Promise<unknown> {
    const response = await fetch(url, { signal: this.abort.signal });
    if (optional && (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))) return null;
    if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${url}`);
    return response.json();
  }

  async load(source: ReviewAssetSource): Promise<LoadedReviewAsset> {
    const preview = source.previewFrame !== undefined;
    const base = preview ? `/art/poc/pipeline-v2/previews/${source.run}/${source.asset}/`
      : `/art/poc/pipeline-v2/runs/${source.run}/${source.asset}/standard/`;
    const data = await this.json(base + (preview ? 'preview.json' : 'export.json'));
    const reference = data as { spec: { pivot: [number, number] }; clips: ReviewClip[]; indices: number[] };
    if (preview && !reference.indices?.includes(source.previewFrame!)) throw Error('Unknown preview frame');
    const metadata: ExportMetadata = preview ? { manifest: { targetSize: source.size, pivot: reference.spec.pivot,
      clips: reference.clips }, sheets: {} } : data as ExportMetadata;
    const clips = metadata.manifest?.clips;
    if (!Array.isArray(clips) || !clips.length || clips.some(c => !c.name || !Array.isArray(c.frames) || !c.frames.length
      || c.frames.some(f => typeof f !== 'string' && (!Number.isInteger(f) || f < 0)) || !Number.isFinite(c.frameRate) || !(c.frameRate > 0))) {
      throw new Error('export.json requires manifest.clips with frames and frameRate.');
    }
    for (const clip of clips) {
      if (Object.values(clip.markers ?? {}).some(i => !Number.isInteger(i) || i < 0 || i >= clip.frames.length)
        || (clip.end !== undefined && !['rest', 'free', 'terminal'].includes(clip.end))
        || (clip.next !== undefined && (clip.end !== 'free' || !clips.some(c => c.name === clip.next)))) throw Error(`Invalid clip contract: ${clip.name}`);
    }
    const pages = source.atlas === undefined ? metadata.atlases?.[source.size] : undefined;
    const poseClips = metadata.manifest.idleFrame === undefined ? clips : [
      ...clips, { name: '__rest', frames: [metadata.manifest.idleFrame], frameRate: 1, loop: false },
    ];
    const atlas = preview || source.atlas === false || pages ? null : await this.json(base + (source.atlas ?? 'atlas.json'), source.atlas === undefined);
    const elevation = source.elevationAtlas ? await this.json(base + source.elevationAtlas) : null;
    this.abort.signal.throwIfAborted();
    const key = `kraken-review-${++serial}`, elevationKey = elevation ? key + '-elevation' : undefined;
    this.keys.push(key); if (elevationKey) this.keys.push(elevationKey);
    const load = new Phaser.Loader.LoaderPlugin(this.scene);
    const urls = new Map<string, string>();
    const queueAtlas = (textureKey: string, data: unknown, filename = 'atlas.json'): void => {
      const image = (data as { meta?: { image?: string } }).meta?.image;
      if (!image || !/^[\w.-]+\.png$/.test(image)) throw new Error('Atlas requires meta.image (a local PNG filename).');
      const url = base + filename.slice(0, filename.lastIndexOf('/') + 1) + image;
      urls.set(textureKey, url); load.atlas(textureKey, url, data as object);
    };
    const poses = new Map<string, ReviewPose[]>();
    try {
      const sheet = metadata.sheets?.[source.size];
      if (preview) {
        const url = base + `frame-${String(source.previewFrame).padStart(4, '0')}.png`;
        urls.set(key, url); load.image(key, url);
        for (const clip of clips) poses.set(clip.name, clip.frames.map(() => ({ key, frame: '__BASE' })));
      } else if (pages) {
        for (const clip of poseClips) {
          const color = pages.color[clip.name], elevation = pages.elevation?.[clip.name];
          if (!color || color.frameNames.length !== clip.frames.length || JSON.stringify(color.sourceFrames) !== JSON.stringify(clip.frames)
            || (metadata.manifest.elevation && (!elevation || JSON.stringify(elevation.frameNames) !== JSON.stringify(color.frameNames)
              || JSON.stringify(elevation.sourceFrames) !== JSON.stringify(clip.frames)))) throw Error(`Atlas clip mismatch: ${clip.name}`);
          const selected: ReviewPose[] = color.frameNames.map(frame => ({ key: '', frame }));
          for (const [pass, group] of [['color', color], ['elevation', elevation]] as const) {
            if (!group) continue;
            for (const page of group.pages) {
              if (!/^(?:[\w-]+\/)*[\w.-]+\.json$/.test(page.json) || page.json.includes('..')) throw Error('Invalid atlas page path');
              const data = await this.json(base + page.json) as { frames: Record<string, unknown> };
              const pageKey = `${key}-${pass}-${this.keys.length}`;
              this.keys.push(pageKey); queueAtlas(pageKey, data, page.json);
              for (const pose of selected) if (Object.prototype.hasOwnProperty.call(data.frames, pose.frame)) {
                if (pass === 'color') pose.key = pageKey;
                else { pose.elevationKey = pageKey; pose.elevationFrame = pose.frame; }
              }
            }
          }
          if (selected.some(p => !p.key || (metadata.manifest.elevation && !p.elevationKey))) throw Error(`Missing atlas frame: ${clip.name}`);
          poses.set(clip.name, selected);
        }
      } else if (atlas) queueAtlas(key, atlas, typeof source.atlas === 'string' ? source.atlas : undefined);
      else {
        if (!sheet) throw new Error(`No ${source.size}px sheet in export.json`);
        urls.set(key, base + `sheet-${source.size}.png`);
        load.spritesheet(key, urls.get(key)!, { ...sheet, endFrame: sheet.frameCount - 1 });
      }
      if (elevationKey) queueAtlas(elevationKey, elevation, source.elevationAtlas);
      if (!pages && !preview) for (const clip of poseClips) {
        const selected: ReviewPose[] = [];
        for (const id of clip.frames) {
          let poseElevationKey = elevationKey;
          if (!elevationKey && metadata.manifest.elevation) {
            poseElevationKey = `${key}-elevation-${id}`;
            if (!this.keys.includes(poseElevationKey)) {
              this.keys.push(poseElevationKey);
              load.image(poseElevationKey, base + `elevation/frames-${source.size}/frame-${String(id).padStart(4, '0')}.png`);
            }
          }
          selected.push({ key, frame: atlas ? String(id) : id, elevationKey: poseElevationKey,
            elevationFrame: elevationKey ? String(id) : '__BASE' });
        }
        poses.set(clip.name, selected);
      }
      await new Promise<void>((resolve, reject) => {
        const signal = this.abort.signal;
        const finish = (error?: Error) => {
          clearTimeout(timeout); signal.removeEventListener('abort', cancel);
          load.off('complete', complete); load.off('loaderror', failed);
          error ? reject(error) : resolve();
        };
        const cancel = () => finish(new Error('Kraken asset load cancelled.'));
        const complete = () => finish();
        const failed = (file: Phaser.Loader.File) => finish(new Error(`Asset failed: ${file.src}`));
        const timeout = setTimeout(() => finish(new Error('Kraken asset load timed out.')), 30000);
        signal.addEventListener('abort', cancel, { once: true });
        load.once('complete', complete); load.once('loaderror', failed); load.start();
      });
      this.abort.signal.throwIfAborted();
      const frame = (id: number | string) => atlas ? String(id) : id;
      for (const selected of poses.values()) for (const pose of selected) {
        if (!this.scene.textures.get(pose.key).has(String(pose.frame))) throw new Error(`Missing frame ${pose.frame}`);
        if (pose.elevationKey && !this.scene.textures.get(pose.elevationKey).has(String(pose.elevationFrame))) throw new Error(`Missing elevation frame ${pose.elevationFrame}`);
      }
      const firstPose = poses.get(clips[0].name)![0];
      const first = this.scene.textures.get(firstPose.key).get(firstPose.frame);
      return { key: firstPose.key, elevationKey: firstPose.elevationKey, format: atlas || pages ? 'atlas' : 'sheet', clips,
        sourceUrl: key => urls.get(key)!,
        elevation: metadata.manifest.elevation, sockets: metadata.manifest.sockets ?? {},
        pose: (clip, index) => { const selected = poses.get(clip) ?? (clip === '__rest' ? poses.get(clips[0].name) : undefined);
          const pose = selected?.[index]; if (!pose) throw Error(`Unknown pose: ${clip}/${index}`); return pose; },
        pivot: metadata.manifest.pivot ?? [.5, .5], scale: metadata.manifest.targetSize / first.realWidth, frame };
    } finally {
      // LoaderPlugin's constructor installs a BOOT hook even on an already booted scene.
      this.scene.sys.events.off('boot', (load as unknown as { boot: () => void }).boot, load);
      load.destroy();
    }
  }

  destroy(): void {
    this.abort.abort();
    for (const key of this.keys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.keys.length = 0;
    // Pending loaders finish their finally block after the abort rejection.
  }
}
