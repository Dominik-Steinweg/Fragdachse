import * as Phaser from 'phaser';
import { textStyle, TEXT } from './ForestModal';
import { ensureIconTexture, type UiIconName } from './uiTextures';
import { GAME_HEIGHT } from '../config';

/** One item of the Bauhof's inventory: a base reward or a personal build, placed or not. */
export interface PersistentBaseInventoryCard {
  readonly key: string;
  readonly label: string;
  /** The item's own World artwork, centred at 0, 0; fitted into the card. */
  readonly art: () => Phaser.GameObjects.Container | null;
  readonly state: 'unplaced' | 'placed' | 'missed';
  /** A guest sees the host's rewards, and missed rewards cannot be taken. */
  readonly takeable: boolean;
  /** Owner colour of a personal build; null for the base's own rewards. */
  readonly ownerColor: number | null;
  readonly fresh: boolean;
  readonly conflict: boolean;
  readonly info: { readonly title: string; readonly lines: readonly string[]; readonly note?: string };
}

export interface PersistentBaseInventoryEvents {
  /** A card was pressed with the primary button. */
  press(key: string, pointer: Phaser.Input.Pointer): void;
  /** Infos only while nothing is carried or dragged. */
  canShowInfo(): boolean;
}

const COLUMNS = 4, VISIBLE_ROWS = 3, GAP = 10, SCROLLBAR = 12;
const ART_BOX = 58;
const INFO_WIDTH = 300;
const COLORS = {
  card: 0x16261b, cardHover: 0x20372a, border: 0x5f7350, selected: 0xf0d48a, conflict: 0xff7a68,
  placed: 0x9fd27a, fresh: 0xe9c56f, drop: 0xb1ed94, info: 0x0f1912, infoBorder: 0x8a7a4c,
} as const;

interface CardView {
  readonly card: PersistentBaseInventoryCard;
  readonly root: Phaser.GameObjects.Container;
  readonly frame: Phaser.GameObjects.Graphics;
  readonly art: Phaser.GameObjects.Container | null;
  readonly label: Phaser.GameObjects.Text;
  readonly badges: Phaser.GameObjects.Container;
  hover: boolean;
}

/**
 * The Bauhof's items as a grid of cards: large artwork, the name and a marker of their state.
 * Details (size, range, where it may stand) appear on hover and never while an item is carried.
 * Rows scroll whole, so cards are only ever fully shown or hidden.
 */
export class PersistentBaseInventory {
  private readonly root: Phaser.GameObjects.Container;
  private readonly area: Phaser.GameObjects.Graphics;
  private readonly scrollbar: Phaser.GameObjects.Graphics;
  private readonly empty: Phaser.GameObjects.Text;
  private readonly info: Phaser.GameObjects.Container;
  private readonly infoFrame: Phaser.GameObjects.Graphics;
  private readonly infoTitle: Phaser.GameObjects.Text;
  private readonly infoBody: Phaser.GameObjects.Text;
  private readonly infoNote: Phaser.GameObjects.Text;
  private views: CardView[] = [];
  private firstRow = 0;
  private selected: string | null = null;
  private dropTarget = false;
  private readonly cardWidth: number;
  private readonly cardHeight: number;

