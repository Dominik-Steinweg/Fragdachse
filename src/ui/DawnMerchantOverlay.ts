import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { t } from '../i18n';
import { purchaseDawnExpansion } from '../dawn/economy/DawnEconomy';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { getStoredCoopDefenseProgress, updateStoredDawnProgress } from '../utils/localPreferences';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { ensureModalPanelTexture, mountForestModal, textStyle } from './ForestModal';
import { UiButton } from './UiButton';
import { buildDawnMerchantModel } from './DawnMerchantModel';

/** Personal lobby menu. The existing World re-instance observes the saved expansion. */
export class DawnMerchantOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private details: Phaser.GameObjects.Text | null = null;
  private price: Phaser.GameObjects.Text | null = null;
  private buy: UiButton | null = null;
  private close: UiButton | null = null;
  private readonly onEscape = () => this.hide();

  constructor(private readonly scene: Phaser.Scene, private readonly canInteract: () => boolean) {}

  show(): void {
    if (!this.canInteract() || !isDawnUnlocked(getStoredCoopDefenseProgress())) return;
    if (!this.root) this.build();
    this.refresh();
    this.root!.setVisible(true);
    this.scene.input.keyboard?.off('keydown-ESC', this.onEscape);
    this.scene.input.keyboard?.on('keydown-ESC', this.onEscape);
  }

  hide(): void {
    this.root?.setVisible(false);
    this.scene.input.keyboard?.off('keydown-ESC', this.onEscape);
  }

  destroy(): void {
    this.hide();
    this.buy?.destroy();
    this.close?.destroy();
    this.root?.destroy(true);
    this.root = null;
  }

  private build(): void {
    const x = GAME_WIDTH / 2, y = GAME_HEIGHT / 2;
    const dim = this.scene.add.rectangle(x, y, GAME_WIDTH, GAME_HEIGHT, 0x080c0a, 0.6)
      .setScrollFactor(0).setInteractive();
    const panel = this.scene.add.image(x, y, ensureModalPanelTexture(this.scene, '_dawn_merchant', 720, 540))
      .setScrollFactor(0);
    const title = this.scene.add.text(x, y - 170, t('ui.dawn.merchant'), textStyle('display')).setOrigin(0.5);
    this.details = this.scene.add.text(x, y - 65, '', { ...textStyle('body', { align: 'center' }), lineSpacing: 12 }).setOrigin(0.5);
    this.price = this.scene.add.text(x, y + 55, '', textStyle('body')).setOrigin(0.5);
    this.buy = new UiButton(this.scene, { skin: 'forest', x: x - 110, y: y + 150, w: 260, h: 48,
      label: t('ui.dawn.buyExpansion'), intent: 'attention', onClick: () => {
        if (!this.canInteract()) return;
        const unlocked = isDawnUnlocked(getStoredCoopDefenseProgress());
        updateStoredDawnProgress(draft => { purchaseDawnExpansion(draft, unlocked); });
        this.refresh();
      },
    });
    this.close = new UiButton(this.scene, { skin: 'forest', x: x + 175, y: y + 150, w: 180, h: 48,
      label: t('ui.common.close'), onClick: () => this.hide(),
    });
    this.root = this.scene.add.container(0, 0, [dim, panel, title, this.details, this.price,
      this.buy.getRoot(), this.close.getRoot()]).setScrollFactor(0).setDepth(DEPTH.OVERLAY + 3);
    mountForestModal(this.scene, this.root, 720, 540);
    promoteToClarityCamera(this.scene, this.root);
  }

  private refresh(): void {
    const stored = getStoredCoopDefenseProgress();
    const model = buildDawnMerchantModel(stored.dawn, stored.persistentBaseAreaStage, isDawnUnlocked(stored));
    this.details?.setText(t('ui.dawn.merchantStats', {
      scrap: model.scrap, threat: model.threat, expansionLevel: model.expansionLevel, radius: model.radius,
    }));
    this.price?.setText(model.cost === null ? t('ui.dawn.maxExpansion')
      : t(model.canBuy ? 'ui.dawn.expansionCost' : 'ui.dawn.insufficientScrap', { cost: model.cost }));
    this.buy?.setEnabled(this.canInteract() && model.canBuy);
  }
}
