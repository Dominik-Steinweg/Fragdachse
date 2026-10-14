import { MarkerLayoutModel, type MarkerLayoutInput } from './MarkerLayoutModel';
import type { MarkerDescriptor, MarkerFrame, MarkerRenderer, MarkerSource } from './MarkerTypes';

export type MarkerScope = 'world' | 'activity' | 'round';
export type MarkerRevision = string | number;

export interface MarkerSourceBinding {
  readonly scope: MarkerScope;
  readonly revision: MarkerRevision;
  /** Source IDs and descriptor keys must be unique across all live bindings.
   * The returned disposer only removes this registration, never a replacement with the same ID. */
  register(source: MarkerSource): () => void;
  /** Idempotent; releasing a parent also releases its children. */
  release(): void;
}

interface ScopeRecord { scope: MarkerScope; revision: MarkerRevision; binding: MarkerSourceBinding }
interface SourceRecord { source: MarkerSource; owner: ScopeRecord; descriptors: readonly MarkerDescriptor[] }
const scopeDepth: Record<MarkerScope, number> = { world: 0, activity: 1, round: 2 };
const emptyFrame = (): MarkerFrame => ({ worldBadges: [], edgeBadges: [], groundRings: [] });

/** Headless/none presentation and pure tests need no GPU allocation. */
export class NullMarkerRenderer implements MarkerRenderer {
  sync(_frame: MarkerFrame, _nowMs: number, _lowQuality: boolean): void {}
  destroy(): void {}
}

/** Scene-lifetime owner; no scene hooks until MK3. Composition explicitly binds revisions and
 * releases them before tearing down their read ports. Only this owner calls the injected renderer. */
export class MarkerSystem {
  private readonly scopes = new Map<MarkerScope, ScopeRecord>();
  private readonly sources = new Map<string, SourceRecord>();
  private lastInput: Omit<MarkerLayoutInput, 'descriptors'> | undefined;
  private destroyed = false;

  constructor(
    private readonly renderer: MarkerRenderer = new NullMarkerRenderer(),
    private readonly layoutModel: MarkerLayoutModel = new MarkerLayoutModel(),
  ) {}

  /** Same revision is idempotent; a changed world invalidates every child binding. */
  bindWorld(revision: MarkerRevision): MarkerSourceBinding { return this.bind('world', revision); }
  bindActivity(revision: MarkerRevision): MarkerSourceBinding { return this.bind('activity', revision); }
  bindRound(revision: MarkerRevision): MarkerSourceBinding { return this.bind('round', revision); }

  update(input: Omit<MarkerLayoutInput, 'descriptors'>): MarkerFrame {
    this.assertAlive();
    const collected = new Map<SourceRecord, MarkerDescriptor[]>();
    const descriptors: MarkerDescriptor[] = [];
    // No early budget cutoff: all sources compete in one layout pass.
    for (const record of [...this.sources.values()]) {
      if (this.sources.get(record.source.id) !== record) continue;
      const out: MarkerDescriptor[] = [];
      record.source.collect(out);
      collected.set(record, out);
    }
    this.assertAlive();
    // A read port may synchronously end its scope while collecting. Do not revive that frame.
    for (const [record, out] of collected) {
      if (this.sources.get(record.source.id) === record) descriptors.push(...out);
      else collected.delete(record);
    }
    const frame = this.layoutModel.layout({ ...input, descriptors });
    for (const [record, out] of collected) record.descriptors = out;
    this.lastInput = input;
    this.renderer.sync(frame, input.nowMs, input.lowQuality);
    return frame;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sources.clear(); this.scopes.clear(); this.lastInput = undefined;
    this.layoutModel.reset();
    this.renderer.destroy();
  }

  private bind(scope: MarkerScope, revision: MarkerRevision): MarkerSourceBinding {
    this.assertAlive();
    if (scope !== 'world' && !this.scopes.has('world')) throw new Error('Marker binding requires a world');
    if (scope === 'round' && !this.scopes.has('activity')) throw new Error('Round markers require an activity');
    const current = this.scopes.get(scope);
    if (current?.revision === revision) return current.binding;
    this.releaseFrom(scope);
    const record: ScopeRecord = {
      scope, revision,
      binding: {
        scope, revision,
        register: (source) => this.register(record, source),
        release: () => {
          if (this.scopes.get(scope) === record) this.releaseFrom(scope);
        },
      },
    };
    this.scopes.set(scope, record);
    return record.binding;
  }

  private register(owner: ScopeRecord, source: MarkerSource): () => void {
    this.assertAlive();
    if (this.scopes.get(owner.scope) !== owner) throw new Error('Marker binding has been released');
    if (this.sources.has(source.id)) throw new Error(`Duplicate marker source: ${source.id}`);
    const record: SourceRecord = { source, owner, descriptors: [] };
    this.sources.set(source.id, record);
    return () => {
      if (this.sources.get(source.id) !== record) return;
      this.sources.delete(source.id);
      this.layoutModel.forget(record.descriptors.map((d) => d.key));
      this.publishRemaining();
    };
  }

  private releaseFrom(scope: MarkerScope): void {
    let changed = false;
    for (const [id, record] of this.sources) {
      if (scopeDepth[record.owner.scope] < scopeDepth[scope]) continue;
      this.sources.delete(id);
      this.layoutModel.forget(record.descriptors.map((d) => d.key));
      changed = true;
    }
    for (const boundScope of this.scopes.keys()) {
      if (scopeDepth[boundScope] >= scopeDepth[scope]) this.scopes.delete(boundScope);
    }
    if (scope === 'world') this.layoutModel.reset();
    if (changed) this.publishRemaining();
  }

  private publishRemaining(): void {
    if (this.destroyed) return;
    // Clear/rebundle immediately, without calling a source whose runtime may already be detaching.
    const frame = this.lastInput ? this.layoutModel.layout({ ...this.lastInput,
      descriptors: [...this.sources.values()].flatMap((record) => record.descriptors),
    }) : emptyFrame();
    this.renderer.sync(frame, this.lastInput?.nowMs ?? 0, this.lastInput?.lowQuality ?? false);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('MarkerSystem has been destroyed');
  }
}
