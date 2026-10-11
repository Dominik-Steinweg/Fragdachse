import type * as Phaser from 'phaser';
import { normalizePipelineAssets, type PipelineAtlasPage, type PipelineBossAsset, type PipelineSocketPoint } from '../../config/pipelineAssetContracts';

export type KrakenAssetRole = 'water' | 'land' | 'tentacle' | 'egg';
export type KrakenResidencyPhase = 'intro' | 'water' | 'ashore' | 'land' | 'dead';
export interface KrakenResidencyDiagnostic { phase: KrakenResidencyPhase; assetId: string; clip: string; message: string }
export interface KrakenPreparedPage {
  /** Synchronous: only the residency owner may publish after checking generation and references. */
  register(key: string): void;
  dispose(): void;
}
export interface KrakenResidencyPort {
  prepare(page: PipelineAtlasPage, signal: AbortSignal): Promise<KrakenPreparedPage>;
  remove(key: string): void;
  /** Bind to the visible loading/error UI. Console-only handling is insufficient. */
  diagnose(error: KrakenResidencyDiagnostic): void;
}
export interface KrakenResidencyOptions {
  waterBudgetMiB: number;
  landBudgetMiB: number;
  /** Includes transition overlap and renderer-owned filter/mask/FX render targets. */
  peakBudgetMiB: number;
  additionalGpuBytes: () => number;
}
export interface KrakenResidentPose {
  key: string; frame: string; elevationKey: string; elevationFrame: string;
  fallback: boolean; sourceFrame: number; sockets: Readonly<Record<string, PipelineSocketPoint>>;
  /** Full-canvas display dimensions; never derive scale from trimmed atlas bounds. */
  displaySize: number; sourceSize: number; pivot: readonly [number, number];
  elevation: PipelineBossAsset['elevation'];
}
export interface KrakenPoseLease {
  pose: KrakenResidentPose;
  /** Stop animation, detach sprites and destroy filters/masks in the supplied cleanup callback. */
  release(): void;
}
interface PageState {
  key: string; page: PipelineAtlasPage; controller: AbortController;
  refs: number; pinned: boolean; registered: boolean; prepared?: KrakenPreparedPage; loading?: Promise<boolean>;
}
const roles: readonly KrakenAssetRole[] = ['water', 'land', 'tentacle', 'egg'];
const waterClips = ['idle', 'ink-spit', 'egg-throw', 'dive', 'surface'];
let scopeSerial = 0;

/** Local Activity presentation lifetime. No host/readiness/network dependency. */
export class KrakenAssetResidency {
  private readonly scope = ++scopeSerial;
  private generation = 0;
  private phase: KrakenResidencyPhase = 'dead';
  private detached = false;
  private readonly pages = new Map<string, PageState>();
  private readonly leases = new Set<() => void>();
  private readonly dependents = new Set<() => void>();
  private desired = new Set<string>();
  private diagnostics: KrakenResidencyDiagnostic[] = [];

  constructor(private readonly assets: Readonly<Record<KrakenAssetRole, PipelineBossAsset>>,
    private readonly port: KrakenResidencyPort, private readonly options: KrakenResidencyOptions) {
    normalizePipelineAssets(roles.map(role => assets[role]));
    if ([options.waterBudgetMiB, options.landBudgetMiB, options.peakBudgetMiB].some(n => !Number.isFinite(n) || n <= 0)) {
      throw new Error('Kraken residency requires finite positive GPU budgets');
    }
  }

  get errors(): readonly KrakenResidencyDiagnostic[] { return this.diagnostics; }
  /** Includes in-flight reservations, so concurrent downloads cannot exceed the peak. */
  get reservedBytes(): number { return [...this.pages.values()].reduce((sum, p) => sum + p.page.gpuBytesRGBA8, 0); }
  get residentBytes(): number { return [...this.pages.values()].reduce((sum, p) => sum + (p.registered ? p.page.gpuBytesRGBA8 : 0), 0); }

