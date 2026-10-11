import * as Phaser from 'phaser';

export interface ReviewAssetSource {
  run: string;
  asset: string;
  size: number;
  /** Optional filename relative to standard/. false forces the regular sheet. */
  atlas?: string | false;
  elevationAtlas?: string;
}
export interface ReviewClip { name: string; frames: (number | string)[]; frameRate: number; loop: boolean; markers?: Record<string, number> }
interface ExportMetadata {
  manifest: { targetSize: number; pivot: [number, number]; clips: ReviewClip[] };
  sheets: Record<string, { frameWidth: number; frameHeight: number; margin: number; spacing: number; frameCount: number }>;
}
export interface LoadedReviewAsset {
  key: string;
  elevationKey?: string;
  format: 'atlas' | 'sheet';
  clips: ReviewClip[];
  pivot: [number, number];
  scale: number;
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
    const base = `/art/poc/pipeline-v2/runs/${source.run}/${source.asset}/standard/`;
    const metadata = await this.json(base + 'export.json') as ExportMetadata;
    const clips = metadata.manifest?.clips;
    if (!Array.isArray(clips) || !clips.length || clips.some(c => !c.name || !Array.isArray(c.frames) || !c.frames.length
      || c.frames.some(f => typeof f !== 'string' && (!Number.isInteger(f) || f < 0)) || !(c.frameRate > 0))) {
      throw new Error('export.json requires manifest.clips with frames and frameRate.');
    }
    const atlas = source.atlas === false ? null : await this.json(base + (source.atlas ?? 'atlas.json'), source.atlas === undefined);
    const elevation = source.elevationAtlas ? await this.json(base + source.elevationAtlas) : null;
    this.abort.signal.throwIfAborted();
    const key = `kraken-review-${++serial}`, elevationKey = elevation ? key + '-elevation' : undefined;
    this.keys.push(key); if (elevationKey) this.keys.push(elevationKey);
    const load = new Phaser.Loader.LoaderPlugin(this.scene);
    const queueAtlas = (textureKey: string, data: unknown): void => {
      const image = (data as { meta?: { image?: string } }).meta?.image;
      if (!image || !/^[\w.-]+\.png$/.test(image)) throw new Error('Atlas requires meta.image (a local PNG filename).');
      load.atlas(textureKey, base + image, data as object);
    };
    try {
      const sheet = metadata.sheets?.[source.size];
      if (atlas) queueAtlas(key, atlas);
      else {
        if (!sheet) throw new Error(`No ${source.size}px sheet in export.json`);
        load.spritesheet(key, base + `sheet-${source.size}.png`, { ...sheet, endFrame: sheet.frameCount - 1 });
      }
      if (elevationKey) queueAtlas(elevationKey, elevation);
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
      const texture = this.scene.textures.get(key);
      const frame = (id: number | string) => atlas ? String(id) : id;
      for (const clip of clips) for (const id of clip.frames) {
        if (!texture.has(String(frame(id)))) throw new Error(`Missing frame ${id} in ${source.asset}/${clip.name}`);
        if (elevationKey && !this.scene.textures.get(elevationKey).has(String(id))) throw new Error(`Missing elevation frame ${id}`);
      }
      const first = texture.get(frame(clips[0].frames[0]));
      return { key, elevationKey, format: atlas ? 'atlas' : 'sheet', clips,
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
