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
  private readonly residency: KrakenAssetResidency | null;
  private readonly meshes: KrakenMeshCache;
  private phase: KrakenResidencyPhase = 'dead';
  private phaseOptions = '';
  private waterMove = false;
  private peak = 0;
  private readonly phasePeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly phaseResidentPeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly phaseAtlasPeaks: Partial<Record<KrakenResidencyPhase, number>> = {};
  private readonly gpuBudget: KrakenGpuBudget;
  constructor(private readonly scene: Phaser.Scene, diagnostic: (message: string) => void, private readonly additionalGpuBytes: () => number) {
    this.meshes = new KrakenMeshCache(diagnostic);
    this.gpuBudget = new KrakenGpuBudget(scene);
    const roles = { water: 'abyssal-kraken', land: 'abyssal-kraken-land', tentacle: 'abyssal-kraken-tentacle', egg: 'abyssal-kraken-egg' };
    const metadata = Object.fromEntries(Object.entries(roles).map(([role, id]) => [role,
      PIPELINE_RUNTIME_ASSETS.find(a => a.id === id && a.runtimeContract === 'boss')])) as Record<KrakenAssetRole, PipelineBossAsset | undefined>;
    if (Object.values(metadata).some(a => !a?.materialPass)) { this.assets = null; this.residency = null; return; }
    this.residency = new KrakenAssetResidency(metadata as Record<KrakenAssetRole, PipelineBossAsset>,
      createKrakenResidencyPort(scene, value => diagnostic(value.message)),
      { waterBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.waterBudgetMiB, landBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.landBudgetMiB, peakBudgetMiB: KRAKEN_BOSS_DEFAULTS.residency.waterBudgetMiB,
        additionalGpuBytes: () => Math.max(25 * 1024 * 1024, this.renderBytes()) });
    const adapter = (role: KrakenAssetRole): KrakenPresentationAsset => ({
      metadata: metadata[role]!, frame: () => null,
      acquire: (clip, index) => {
        const lease = this.residency!.acquirePose(role, clip, index, () => {});
        if (lease) {
          const asset = metadata[role]!;
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
    this.assets = { water: adapter('water'), land: adapter('land'), tentacle: adapter('tentacle'), egg: adapter('egg') };
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
    const bytes = (this.residency?.residentBytes ?? 0) + this.renderBytes();
    this.peak = Math.max(this.peak, bytes); this.phasePeaks[this.phase] = Math.max(this.phasePeaks[this.phase] ?? 0, bytes);
    this.phaseResidentPeaks[this.phase] = Math.max(this.phaseResidentPeaks[this.phase] ?? 0, bytes + this.meshes.bytes);
    this.phaseAtlasPeaks[this.phase] = Math.max(this.phaseAtlasPeaks[this.phase] ?? 0, this.residency?.residentBytes ?? 0);
  }
  private renderBytes(): number { return this.additionalGpuBytes() + this.gpuBudget.retainedFilterBytes; }
  inspect() { return { phase: this.phase, options: this.phaseOptions ? JSON.parse(this.phaseOptions) : {}, errors: this.residency?.errors ?? [], atlasBytes: this.residency?.residentBytes ?? 0,
    reservedBytes: this.residency?.reservedBytes ?? 0, rendererBytes: this.renderBytes(), retainedFilterBytes: this.gpuBudget.retainedFilterBytes, cpuMeshBytes: this.meshes.bytes, peakBytes: this.peak,
    phasePeaks: { ...this.phasePeaks }, phaseResidentPeaks: { ...this.phaseResidentPeaks }, phaseAtlasPeaks: { ...this.phaseAtlasPeaks } }; }
  destroy(): void { if (this.residency) this.scene.game.events.off('postrender', this.measure, this); this.residency?.detach(); this.meshes.destroy(); }
}
