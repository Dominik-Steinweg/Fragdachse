import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { normalizePipelineAsset, type PipelineNormalAsset } from '../../config/pipelineAssetContracts';

const identifier = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw Error('Invalid shape asset/label');
  return value;
};
function guard(): void { if (!import.meta.env.DEV) throw Error('Shape assets are Dev-only'); }
let serial = 0;

export async function loadShapeDraft(assetId: string, signal: AbortSignal): Promise<{ asset: PipelineNormalAsset; url: string }> {
  guard(); identifier(assetId);
  const read = async (url: string): Promise<unknown> => {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw Error('Form-Entwurf fehlt: ' + url);
    return response.json();
  };
  const base = `/art/poc/pipeline-v2/shapes/${assetId}/`;
  const latest = await read(base + 'latest.json') as { label: string };
  const shape = await read(base + identifier(latest.label) + '/shape.json') as { status: string; mode: string; id: string; draft?: { label: string } };
  if (shape.status !== 'complete' || shape.mode !== 'shape' || shape.id !== assetId || !shape.draft) throw Error('Form zuerst mit --export-draft bauen.');
  const label = identifier(shape.draft.label), draftBase = `/art/poc/pipeline-v2/drafts/${assetId}/${label}/standard/`;
  const asset = normalizePipelineAsset(await read(draftBase + 'runtime.json'));
  if (asset.id !== assetId || asset.revision !== label || asset.runtimeContract !== 'sheet') throw Error('Boss-Formen über krakenMission({ drafts: true }) anzeigen.');
  return { asset, url: draftBase + asset.idlePath.slice('./assets/'.length) };
}

/** Static visual fixture owned by the dev scenario; no enemy AI, hitbox or animation. */
export class ShapeDraftSpawn {
  private readonly abort = new AbortController();
  private readonly key = `dev-shape-${++serial}`;
  private sprite: Phaser.GameObjects.Image | null = null;
  private disposed = false;
  constructor(private readonly scene: Phaser.Scene) { guard(); }

  async initialize(assetId: string, x: number, y: number): Promise<void> {
    const { asset, url } = await loadShapeDraft(assetId, this.abort.signal);
    const response = await fetch(url, { signal: this.abort.signal });
    if (!response.ok) throw Error(`Shape image HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        const signal = this.abort.signal;
        const finish = (error?: Error) => {
          signal.removeEventListener('abort', cancel); image.onload = null; image.onerror = null;
          error ? reject(error) : resolve();
        };
        const cancel = () => finish(new Error('Shape load cancelled'));
        if (signal.aborted) { cancel(); return; }
        signal.addEventListener('abort', cancel, { once: true });
        image.onload = () => finish(); image.onerror = () => finish(new Error('Shape image decode failed'));
        image.src = objectUrl;
      });
      if (this.disposed) throw Error('Shape load cancelled');
      if (!this.scene.textures.addImage(this.key, image)) throw Error('Shape texture creation failed');
      // The beauty includes authored lights; at entity depth it also receives the
      // world's normal lightmap. Sheet assets do not provide a mesh shadow pass.
      this.sprite = this.scene.add.image(x, y, this.key).setOrigin(...asset.pivot)
        .setDisplaySize(asset.sourceSize, asset.sourceSize).setDepth(DEPTH.PLAYERS - .05);
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    this.sprite?.destroy(); this.sprite = null;
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
