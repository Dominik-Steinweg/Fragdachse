import { KrakenGpuBudget } from './KrakenGpuBudget';
import { KRAKEN_BOSS_DEFAULTS } from '../../config/krakenBoss';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import type * as Phaser from 'phaser';
import { PIPELINE_RUNTIME_ASSETS } from '../../config/pipelineAssets';
import type { PipelineBossAsset } from '../../config/pipelineAssetContracts';
import { createKrakenResidencyPort, KrakenAssetResidency } from './KrakenAssetResidency';
import { KrakenMeshCache } from './KrakenMeshCache';
import type { KrakenAssetRole, KrakenResidencyPhase, KrakenPhaseOptions } from './KrakenResidencyPlan';
import type { KrakenPresentationAssets, KrakenPresentationAsset } from './KrakenRenderer';

/** Bridges selected production metadata to presentation leases. No simulation dependency. */
export class KrakenPresentationResidency {
  readonly assets: KrakenPresentationAssets | null;
  private residency: KrakenAssetResidency | null;
  private metadata: Partial<Record<KrakenAssetRole, PipelineBossAsset>> = {};
  private readonly retired = new Set<KrakenAssetResidency>();
  private pending: KrakenAssetResidency | null = null;
  private destroyed = false;
  private removeDevHook?: () => void;
  private finishDevRender?: () => void;
  private readonly meshes: KrakenMeshCache;
  private phase: KrakenResidencyPhase = 'dead';
  private phaseOptions = '';
  private waterMove = false;
  private peak = 0;
  private readonly phasePeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly phaseResidentPeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly phaseAtlasPeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly gpuBudget: KrakenGpuBudget;
  constructor(private readonly scene: Phaser.Scene, private readonly diagnostic: (message: string) => void, private readonly additionalGpuBytes: () => number) {
    this.meshes = new KrakenMeshCache(diagnostic);
    this.gpuBudget = new KrakenGpuBudget(scene);
    const roles = { water: 'abyssal-kraken', land: 'abyssal-kraken-land', tentacle: 'abyssal-kraken-tentacle', egg: 'abyssal-kraken-egg', spine: 'abyssal-kraken-spine' };
    const metadata = Object.fromEntries(Object.entries(roles).map(([role, id]) => [role,
      PIPELINE_RUNTIME_ASSETS.find(a => a.id === id && a.runtimeContract === 'boss')])) as Record<KrakenAssetRole, PipelineBossAsset | undefined>;
    // The spine part is optional (older selections predate it); the four body/part roles are required.
    if ((['water', 'land', 'tentacle', 'egg'] as const).some(role => !metadata[role]?.materialPass)) { this.assets = null; this.residency = null; return; }
    if (!metadata.spine?.materialPass) delete metadata.spine;
    this.metadata = metadata;
    this.residency = this.createResidency(metadata);
    const owner = this;
    const adapter = (role: KrakenAssetRole): KrakenPresentationAsset => ({
      get metadata() { return owner.metadata[role]!; }, frame: () => null,
      acquire: (clip, index) => {
        const lease = this.residency!.acquirePose(role, clip, index, () => {});
        if (lease) {
          const asset = this.metadata[role]!;
          const analytic = role === 'egg' || getGraphicsQualityProfile(scene).level === 'low';
          lease.pose.mesh = this.meshes.get(asset, lease.pose.sourceFrame, analytic);
          const frames = asset.clips.find(c => c.name === clip)?.frames;
          if (frames && !analytic) for (let offset = 1; offset <= 3; offset++) this.meshes.get(asset, frames[(index + offset) % frames.length]);
          this.peak = Math.max(this.peak, this.residency!.residentBytes + this.renderBytes());
        }
        return lease;
      },
    });
    scene.game.events.on('postrender', this.measure, this);
    this.assets = { water: adapter('water'), land: adapter('land'), tentacle: adapter('tentacle'), egg: adapter('egg'),
      ...(metadata.spine ? { spine: adapter('spine') } : {}) };
    if (import.meta.env.DEV) void import('../../dev/scenario/KrakenDraftAssets').then(module => {
      if (!this.destroyed) this.removeDevHook = module.registerKrakenDraftConsumer((assets, resolvePaths) => this.reloadDev(assets, resolvePaths,
        () => module.updateKrakenDraftFilters(this.scene, this.metadata, assets, key => this.residency?.ownsTexture(key) ?? false)));
    });
  }
  private createResidency(metadata: Partial<Record<KrakenAssetRole, PipelineBossAsset>>): KrakenAssetResidency {
    return new KrakenAssetResidency(metadata as Record<KrakenAssetRole, PipelineBossAsset>,
      createKrakenResidencyPort(this.scene, value => this.diagnostic(value.message)),
      { waterBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.waterBudgetMiB, landBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.landBudgetMiB,
        peakBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.waterBudgetMiB,
        additionalGpuBytes: () => Math.max(25 * 1024 * 1024, this.renderBytes()) });
  }
  /** Dev-only source transaction. Adapters survive; the world and simulation are untouched. */
  private async reloadDev(metadata: Partial<Record<KrakenAssetRole, PipelineBossAsset>>, resolvePaths: () => void, beforeSwap: () => void = () => {}): Promise<boolean> {
    if (!import.meta.env.DEV || this.destroyed) throw Error('Draft reload is unavailable');
    this.pending?.detach();
    const next = this.createResidency(metadata); // Validate production-shaped metadata before resolving Dev URLs.
    resolvePaths();
    this.pending = next;
    try {
      let phase: KrakenResidencyPhase, options: string;
      do {
        phase = this.phase; options = this.phaseOptions;
        if (phase !== 'dead') {
          const loading = next.setPhase(phase, options ? JSON.parse(options) : {});
          if (!await loading.ready) throw Error('Draft rest poses could not be loaded');
          await loading.settled;
          if (next.errors.length) throw Error(next.errors.map(e => e.message).join('; '));
        }
        if (this.destroyed || this.pending !== next) throw Error('Draft reload superseded');
      } while (phase !== this.phase || options !== this.phaseOptions);
      beforeSwap();
      if (this.residency) this.retired.add(this.residency);
      this.metadata = metadata; this.residency = next; this.pending = null; this.meshes.clear();
      // Existing views release their old leases during their next show()/hide().
      // The next postrender is the earliest point at which old textures may disappear.
      await new Promise<void>(resolve => {
        const finish = () => {
          this.scene.game.events.off('postrender', finish); this.finishDevRender = undefined; resolve();
        };
        this.finishDevRender = finish; this.scene.game.events.once('postrender', finish);
      });
      return !this.destroyed && next.activeLeaseCount > 0;
    } catch (error) {
      if (this.residency !== next) next.detach();
      if (this.pending === next) this.pending = null;
      throw error;
    }
  }
  setPhase(phase: KrakenResidencyPhase, options: KrakenPhaseOptions = {}): void {
    // Once swimming was used, retain it through this water phase instead of reloading per approach.
    this.waterMove = phase === 'water' && (this.waterMove || !!options.waterMove);
    const selected: KrakenPhaseOptions = phase === 'water' ? { prefetchLand: !!options.prefetchLand, waterMove: this.waterMove }
      : phase === 'ashore' ? { waterBody: options.waterBody !== false } : {};
    const key = JSON.stringify(selected);
    if (phase === this.phase && key === this.phaseOptions) return;
    this.phase = phase;
    this.phaseOptions = key;
    if (phase !== 'dead' && this.residency) this.gpuBudget.begin();
    this.residency?.setPhase(phase, selected);
    if (phase === 'dead') this.meshes.clear();
  }
  private measure(): void {
    if (import.meta.env.DEV) for (const old of this.retired) if (old.activeLeaseCount === 0) { old.detach(); this.retired.delete(old); }
    const bytes = (this.residency?.residentBytes ?? 0) + this.renderBytes();
    this.peak = Math.max(this.peak, bytes); this.phasePeaks[this.phase] = Math.max(this.phasePeaks[this.phase] ?? 0, bytes);
    this.phaseResidentPeaks[this.phase] = Math.max(this.phaseResidentPeaks[this.phase] ?? 0, bytes + this.meshes.bytes);
    this.phaseAtlasPeaks[this.phase] = Math.max(this.phaseAtlasPeaks[this.phase] ?? 0, this.residency?.residentBytes ?? 0);
  }
  private renderBytes(): number { return this.additionalGpuBytes() + this.gpuBudget.retainedFilterBytes; }
  inspect() { return { phase: this.phase, options: this.phaseOptions ? JSON.parse(this.phaseOptions) : {}, errors: this.residency?.errors ?? [], atlasBytes: this.residency?.residentBytes ?? 0,
    reservedBytes: this.residency?.reservedBytes ?? 0, rendererBytes: this.renderBytes(), retainedFilterBytes: this.gpuBudget.retainedFilterBytes, cpuMeshBytes: this.meshes.bytes, peakBytes: this.peak,
    phasePeaks: { ...this.phasePeaks }, phaseResidentPeaks: { ...this.phaseResidentPeaks }, phaseAtlasPeaks: { ...this.phaseAtlasPeaks } }; }
  destroy(): void {
    this.destroyed = true; this.removeDevHook?.(); this.pending?.detach(); this.finishDevRender?.();
    for (const old of this.retired) old.detach(); this.retired.clear();
    if (this.residency) this.scene.game.events.off('postrender', this.measure, this); this.residency?.detach(); this.meshes.destroy();
  }
}
