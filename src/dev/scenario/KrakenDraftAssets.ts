import { normalizePipelineAsset, type PipelineBossAsset } from '../../config/pipelineAssetContracts';
import { PIPELINE_RUNTIME_ASSETS } from '../../config/pipelineAssets';
import type { KrakenAssetRole } from '../../effects/kraken/KrakenResidencyPlan';
import type * as Phaser from 'phaser';
import type { SubmersionFilter } from '../../effects/kraken/submersionShader';
import type { KrakenReviewDrainFilter } from '../../effects/kraken/KrakenReviewDrainFilter';

const roles = { water: 'abyssal-kraken', land: 'abyssal-kraken-land', tentacle: 'abyssal-kraken-tentacle', egg: 'abyssal-kraken-egg', spine: 'abyssal-kraken-spine' } as const;
const base = '/art/poc/pipeline-v2/drafts/';
type Metadata = Partial<Record<KrakenAssetRole, PipelineBossAsset>>;
type Consumer = (assets: Metadata, resolvePaths: () => void) => Promise<boolean>;
interface Version { version: string; publishedAt: number; startedAt: number; assets: Record<string, { label: string }> }
const consumers = new Set<Consumer>();
let source: 'draft' | 'production' = 'production';
let seen = '', running: Promise<void> = Promise.resolve();
let report: Record<string, unknown> = { source, version: null };

function guard(): void { if (!import.meta.env.DEV) throw Error('Draft assets are Dev-only'); }

/** The existing filters copy elevation bounds when created. Refresh those public fields
 * at the source transaction, only on frames leased from this presentation owner.
 * No renderer/world reset is needed, and unrelated review/other boss filters stay untouched.
 */
export function updateKrakenDraftFilters(scene: Phaser.Scene, previous: Metadata, next: Metadata, owns: (key: string) => boolean): void {
  guard();
  for (const object of scene.children.list) {
    const filters = (object as Phaser.GameObjects.Sprite).filters?.internal.list ?? [];
    for (const filter of filters) {
      const submersion = filter.renderNode === 'KrakenSubmersion' ? filter as SubmersionFilter : null;
      const drain = filter.renderNode === 'KrakenReviewDrain' ? filter as KrakenReviewDrainFilter : null;
      const key = (submersion?.elevationFrame ?? drain?.elevation)?.texture.key;
      if (!key || !owns(key)) continue;
      const role = (Object.keys(previous) as KrakenAssetRole[]).find(role => key.startsWith(`${previous[role]!.textureKey}:scope`));
      const encoding = role ? next[role]?.elevation : undefined;
      if (!encoding) continue;
      if (submersion) { submersion.elevationMin = encoding.min; submersion.elevationMax = encoding.max; }
      if (drain) drain.encoding = encoding;
    }
  }
}
async function read<T>(url: string, optional = false): Promise<T | null> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (optional && (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))) return null;
  if (!response.ok) throw Error(`Draft HTTP ${response.status}: ${url}`);
  return response.json() as Promise<T>;
}
function paths(asset: PipelineBossAsset, transform: (url: string) => string): void {
  for (const pass of Object.values(asset.atlases)) for (const clip of Object.values(pass)) for (const page of clip.pages) {
    page.image = transform(page.image); page.json = transform(page.json);
  }
  for (const frame of asset.shadowMesh?.frames ?? []) for (const field of ['positions', 'indices'] as const) frame[field].file = transform(frame[field].file);
}
export async function loadKrakenDraftMetadata(version: Version | null, selected: 'draft' | 'production'): Promise<{ assets: Metadata; resolvePaths: () => void }> {
  guard();
  const assets: Metadata = {}, drafts = new Map<PipelineBossAsset, string>();
  for (const [role, id] of Object.entries(roles) as [KrakenAssetRole, string][]) {
    const label = selected === 'draft' ? version?.assets[id]?.label : undefined;
    if (label !== undefined) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) throw Error('Invalid draft label');
      const url = `${base}${id}/${label}/standard/`;
      const raw = await read<unknown>(url + 'runtime.json');
      const asset = normalizePipelineAsset(raw);
      if (asset.id !== id || asset.revision !== label || asset.runtimeContract !== 'boss' || !asset.materialPass) throw Error(`Invalid draft role: ${id}`);
      assets[role] = asset; drafts.set(asset, url);
    } else {
      const production = PIPELINE_RUNTIME_ASSETS.find(a => a.id === id && a.runtimeContract === 'boss');
      if (production) assets[role] = structuredClone(production) as PipelineBossAsset;
    }
  }
  for (const role of ['water', 'land', 'tentacle', 'egg'] as const) if (!assets[role]?.materialPass) throw Error(`No draft or production asset: ${role}`);
  return { assets, resolvePaths: () => {
    for (const [asset, url] of drafts) paths(asset, file => url + file.slice('./assets/'.length));
  } };
}
export function krakenDraftStatus(): Record<string, unknown> { return { ...report }; }

export function reloadKrakenDraftAssets(selected = source): Promise<void> {
  guard();
  // Serialize reloads and publication polling; rejected jobs must not poison the queue.
  const work = running.catch(() => {}).then(async () => {
    const started = performance.now();
    const version = selected === 'draft' ? await read<Version>(base + 'version.json', true) : null;
    let renderedConsumers = 0;
    for (const consumer of consumers) {
      const { assets, resolvePaths } = await loadKrakenDraftMetadata(version, selected);
      if (await consumer(assets, resolvePaths)) renderedConsumers++;
    }
    source = selected; seen = version?.version ?? '';
    report = { source, version: seen || null, consumers: consumers.size, renderedConsumers, reloadMs: performance.now() - started,
      visibleAt: renderedConsumers ? Date.now() : null,
      iterationMs: renderedConsumers && version ? Date.now() - version.startedAt : null };
  });
  running = work;
  return work;
}
export function registerKrakenDraftConsumer(consumer: Consumer): () => void {
  guard(); consumers.add(consumer);
  if (source === 'draft') void reloadKrakenDraftAssets().catch(error => { report = { ...report, error: String(error) }; });
  return () => { consumers.delete(consumer); };
}
export function installKrakenDraftPolling(): () => void {
  guard(); let active = true, busy = false;
  const poll = async () => {
    if (!active || busy || source !== 'draft') return;
    busy = true;
    try {
      const version = await read<Version>(base + 'version.json', true);
      if (active && version && version.version !== seen) await reloadKrakenDraftAssets();
    } catch (error) { report = { ...report, error: String(error) }; }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void poll(); }, 1000);
  return () => { active = false; clearInterval(timer); source = 'production'; seen = ''; };
}