  private key(asset: PipelineBossAsset, clip: string, pass: 'color' | 'elevation', index: number): string {
    return `${asset.textureKey}:scope${this.scope}:${clip}:${pass}:${index}`;
  }
  private descriptors(role: KrakenAssetRole, clip: string): { key: string; page: PipelineAtlasPage }[] {
    const asset = this.assets[role];
    return (['color', 'elevation'] as const).flatMap(pass => {
      const atlas = asset.atlases[pass][clip];
      if (!atlas) throw new Error(`Missing ${asset.id}/${clip}/${pass}`);
      return atlas.pages.map((page, i) => ({ key: this.key(asset, clip, pass, i), page }));
    });
  }
  private report(role: KrakenAssetRole, clip: string, error: unknown): void {
    const diagnostic = { phase: this.phase, assetId: this.assets[role].id, clip,
      message: error instanceof Error ? error.message : String(error) };
    this.diagnostics.push(diagnostic);
    this.port.diagnose(diagnostic);
  }
  private limit(): number {
    const phase = this.phase === 'land' ? this.options.landBudgetMiB : this.phase === 'ashore'
      ? this.options.peakBudgetMiB : this.options.waterBudgetMiB;
    return Math.min(phase, this.options.peakBudgetMiB) * 1024 * 1024;
  }
  private discard(p: PageState): void {
    if (this.pages.get(p.key) !== p) return;
    this.pages.delete(p.key);
    p.controller.abort();
    if (p.registered) this.port.remove(p.key);
    p.prepared?.dispose();
  }
  private sweep(): void {
    if (this.detached) return; // detach removes pages only after every consumer cleanup.
    for (const p of this.pages.values()) if (!p.pinned && p.refs === 0) this.discard(p);
  }
  private loadPage(p: PageState, role: KrakenAssetRole, clip: string): Promise<boolean> {
    if (p.registered) return Promise.resolve(true);
    if (p.loading) return p.loading;
    const generation = this.generation;
    p.loading = (async () => {
      let prepared: KrakenPreparedPage | undefined;
      try {
        prepared = await new Promise<KrakenPreparedPage>((resolve, reject) => {
          const signal = p.controller.signal;
          const cancel = () => reject(new Error('Kraken page load cancelled'));
          signal.addEventListener('abort', cancel, { once: true });
          // Even a transport that ignores cancellation cannot publish or leak its eventual decode.
          this.port.prepare(p.page, signal).then(result => {
            signal.removeEventListener('abort', cancel);
            if (signal.aborted) result.dispose(); else resolve(result);
          }, error => { signal.removeEventListener('abort', cancel); reject(error); });
        });
        if (this.detached || generation !== this.generation || p.controller.signal.aborted || this.pages.get(p.key) !== p) {
          prepared.dispose(); return false;
        }
        p.prepared = prepared;
        // A partially failed registration must be rolled back as well.
        p.registered = true;
        prepared.register(p.key);
        return true;
      } catch (error) {
        if (!p.controller.signal.aborted && !this.detached) this.report(role, clip, error);
        this.discard(p);
        return false;
      }
    })();
    return p.loading;
  }
  private async loadClip(role: KrakenAssetRole, clip: string): Promise<boolean> {
    if (this.detached) return false;
    const descriptors = this.descriptors(role, clip);
    if (!descriptors.every(p => this.desired.has(p.key))) return false;
    const missing = descriptors.filter(p => !this.pages.has(p.key));
    const extra = this.options.additionalGpuBytes();
    if (!Number.isFinite(extra) || extra < 0 || this.reservedBytes + extra + missing.reduce((n, p) => n + p.page.gpuBytesRGBA8, 0) > this.limit()) {
      this.report(role, clip, new Error('GPU residency budget exceeded; retaining guaranteed rest pose'));
      return false;
    }
    for (const descriptor of missing) this.pages.set(descriptor.key, { ...descriptor,
      controller: new AbortController(), refs: 0, pinned: true, registered: false });
    const states = descriptors.map(p => this.pages.get(p.key)!);
    const results = await Promise.all(states.map(p => this.loadPage(p, role, clip)));
    if (results.every(Boolean)) return true;
    // Never expose a partially loaded color/elevation clip. Existing leases keep their pages.
    for (const p of states) if (p.refs === 0) this.discard(p);
    return false;
  }

