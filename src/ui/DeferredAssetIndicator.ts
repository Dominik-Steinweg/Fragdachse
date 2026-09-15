import type * as Phaser from 'phaser';
import { getDeferredAssets, type DeferredAssetState } from '../assets/DeferredAssets';
import { t } from '../i18n';
import { textStyle } from './uiTheme';

/** Passive, screen-fixed projection of the shared load state; never starts a download. */
export class DeferredAssetIndicator {
  readonly root: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly unsubscribe: () => void;
  private state: DeferredAssetState;
  private displayed = 0;

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, private readonly width = 220, barOffsetY = 12) {
    const track = scene.add.rectangle(-width / 2, barOffsetY, width, 2, 0xb2b8ac, 0.2).setOrigin(0, 0.5);
    this.fill = scene.add.rectangle(-width / 2, barOffsetY, 1, 2, 0xb2b8ac, 0.6).setOrigin(0, 0.5);
    this.label = scene.add.text(0, 0, t('ui.lobby.deferredLoading'), textStyle('micro', {
      color: 0xb2b8ac,
    })).setOrigin(0.5).setAlpha(0.65);
    this.root = scene.add.container(x, y, [track, this.fill, this.label]).setScrollFactor(0);
    const assets = getDeferredAssets(scene);
    this.state = assets.getState();
    this.unsubscribe = assets.subscribe(state => {
      this.state = state;
      this.root.setVisible(state.status === 'loading' || state.status === 'error');
      this.label.setText(t(state.status === 'error' ? 'ui.lobby.deferredFailed' : 'ui.lobby.deferredLoading'));
    });
    scene.events.on('update', this.update);
  }

  private readonly update = (time: number, delta: number): void => {
    if (!this.root.visible) return;
    if (this.state.progress !== null) {
      // Interpolate only towards measured progress, never ahead of it or backwards.
      const target = Math.max(this.displayed, this.state.progress);
      this.displayed += (target - this.displayed) * Math.min(1, delta / 180);
    }
    const indeterminate = this.state.progress === null;
    this.fill.setDisplaySize(Math.max(1, this.width * this.displayed), 2);
    this.fill.setAlpha(indeterminate ? 0.35 + Math.sin(time / 400) * 0.2 : 0.65);
    // With no byte measurement, a pulsing label indicates activity without a fake percentage.
    this.label.setAlpha(indeterminate ? 0.55 + Math.sin(time / 400) * 0.1 : 0.65);
  };

  destroy(): void {
    this.unsubscribe();
    this.scene.events.off('update', this.update);
    this.root.destroy(true);
  }
}
