import type * as Phaser from 'phaser';

/** A live presentation retained until its successor has covered it. */
export interface AfterRoundView {
  readonly depth: number;
  setDepth(depth: number): void;
  setAlpha(alpha: number): void;
  retire(): void;
}

export interface AfterRoundOpening {
  ready(view: AfterRoundView): void;
  unavailable(): void;
  onCancel(cancel: () => void): void;
}

export function overlayTransitionView(root: Phaser.GameObjects.Container, hide: () => void): AfterRoundView {
  const depth = root.depth;
  return {
    depth,
    setDepth: value => { root.setDepth(value); },
    setAlpha: value => { root.setAlpha(value); },
    retire: () => { hide(); root.setAlpha(1).setDepth(depth); },
  };
}

/** Owned by ArenaScene; reward ordering and persistence remain in ArenaMetaController. */
export class AfterRoundTransition {
  private source: AfterRoundView | null = null;
  private incoming: AfterRoundView | null = null;
  private tween: Phaser.Tweens.Tween | null = null;
  private generation = 0;
  private waiting = false;
  private cancelPending: (() => void) | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly blockInput: (blocked: boolean) => void) {}

  get active(): boolean { return this.waiting; }

  begin(source: AfterRoundView | null): void {
    // Cancelling a still-loading destination advances the flow while retaining the same source.
    if (source) this.source = source;
    this.waiting = true;
    this.blockInput(true);
  }

  opening(onUnavailable: () => void): AfterRoundOpening | undefined {
    if (!this.waiting) return undefined;
    const generation = ++this.generation;
    return {
      onCancel: cancel => { if (generation === this.generation && this.waiting) this.cancelPending = cancel; },
      ready: view => {
        if (generation !== this.generation || !this.waiting) { view.retire(); return; }
        this.cancelPending = null;
        this.incoming = view;
        view.setDepth(Math.max(view.depth, (this.source?.depth ?? view.depth) + 1));
        view.setAlpha(0);
        this.animate(alpha => view.setAlpha(alpha), 0, 1, () => {
          this.source?.retire();
          this.source = null;
          view.setDepth(view.depth);
          this.incoming = null;
          this.release();
        });
      },
      unavailable: () => {
        if (generation === this.generation && this.waiting) onUnavailable();
      },
    };
  }

  finish(): void {
    if (!this.waiting) return;
    ++this.generation;
    this.cancelPending?.(); this.cancelPending = null;
    this.animate(alpha => this.source?.setAlpha(alpha), 1, 0, () => {
      this.source?.retire();
      this.source = null;
      this.release();
    });
  }

  cancel(): void {
    ++this.generation;
    if (!this.waiting) return;
    this.cancelPending?.(); this.cancelPending = null;
    this.tween?.remove(); this.tween = null;
    this.incoming?.retire(); this.incoming = null;
    this.source?.retire(); this.source = null;
    this.release();
  }

  private animate(setAlpha: (alpha: number) => void, from: number, to: number, complete: () => void): void {
    this.tween?.remove();
    const generation = this.generation;
    const state = { alpha: from };
    this.tween = this.scene.tweens.add({
      targets: state, alpha: to, duration: 180, ease: 'Sine.easeOut',
      onUpdate: () => { if (generation === this.generation) setAlpha(state.alpha); },
      onComplete: () => {
        if (generation !== this.generation) return;
        this.tween = null; setAlpha(to); complete();
      },
    });
  }

  private release(): void { this.waiting = false; this.blockInput(false); }
}