  /** Current-phase rests are loaded first, including late join. `ready` is LOCAL only.
   * Call again to retry failures. Consumers keep drawing rest poses with current host pose/time.
   * Water move is opt-in; land prefetch is opt-in and charged to the current/peak budget.
   */
  setPhase(phase: KrakenResidencyPhase, options: { waterMove?: boolean; prefetchLand?: boolean; activeEggs?: boolean } = {}):
    { ready: Promise<boolean>; settled: Promise<void> } {
    if (this.detached) return { ready: Promise.resolve(false), settled: Promise.resolve() };
    this.phase = phase;
    const current: KrakenAssetRole[] = phase === 'intro' || phase === 'water' ? ['water', 'tentacle', 'egg']
      : phase === 'dead' ? [] : [...(phase === 'ashore' ? ['water' as const] : []), 'land', ...(options.activeEggs === false ? [] : ['egg' as const])];
    const required: [KrakenAssetRole, string][] = current.map(role => [role, '__rest']);
    const clips: [KrakenAssetRole, string][] = [];
    const add = (role: KrakenAssetRole, names: readonly string[]) => names.forEach(name => clips.push([role, name]));
    if (phase === 'intro') add('water', ['intro-rise']);
    if (phase === 'intro' || phase === 'water') {
      add('water', waterClips);
      if (options.waterMove) add('water', ['move']);
      add('tentacle', ['rise', 'hover', 'slam', 'retract']);
    }
    if (phase === 'ashore') { add('water', ['idle', 'move']); add('land', ['ashore']); }
    if (phase === 'ashore' || phase === 'land') add('land', ['idle', 'move', 'ink-spit', 'slam', 'egg-throw', 'death']);
    if (current.includes('egg')) add('egg', ['idle', 'hatch']);
    if (phase === 'water' && options.prefetchLand) add('land', ['__rest', 'ashore', 'idle', 'move', 'ink-spit', 'slam', 'egg-throw', 'death']);
    this.desired = new Set([...required, ...clips].flatMap(([role, clip]) => this.descriptors(role, clip).map(p => p.key)));
    // Unleased global animations may reference any page. Remove them before a phase evicts pages.
    if ([...this.pages.values()].some(p => p.pinned && !this.desired.has(p.key))) {
      for (const cleanup of this.dependents) {
        try { cleanup(); } catch (error) { this.report('water', '__cleanup', error); }
      }
      this.dependents.clear();
    }
    for (const p of this.pages.values()) p.pinned = this.desired.has(p.key);
    this.sweep();
    const desired = this.desired;
    const ready = (async () => {
      for (const [role, clip] of required) {
        if (this.desired !== desired || !await this.loadClip(role, clip)) return false;
      }
      return !this.detached && this.desired === desired;
    })();
    const settled = ready.then(async ok => {
      if (!ok) return;
      for (const [role, clip] of clips) {
        if (this.desired !== desired || this.detached) return;
        await this.loadClip(role, clip);
      }
    });
    return { ready, settled };
  }

  /** A lease pins exactly the matching color/elevation pages, even across a phase change. */
  acquirePose(role: KrakenAssetRole, clip: string, index: number, cleanup: () => void): KrakenPoseLease | null {
    if (this.detached) return null;
    const asset = this.assets[role];
    const select = (name: string, frameIndex: number) => {
      const frame = `${name}/${String(frameIndex).padStart(4, '0')}`;
      const states = (['color', 'elevation'] as const).map(pass => {
        const atlas = asset.atlases[pass][name];
        const page = atlas?.pages.findIndex(p => p.frameNames.includes(frame)) ?? -1;
        return page < 0 ? undefined : this.pages.get(this.key(asset, name, pass, page));
      });
      return states.every(p => p?.registered) ? { frame, states: states as PageState[], name, frameIndex } : null;
    };
    const selection = select(clip, index) ?? select('__rest', 0);
    if (!selection) return null;
    const { states, frame, name, frameIndex } = selection;
    for (const p of states) p.refs++;
    const release = () => {
      if (!this.leases.delete(release)) return;
      try { cleanup(); } finally { for (const p of states) p.refs--; this.sweep(); }
    };
    this.leases.add(release);
    const sourceFrame = asset.atlases.color[name].sourceFrames[frameIndex];
    return { pose: { key: states[0].key, frame, elevationKey: states[1].key, elevationFrame: frame,
      fallback: name !== clip || frameIndex !== index, sourceFrame, sockets: asset.socketFrames?.[sourceFrame] ?? {},
      sourceSize: asset.sourceSize, displaySize: Math.round(asset.targetSize * (asset.displayScale ?? 1)),
      pivot: asset.pivot, elevation: asset.elevation }, release };
  }

