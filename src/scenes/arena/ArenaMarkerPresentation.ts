import { MarkerSystem, type MarkerSourceBinding } from '../../effects/markers/MarkerSystem';
import type { MarkerRenderer } from '../../effects/markers/MarkerTypes';
import type { MarkerLayoutInput } from '../../effects/markers/MarkerLayoutModel';
import { CoopMissionMarkerSource } from '../../effects/markers/sources/CoopMissionMarkerSource';

/** Scene-owned batches with explicit leases; sources never outlive the runtime supplying their state. */
export class ArenaMarkerPresentation {
  readonly system: MarkerSystem;
  private world: MarkerSourceBinding | null = null;
  private activity: MarkerSourceBinding | null = null;
  private round: MarkerSourceBinding | null = null;
  coop: CoopMissionMarkerSource | null = null;

  constructor(renderer: MarkerRenderer) { this.system = new MarkerSystem(renderer); }
  bindWorld(revision: number): void {
    if (this.world?.revision === revision) return;
    this.releaseWorld(); this.world = this.system.bindWorld(revision);
  }
  bindActivity(revision: number): void {
    if (this.activity?.revision === revision) return;
    this.releaseActivity(); this.activity = this.system.bindActivity(revision);
  }
  bindRound(revision: number): void {
    if (!this.activity || this.round?.revision === revision) return;
    this.releaseRound(); this.round = this.system.bindRound(revision);
    this.coop = new CoopMissionMarkerSource(); this.round.register(this.coop);
  }
  releaseRound(): void {
    this.round?.release(); this.round = null; this.coop?.clear(); this.coop = null;
  }
  releaseActivity(): void {
    this.releaseRound(); this.activity?.release(); this.activity = null;
  }
  releaseWorld(): void {
    this.releaseActivity(); this.world?.release(); this.world = null;
  }
  update(input: Omit<MarkerLayoutInput, 'descriptors'>): void { this.system.update(input); }
  destroy(): void { this.releaseWorld(); this.system.destroy(); }
}
