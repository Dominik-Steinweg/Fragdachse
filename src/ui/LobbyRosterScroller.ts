import { BUTTON_CURSOR } from './gameCursor';
import * as Phaser from 'phaser';
import { FOREST } from './UiSkin';
import { textStyle } from './uiTheme';
import { ensureIconTexture } from './uiTextures';
import { t } from '../i18n';
import { toDesignSpace } from '../graphics/RenderResolution';
import { LOBBY_CARD, LOBBY_ROSTER_ROW_STEP } from './LobbyLayout';

const BAR_X = LOBBY_CARD.left + LOBBY_CARD.width - LOBBY_CARD.padding + 6;
const BAR_W = 6;
const BAR_ACTIVE_W = 8;
const THUMB_MIN_H = 40;
const GUARD_W = LOBBY_CARD.width - LOBBY_CARD.glassInset * 2;
const HINT_Y = LOBBY_CARD.rosterBottom + 16;

type ClipLeaf = Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.Crop> & {
  y: number; displayHeight: number; originY: number; visible: boolean;
  setVisible(value: boolean): unknown;
};

/**
 * Scrolls only roster content. Rows crossing the viewport edge are cropped instead of hidden, so a
 * partly visible row signals that the list continues. Object filters are deliberately not used:
 * under the zoomed UI camera a filtered Container renders at the wrong scale.
 */
export class LobbyRosterScroller {
  private readonly track: Phaser.GameObjects.Rectangle;
  private readonly thumb: Phaser.GameObjects.Rectangle;
  private readonly hit: Phaser.GameObjects.Rectangle;
  /** Clipped row parts stay invisible; these guards keep them from catching pointer input. */
  private readonly guards: Phaser.GameObjects.Rectangle[] = [];
  private readonly hint: Phaser.GameObjects.Container;
  private readonly hintLabel: Phaser.GameObjects.Text;
  private readonly hintChevron: Phaser.GameObjects.Image;
  private readonly hintHit: Phaser.GameObjects.Rectangle;
  /** Shapes cannot be cropped; they are hidden while they cross the edge and restored after. */
  private readonly clipHidden = new Set<Phaser.GameObjects.GameObject>();
  private contentHeight = 0;
  private offset = 0;
  private dragging = false;
  private grabOffset: number | null = null;
  private hovered = false;
  private hiddenBelow = 0;
  private readonly height = LOBBY_CARD.rosterBottom - LOBBY_CARD.rosterTop;