  /** Unleased global animation/filter cleanup, called before phase eviction or detach. */
  ownDependent(cleanup: () => void): () => void {
    if (this.detached) { cleanup(); return () => {}; }
    this.dependents.add(cleanup);
    return () => { if (this.dependents.delete(cleanup)) cleanup(); };
  }
  detach(): void {
    if (this.detached) return;
    this.detached = true; this.generation++; this.desired.clear();
    // Keep pages pinned until ALL consumers have released animations, filters and masks.
    const errors: unknown[] = [];
    for (const cleanup of [...this.dependents, ...this.leases]) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    this.dependents.clear(); this.leases.clear();
    for (const p of this.pages.values()) this.discard(p);
    if (errors.length) this.report('water', '__detach', new Error(`Consumer cleanup failed: ${errors.map(String).join('; ')}`));
  }
}

/** Fetch/decode outside Phaser's auto-registering Loader; commit is synchronous and generation-guarded.
 * PNG elevation is uploaded with Phaser's standard PMA path, matching submersionShader's unpremultiply.
 * Source PNG URLs use their selected hashes; data passes never pass through runtime color conversion.
 */
export function createKrakenResidencyPort(scene: Phaser.Scene,
  diagnose: KrakenResidencyPort['diagnose']): KrakenResidencyPort {
  const ownedKeys = new Set<string>();
  return {
    diagnose,
    remove: key => { if (ownedKeys.delete(key) && scene.textures.exists(key)) scene.textures.remove(key); },
    async prepare(page, ownerSignal) {
      const signal = AbortSignal.any([ownerSignal, AbortSignal.timeout(30000)]);
      const read = async (url: string, hash: string) => {
        const response = await fetch(`${url}?v=${hash}`, { signal });
        if (!response.ok) throw new Error(`Kraken asset HTTP ${response.status}: ${url}`);
        const bytes = await response.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== hash) throw new Error(`Kraken asset hash mismatch: ${url}`);
        return bytes;
      };
      const [blob, metadata] = await Promise.all([
        read(page.image, page.sha256).then(bytes => new Blob([bytes], { type: 'image/png' })),
        read(page.json, page.jsonSha256).then(bytes => JSON.parse(new TextDecoder().decode(bytes))),
      ]);
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob), image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { image.src = ''; finish(new Error('Kraken image decode aborted')); };
          const finish = (error?: Error) => {
            signal.removeEventListener('abort', cancel); image.onload = null; image.onerror = null;
            error ? reject(error) : resolve();
          };
          image.onload = () => finish(); image.onerror = () => finish(new Error(`Kraken image decode failed: ${page.image}`));
          signal.addEventListener('abort', cancel, { once: true }); image.src = url;
        });
        signal.throwIfAborted();
        if (image.naturalWidth !== page.width || image.naturalHeight !== page.height
          || JSON.stringify(Object.keys(metadata.frames ?? {})) !== JSON.stringify(page.frameNames)) throw new Error('Kraken atlas page contract mismatch');
        return {
          register: key => {
            if (scene.textures.exists(key)) throw new Error(`Kraken texture collision: ${key}`);
            ownedKeys.add(key);
            const texture = scene.textures.addAtlas(key, image, metadata);
            if (!texture || page.frameNames.some(name => !texture.has(name))) throw new Error(`Kraken atlas registration failed: ${key}`);
          },
          dispose: () => { image.src = ''; },
        };
      } catch (error) { image.src = ''; throw error; }
      finally { URL.revokeObjectURL(url); }
    },
  };
}