  constructor(private readonly scene: Phaser.Scene, parent: Phaser.GameObjects.Container,
    private readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    private readonly events: PersistentBaseInventoryEvents, emptyText: string) {
    this.cardWidth = Math.floor((rect.width - SCROLLBAR - GAP * (COLUMNS - 1)) / COLUMNS);
    this.cardHeight = Math.floor((rect.height - GAP * (VISIBLE_ROWS - 1)) / VISIBLE_ROWS);
    this.root = scene.add.container(0, 0);
    this.area = scene.add.graphics();
    this.scrollbar = scene.add.graphics();
    this.empty = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, emptyText, textStyle('body', { color: TEXT.muted }))
      .setOrigin(.5).setWordWrapWidth(rect.width - 80).setAlign('center').setVisible(false);
    this.root.add([this.area, this.scrollbar, this.empty]);
    this.info = scene.add.container(0, 0).setVisible(false);
    this.infoFrame = scene.add.graphics();
    this.infoTitle = scene.add.text(14, 12, '', textStyle('label', { color: 0xf1e4b8 })).setWordWrapWidth(INFO_WIDTH - 28);
    this.infoBody = scene.add.text(14, 0, '', { ...textStyle('body', { color: 0xdcd2ad }), lineSpacing: 4 }).setWordWrapWidth(INFO_WIDTH - 28);
    this.infoNote = scene.add.text(14, 0, '', textStyle('caption', { color: 0xb6ab86 })).setWordWrapWidth(INFO_WIDTH - 28);
    this.info.add([this.infoFrame, this.infoTitle, this.infoBody, this.infoNote]);
    parent.add([this.root, this.info]);
    this.drawArea();
  }

  /** Shows these cards; a card whose item is unchanged keeps its artwork. */
  setCards(cards: readonly PersistentBaseInventoryCard[]): void {
    const same = cards.length === this.views.length && cards.every((card, i) => card.key === this.views[i]!.card.key);
    if (!same) {
      for (const view of this.views) view.root.destroy(true);
      this.views = cards.map((card) => this.createView(card));
      this.firstRow = Math.min(this.firstRow, this.maxFirstRow());
    } else {
      this.views = this.views.map((view, i) => {
        const card = cards[i]!;
        if (card === view.card) return view;
        const next = { ...view, card };
        this.decorate(next);
        return next;
      });
    }
    this.empty.setVisible(cards.length === 0);
    this.layout();
  }

  setSelected(key: string | null): void {
    this.selected = key;
    for (const view of this.views) this.drawFrame(view);
    if (key) this.reveal(key);
  }

  /** Highlights the grid as the place to put a held item back. */
  setDropTarget(active: boolean): void {
    if (this.dropTarget === active) return;
    this.dropTarget = active;
    this.drawArea();
  }

  scroll(rows: number): void {
    const next = Math.max(0, Math.min(this.maxFirstRow(), this.firstRow + rows));
    if (next === this.firstRow) return;
    this.firstRow = next;
    this.hideInfo();
    this.layout();
  }

  contains(x: number, y: number): boolean {
    const r = this.rect;
    return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  }

  hideInfo(): void { this.info.setVisible(false); }

  destroy(): void {
    for (const view of this.views) view.root.destroy(true);
    this.views = [];
    this.root.destroy(true); this.info.destroy(true);
  }

  private maxFirstRow(): number {
    return Math.max(0, Math.ceil(this.views.length / COLUMNS) - VISIBLE_ROWS);
  }

  /** Scrolls the row of a card into view. */
  private reveal(key: string): void {
    const index = this.views.findIndex((view) => view.card.key === key);
    if (index < 0) return;
    const row = Math.floor(index / COLUMNS);
    if (row < this.firstRow) this.scroll(row - this.firstRow);
    else if (row >= this.firstRow + VISIBLE_ROWS) this.scroll(row - this.firstRow - VISIBLE_ROWS + 1);
  }

  private layout(): void {
    this.views.forEach((view, index) => {
      const row = Math.floor(index / COLUMNS) - this.firstRow, column = index % COLUMNS;
      const visible = row >= 0 && row < VISIBLE_ROWS;
      view.root.setVisible(visible).setPosition(this.rect.x + column * (this.cardWidth + GAP), this.rect.y + row * (this.cardHeight + GAP));
      if (view.frame.input) view.frame.input.enabled = visible;
    });
    const rows = Math.ceil(this.views.length / COLUMNS);
    this.scrollbar.clear();
    if (rows > VISIBLE_ROWS) {
      const x = this.rect.x + this.rect.width - 5, top = this.rect.y + 4, height = this.rect.height - 8;
      this.scrollbar.fillStyle(0x0c140f, .7).fillRoundedRect(x - 3, top, 6, height, 3);
      const thumb = height * VISIBLE_ROWS / rows, offset = (height - thumb) * this.firstRow / Math.max(1, rows - VISIBLE_ROWS);
      this.scrollbar.fillStyle(0xcdbd86, .75).fillRoundedRect(x - 3, top + offset, 6, thumb, 3);
    }
  }

  private drawArea(): void {
    const r = this.rect;
    this.area.clear();
    if (!this.dropTarget) return;
    // Putting an item back: the whole grid glows softly as the place it goes.
    for (const [grow, alpha] of [[10, .06], [6, .1], [3, .16]] as const) {
      this.area.lineStyle(grow, COLORS.drop, alpha).strokeRoundedRect(r.x - 6, r.y - 6, r.width + 12, r.height + 12, 12);
    }
    this.area.lineStyle(2, COLORS.drop, .9).strokeRoundedRect(r.x - 6, r.y - 6, r.width + 12, r.height + 12, 12);
  }

  private createView(card: PersistentBaseInventoryCard): CardView {
    const scene = this.scene, w = this.cardWidth, h = this.cardHeight;
    const root = scene.add.container(0, 0);
    const frame = scene.add.graphics();
    frame.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    const art = card.art();
    if (art) {
      const bounds = art.getBounds();
      const scale = Math.min(1.7, ART_BOX / Math.max(1, bounds.width), ART_BOX / Math.max(1, bounds.height));
      art.setScale(scale).setPosition(w / 2 - (bounds.centerX) * scale, 10 + ART_BOX / 2 - (bounds.centerY) * scale);
    }
    const label = scene.add.text(w / 2, h - 10, card.label, { ...textStyle('labelSm', { color: TEXT.primary }), align: 'center' })
      .setOrigin(.5, 1).setWordWrapWidth(w - 14).setMaxLines(2);
    const badges = scene.add.container(0, 0);
    root.add([frame, ...(art ? [art] : []), label, badges]);
    this.root.add(root);
    const view: CardView = { card, root, frame, art, label, badges, hover: false };
    frame.on('pointerover', () => { view.hover = true; this.drawFrame(view); this.showInfo(view); });
    frame.on('pointerout', () => { view.hover = false; this.drawFrame(view); this.hideInfo(); });
    frame.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0 || !view.card.takeable) return;
      this.hideInfo();
      this.events.press(view.card.key, pointer);
    });
    this.decorate(view);
    return view;
  }

  /** State marks: placed, missed, new, conflict and the owner of a personal build. */
  private decorate(view: CardView): void {
    const { card, badges } = view, scene = this.scene, w = this.cardWidth;
    view.frame.input!.cursor = card.takeable ? 'pointer' : 'default';
    view.art?.setAlpha(card.state === 'missed' ? .3 : card.state === 'placed' ? .5 : 1);
    view.label.setAlpha(card.state === 'unplaced' ? 1 : .7).setColor(card.state === 'missed' ? '#9c9478' : '#efe6c5');
    badges.removeAll(true);
    const badge = (x: number, color: number, icon: UiIconName | null, text?: string) => {
      const g = scene.add.graphics().fillStyle(0x0b120d, .85).fillCircle(x, 15, 10).lineStyle(1.5, color, 1).strokeCircle(x, 15, 10);
      badges.add(g);
      if (icon) badges.add(scene.add.image(x, 15, ensureIconTexture(scene, icon, 12, color)));
      if (text) badges.add(scene.add.text(x, 15, text, textStyle('labelSm', { color })).setOrigin(.5));
    };
    if (card.conflict) badge(w - 16, COLORS.conflict, null, '!');
    else if (card.state === 'placed') badge(w - 16, COLORS.placed, 'check');
    else if (card.state === 'missed') badge(w - 16, 0x9c9478, 'lock');
    else if (!card.takeable) badge(w - 16, 0xb6ab86, 'lock');
    if (card.fresh && card.state === 'unplaced') {
      const pill = scene.add.graphics().fillStyle(COLORS.fresh, .95).fillRoundedRect(7, 6, 40, 18, 9);
      badges.add([pill, scene.add.text(27, 15, 'NEU', textStyle('labelSm', { color: 0x21180a })).setOrigin(.5).setFontSize(11)]);
    } else if (card.ownerColor !== null) {
      badges.add(scene.add.graphics().fillStyle(0x0b120d, .85).fillCircle(15, 15, 8).fillStyle(card.ownerColor, 1).fillCircle(15, 15, 5));
    }
    this.drawFrame(view);
  }

  private drawFrame(view: CardView): void {
    const w = this.cardWidth, h = this.cardHeight, g = view.frame;
    const selected = view.card.key === this.selected;
    g.clear();
    if (selected) for (const [grow, alpha] of [[8, .08], [5, .14]] as const) {
      g.lineStyle(grow, COLORS.selected, alpha).strokeRoundedRect(-grow / 2, -grow / 2, w + grow, h + grow, 10);
    }
    g.fillStyle(view.hover && view.card.takeable ? COLORS.cardHover : COLORS.card, view.card.state === 'missed' ? .55 : .86)
      .fillRoundedRect(0, 0, w, h, 8);
    const border = view.card.conflict ? COLORS.conflict : selected ? COLORS.selected : COLORS.border;
    g.lineStyle(selected || view.card.conflict ? 2 : 1, border, selected || view.card.conflict ? 1 : .7).strokeRoundedRect(0, 0, w, h, 8);
  }

  private showInfo(view: CardView): void {
    if (!this.events.canShowInfo()) return;
    const { title, lines, note } = view.card.info;
    this.infoTitle.setText(title);
    this.infoBody.setText(lines.join('\n')).setY(this.infoTitle.y + this.infoTitle.height + 8);
    this.infoNote.setText(note ?? '').setVisible(!!note).setY(this.infoBody.y + this.infoBody.height + 8);
    const height = (note ? this.infoNote.y + this.infoNote.height : this.infoBody.y + this.infoBody.height) + 12;
    this.infoFrame.clear().fillStyle(COLORS.info, .97).fillRoundedRect(0, 0, INFO_WIDTH, height, 8)
      .lineStyle(1.5, COLORS.infoBorder, .9).strokeRoundedRect(0, 0, INFO_WIDTH, height, 8);
    // Left of the card: the grid sits at the right edge of the menu.
    const x = view.root.x - INFO_WIDTH - 12;
    const y = Math.max(16, Math.min(GAME_HEIGHT - height - 16, view.root.y));
    this.info.setPosition(x, y).setVisible(true);
    this.root.parentContainer?.bringToTop(this.info);
  }
}
