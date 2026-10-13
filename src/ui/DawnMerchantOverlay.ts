import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { DAWN_UI_TEXTURES } from '../assets/DawnUiAssets';
import { t } from '../i18n';
import { purchaseDawnExpansion } from '../dawn/economy/DawnEconomy';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { getStoredCoopDefenseProgress, updateStoredDawnProgress } from '../utils/localPreferences';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { ensureModalPanelTexture, mountForestModal, textStyle } from './ForestModal';
import { UiButton } from './UiButton';
import { buildDawnMerchantModel } from './DawnMerchantModel';

interface MerchantRow {
  root: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image | null;
}

/** Personal lobby menu. The existing World re-instance observes the saved expansion. */
export class DawnMerchantOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private balance: MerchantRow | null = null;
  private details: MerchantRow | null = null;
  private threat: MerchantRow | null = null;
  private price: MerchantRow | null = null;
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
    const title = this.createRow(x, y - 155, DAWN_UI_TEXTURES.dealerPortrait, 128, 'display');
    this.setRow(title, t('ui.dawn.merchant'));
    this.balance = this.createRow(x, y - 65, DAWN_UI_TEXTURES.scrap, 24);
    this.details = this.createRow(x, y - 12, DAWN_UI_TEXTURES.dealerExpansion, 56);
    this.threat = this.createRow(x, y + 40, DAWN_UI_TEXTURES.threat, 24);
    this.price = this.createRow(x, y + 85, DAWN_UI_TEXTURES.scrap, 24);
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
    this.root = this.scene.add.container(0, 0, [dim, panel, title.root, this.balance.root, this.details.root,
      this.threat.root, this.price.root,
      this.buy.getRoot(), this.close.getRoot()]).setScrollFactor(0).setDepth(DEPTH.OVERLAY + 3);
    mountForestModal(this.scene, this.root, 720, 540);
    promoteToClarityCamera(this.scene, this.root);
  }

  private refresh(): void {
    const stored = getStoredCoopDefenseProgress();
    const model = buildDawnMerchantModel(stored.dawn, stored.persistentBaseAreaStage, isDawnUnlocked(stored));
    this.setRow(this.balance, t('ui.dawn.scrapCount', { scrap: model.scrap }));
    this.setRow(this.details, t('ui.dawn.expansionStats', {
      expansionLevel: model.expansionLevel, radius: model.radius,
    }));
    this.setRow(this.threat, model.nextThreat === null ? t('ui.dawn.threat', { threat: model.threat })
      : t('ui.dawn.threatConsequence', { threat: model.threat, nextThreat: model.nextThreat }));
    this.setRow(this.price, model.cost === null ? t('ui.dawn.maxExpansion')
      : t(model.canBuy ? 'ui.dawn.expansionCost' : 'ui.dawn.insufficientScrap', { cost: model.cost }), model.cost !== null);
    this.buy?.setEnabled(this.canInteract() && model.canBuy);
  }

  private createRow(x: number, y: number, key: string, size: number, role: 'body' | 'display' = 'body'): MerchantRow {
    const icon = this.scene.textures.exists(key) ? this.scene.add.image(0, 0, key).setDisplaySize(size, size) : null;
    const text = this.scene.add.text(0, 0, '', { ...textStyle(role), align: 'center', lineSpacing: 4,
      wordWrap: { width: 540 - (icon ? size + 10 : 0), useAdvancedWrap: true },
    }).setOrigin(0.5);
    return { root: this.scene.add.container(x, y, icon ? [icon, text] : [text]), text, icon };
  }

  private setRow(row: MerchantRow | null, label: string, showIcon = true): void {
    if (!row) return;
    row.icon?.setVisible(showIcon);
    const iconWidth = row.icon && showIcon ? row.icon.displayWidth + 10 : 0;
    row.text.setWordWrapWidth(540 - iconWidth).setText(label).setX(iconWidth / 2);
    row.icon?.setPosition(-(row.text.width + iconWidth) / 2 + row.icon.displayWidth / 2, 0);
  }
}
