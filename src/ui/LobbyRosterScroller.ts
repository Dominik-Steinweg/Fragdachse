import * as Phaser from 'phaser';
import { COLORS } from '../config';
import { toDesignSpace } from '../graphics/RenderResolution';
import { LOBBY_CARD } from './LobbyLayout';

/** Scrolls only roster content; fully clipped rows are hidden by the roster renderer. */
export class LobbyRosterScroller {
  private readonly track: Phaser.GameObjects.Rectangle;
  private readonly thumb: Phaser.GameObjects.Rectangle;
  private readonly hit: Phaser.GameObjects.Rectangle;
  private contentHeight = 0;
  private offset = 0;
  private dragging = false;
  private readonly height = LOBBY_CARD.rosterBottom - LOBBY_CARD.rosterTop;

  constructor(private readonly scene: Phaser.Scene, private readonly parent: Phaser.GameObjects.Container,
    private readonly canScroll: () => boolean, private readonly onChange: () => void) {
    const x = LOBBY_CARD.left + LOBBY_CARD.width - LOBBY_CARD.padding - 4;
    this.track = scene.add.rectangle(x, LOBBY_CARD.rosterTop, 4, this.height, COLORS.GREY_6, 0.35).setOrigin(0.5, 0);
    this.thumb = scene.add.rectangle(x, LOBBY_CARD.rosterTop, 6, 32, COLORS.GREY_4).setOrigin(0.5, 0);
    this.hit = scene.add.rectangle(x, LOBBY_CARD.rosterTop, 16, this.height, 0, 0)
      .setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    for (const object of [this.track, this.thumb, this.hit]) object.setScrollFactor(0);
    parent.add([this.track, this.thumb, this.hit]);
    this.hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.canScroll()) return;
      this.dragging = true;
      this.move(pointer);
    });
    scene.input.on('wheel', this.wheel);
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.release);
  }

  get scrollOffset(): number { return this.offset; }
  private get maxOffset(): number { return Math.max(0, this.contentHeight - this.height); }
  setContentHeight(height: number): void {
    this.contentHeight = height;
    this.offset = Math.min(this.offset, this.maxOffset);
    this.sync();
  }
  reset(): void { this.dragging = false; }
  private setOffset(offset: number): void {
    const next = Phaser.Math.Clamp(offset, 0, this.maxOffset);
    if (this.offset === next) return;
    this.offset = next;
    this.sync();
    this.onChange();
  }
  private sync(): void {
    const visible = this.maxOffset > 0;
    for (const object of [this.track, this.thumb, this.hit]) object.setVisible(visible);
    const size = Math.max(32, this.height * this.height / Math.max(this.height, this.contentHeight));
    this.thumb.setDisplaySize(6, size).setY(LOBBY_CARD.rosterTop + (this.height - size) * this.offset / Math.max(1, this.maxOffset));
  }
  private readonly release = (): void => { this.dragging = false; };
  private readonly move = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragging || !this.canScroll()) return;
    const y = toDesignSpace(this.scene.scale, pointer.y) - this.parent.y;
    this.setOffset((y - LOBBY_CARD.rosterTop - this.thumb.displayHeight / 2)
      / (this.height - this.thumb.displayHeight) * this.maxOffset);
  };
  private readonly wheel = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void => {
    if (!this.canScroll()) return;
    const x = toDesignSpace(this.scene.scale, pointer.x);
    const y = toDesignSpace(this.scene.scale, pointer.y) - this.parent.y;
    if (x < LOBBY_CARD.left + LOBBY_CARD.padding || x > LOBBY_CARD.left + LOBBY_CARD.width - LOBBY_CARD.padding
      || y < LOBBY_CARD.rosterTop || y > LOBBY_CARD.rosterBottom) return;
    // A modal above the card must consume its own input, including wheel events.
    if (over.some(object => {
      let ancestor = object.parentContainer;
      while (ancestor && ancestor !== this.parent) ancestor = ancestor.parentContainer;
      return ancestor !== this.parent;
    })) return;
    this.setOffset(this.offset + Math.sign(dy) * 48);
  };
  destroy(): void {
    this.scene.input.off('wheel', this.wheel);
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.release);
    this.track.destroy(); this.thumb.destroy(); this.hit.destroy();
  }
}