  constructor(private readonly scene: Phaser.Scene, private readonly parent: Phaser.GameObjects.Container,
    private readonly content: Phaser.GameObjects.Container,
    private readonly canScroll: () => boolean, private readonly onChange: () => void) {
    // The centred roster keeps its full width; the drag target sits beyond its right edge.
    this.track = scene.add.rectangle(BAR_X, LOBBY_CARD.rosterTop, BAR_W, this.height, FOREST.sunken, 0.85)
      .setOrigin(0.5, 0).setStrokeStyle(1, FOREST.border, 0.45);
    this.thumb = scene.add.rectangle(BAR_X, LOBBY_CARD.rosterTop, BAR_W, THUMB_MIN_H, FOREST.muted, 0.85).setOrigin(0.5, 0);
    this.track.setRounded?.(BAR_W / 2);
    this.thumb.setRounded?.(BAR_W / 2);
    this.hit = scene.add.rectangle(BAR_X, LOBBY_CARD.rosterTop, 28, this.height, 0, 0)
      .setOrigin(0.5, 0).setInteractive({ cursor: BUTTON_CURSOR });

    this.hintChevron = scene.add.image(0, 0, ensureIconTexture(scene, 'chevron-right', 24, FOREST.muted))
      .setDisplaySize(12, 12).setAngle(90);
    this.hintLabel = scene.add.text(10, 0, '', textStyle('caption', { color: FOREST.muted })).setOrigin(0, 0.5);
    this.hintHit = scene.add.rectangle(0, 0, 160, 26, 0, 0).setInteractive({ cursor: BUTTON_CURSOR });
    this.hint = scene.add.container(LOBBY_CARD.left + LOBBY_CARD.width / 2, HINT_Y,
      [this.hintHit, this.hintChevron, this.hintLabel]);
    for (const object of [this.track, this.thumb, this.hit, this.hint, this.hintChevron, this.hintLabel, this.hintHit]) {
      object.setScrollFactor(0);
    }
    parent.add([this.track, this.thumb, this.hit, this.hint]);

    this.hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.canScroll()) return;
      const y = this.pointerY(pointer) - this.thumb.y;
      // Grabbing the thumb keeps its grip point; a click on the track centres the thumb there.
      this.grabOffset = y >= 0 && y <= this.thumb.displayHeight ? y : null;
      this.dragging = true;
      this.sync();
      this.move(pointer);
    });
    this.hit.on('pointerover', () => { this.hovered = true; this.sync(); });
    this.hit.on('pointerout', () => { this.hovered = false; this.sync(); });
    this.hintHit.on('pointerover', () => this.hint.setAlpha(1));
    this.hintHit.on('pointerout', () => this.hint.setAlpha(0.82));
    this.hintHit.on('pointerdown', () => {
      if (this.canScroll()) this.setOffset(this.offset + this.height - LOBBY_ROSTER_ROW_STEP);
    });
    this.hint.setAlpha(0.82);

    this.createGuards();
    scene.input.on('wheel', this.wheel);
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.release);
    this.sync();
  }

  get scrollOffset(): number { return this.offset; }
  private get maxOffset(): number { return Math.max(0, this.contentHeight - this.height); }
  setContentHeight(height: number): void {
    this.contentHeight = height;
    this.offset = Math.min(this.offset, this.maxOffset);
    this.sync();
  }
  /** Players below the viewport that are not fully visible; drives the "more players" hint. */
  setHiddenBelow(count: number): void {
    if (this.hiddenBelow === count) return;
    this.hiddenBelow = count;
    this.hintLabel.setText(t('ui.lobby.morePlayers', { count }));
    // Chevron and label are centred together under the roster.
    this.hintChevron.setX(-(this.hintLabel.width + 18) / 2 + 6);
    this.hintLabel.setX(this.hintChevron.x + 12);
    this.sync();
  }
  reset(): void { this.dragging = false; this.grabOffset = null; this.sync(); }
  private setOffset(offset: number): void {
    const next = Phaser.Math.Clamp(offset, 0, this.maxOffset);
    if (this.offset === next) return;
    this.offset = next;
    this.sync();
    this.onChange();
  }
  private sync(): void {
    const scrollable = this.maxOffset > 0;
    for (const object of [this.track, this.thumb, this.hit]) object.setVisible(scrollable);
    this.hint.setVisible(scrollable && this.hiddenBelow > 0);
    const active = this.dragging || this.hovered;
    const width = active ? BAR_ACTIVE_W : BAR_W;
    const size = Math.max(THUMB_MIN_H, this.height * this.height / Math.max(this.height, this.contentHeight));
    this.thumb.setDisplaySize(width, size)
      .setY(LOBBY_CARD.rosterTop + (this.height - size) * this.offset / Math.max(1, this.maxOffset));
    this.thumb.setFillStyle(active ? FOREST.text : FOREST.muted, active ? 1 : 0.85);
    this.track.setDisplaySize(width, this.height);
    for (const guard of this.guards) guard.setVisible(scrollable);
  }

  /** Guards sit right above the roster layer, below every other card control. */
  private createGuards(): void {
    const cardContent = this.content.parentContainer;
    const index = cardContent?.getIndex(this.content) ?? -1;
    for (const [y, originY] of [[LOBBY_CARD.rosterTop, 1], [LOBBY_CARD.rosterBottom, 0]] as const) {
      const guard = this.scene.add.rectangle(LOBBY_CARD.left + LOBBY_CARD.width / 2, y, GUARD_W,
        LOBBY_ROSTER_ROW_STEP, 0, 0).setOrigin(0.5, originY).setScrollFactor(0).setInteractive();
      this.guards.push(guard);
      if (cardContent && index >= 0) cardContent.addAt(guard, index + 1);
      else this.parent.add(guard);
    }
  }

  /** Crops a positioned roster object (row, header or invite) to the viewport. */
  clip(object: Phaser.GameObjects.GameObject): void {
    let offsetY = 0;
    for (let ancestor = object.parentContainer; ancestor && ancestor !== this.content; ancestor = ancestor.parentContainer) {
      offsetY += ancestor.y;
    }
    this.clipObject(object, offsetY);
  }
  private clipObject(object: Phaser.GameObjects.GameObject, offsetY: number): void {
    if (object instanceof Phaser.GameObjects.Container) {
      for (const child of object.list) this.clipObject(child, offsetY + object.y);
      return;
    }
    const leaf = object as ClipLeaf;
    const top = offsetY + leaf.y - leaf.displayHeight * leaf.originY;
    const bottom = top + leaf.displayHeight;
    const inside = top >= LOBBY_CARD.rosterTop && bottom <= LOBBY_CARD.rosterBottom;
    if (typeof leaf.setCrop === 'function' && leaf.frame && leaf.displayHeight > 0) {
      if (inside) {
        if (leaf.isCropped) leaf.setCrop();
        return;
      }
      // Crop works in frame pixels; Text frames can carry a resolution above display size.
      const scale = leaf.frame.height / leaf.displayHeight;
      const from = Phaser.Math.Clamp((LOBBY_CARD.rosterTop - top) * scale, 0, leaf.frame.height);
      const to = Phaser.Math.Clamp((LOBBY_CARD.rosterBottom - top) * scale, 0, leaf.frame.height);
      leaf.setCrop(0, from, leaf.frame.width, Math.max(0, to - from));
      return;
    }
    if (!inside && leaf.visible) {
      leaf.setVisible(false);
      this.clipHidden.add(leaf);
    } else if (inside && this.clipHidden.delete(leaf)) leaf.setVisible(true);
  }

  private pointerY(pointer: Phaser.Input.Pointer): number {
    return toDesignSpace(this.scene.scale, pointer.y) - this.parent.y;
  }
  private readonly release = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.grabOffset = null;
    this.sync();
  };
  private readonly move = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragging || !this.canScroll()) return;
    const grip = this.grabOffset ?? this.thumb.displayHeight / 2;
    this.setOffset((this.pointerY(pointer) - LOBBY_CARD.rosterTop - grip)
      / Math.max(1, this.height - this.thumb.displayHeight) * this.maxOffset);
  };
  private readonly wheel = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void => {
    if (!this.canScroll()) return;
    const x = toDesignSpace(this.scene.scale, pointer.x);
    const y = this.pointerY(pointer);
    if (x < LOBBY_CARD.left + LOBBY_CARD.padding || x > BAR_X + 14
      || y < LOBBY_CARD.rosterTop || y > LOBBY_CARD.rosterBottom) return;
    // A modal above the card must consume its own input, including wheel events.
    if (over.some(object => {
      let ancestor = object.parentContainer;
      while (ancestor && ancestor !== this.parent) ancestor = ancestor.parentContainer;
      return ancestor !== this.parent;
    })) return;
    this.setOffset(this.offset + Math.sign(dy) * LOBBY_ROSTER_ROW_STEP);
  };
  destroy(): void {
    this.scene.input.off('wheel', this.wheel);
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.release);
    this.clipHidden.clear();
    for (const guard of this.guards) guard.destroy();
    this.track.destroy(); this.thumb.destroy(); this.hit.destroy(); this.hint.destroy(true);
  }
}
