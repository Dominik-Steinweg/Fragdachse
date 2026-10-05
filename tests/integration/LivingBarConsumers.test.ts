import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Textures: { CanvasTexture: class {} },
  Scenes: { Events: { UPDATE: 'update', POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
    Average: (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length,
    Linear: (start: number, end: number, t: number) => start + (end - start) * t },
}));
vi.mock('../../src/utils/phaserFx', () => ({ addExternalGlow: () => null, removeExternalFx: () => {} }));
vi.mock('../../src/ui/OverlayAssets', () => ({ getOverlayAssets: () => ({ ready: () => true }) }));

// Observe the UI -> effect boundary. The real field, sampling and quality lifecycle are
// exercised in the core tests; these tests execute the consumers' builders and transitions.
const effects: TestEffect[] = [];
class TestEffect {
  active: boolean;
  destroyed = false;
  filledWidth: number;
  marker = new UiObject('living');
  constructor(_scene: unknown, public parent: UiObject, public x: number, public y: number,
    public width: number, public height: number, _palette: unknown, public opts: any = {}) {
    this.active = opts.startActive ?? true;
    this.filledWidth = width;
    effects.push(this);
    parent.add(this.marker);
    parent.once('destroy', () => this.destroy());
  }
  start() { if (!this.destroyed) this.active = true; }
  stop() { this.active = false; }
  destroy() { this.stop(); this.destroyed = true; }
  setFilledWidth(width: number) { this.filledWidth = width; }
  setEnergyIntensity() {}
}
vi.mock('../../src/ui/LivingBarEffect', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/ui/LivingBarEffect')>(),
  LivingBarEffect: function (...args: ConstructorParameters<typeof TestEffect>) { return new TestEffect(...args); },
}));

import { UiButton } from '../../src/ui/UiButton';
import { bindUiAudio } from '../../src/ui/UiAudio';
import { LobbyPlayerProgress } from '../../src/ui/LobbyPlayerProgress';
import { DEPTH, GAME_WIDTH } from '../../src/config';
import { getLocale, setLocale, t } from '../../src/i18n';
import { OptionsOverlay } from '../../src/ui/OptionsOverlay';
import { LeftSidePanel } from '../../src/ui/LeftSidePanel';
import { HudResourceRow } from '../../src/ui/HudResourceRow';
import { CoopDefenseUpgradesOverlay } from '../../src/ui/CoopDefenseUpgradesOverlay';
import { CoopDefenseTutorialPanel } from '../../src/ui/CoopDefenseTutorialPanel';
import { HELP_CONTROLS } from '../../src/config/helpControls';
import { CoopDefenseItemsOverlay } from '../../src/ui/CoopDefenseItemsOverlay';
import { CoopDefenseItemRewardOverlay } from '../../src/ui/CoopDefenseItemRewardOverlay';
import { MatchResultsOverlay } from '../../src/ui/MatchResultsOverlay';
import { getCoopDefenseProgressSnapshot } from '../../src/utils/coopDefenseProgression';

class UiObject extends EventEmitter {
  visible = true;
  active = true;
  alpha = 1;
  depth = 0;
  width = 40;
  height = 20;
  scaleX = 1;
  scaleY = 1;
  scrollFactorX = 1;
  scrollFactorY = 1;
  list: UiObject[] = [];
  parentContainer: UiObject | null = null;
  texture = { key: '' };
  frame = { width: 32, height: 32 };
  text = '';
  crop: number[] = [];
  constructor(public kind: string, public x = 0, public y = 0) { super(); this.setMaxListeners(0); }
  add(objects: UiObject | UiObject[]) {
    for (const object of Array.isArray(objects) ? objects : [objects]) { this.list.push(object); object.parentContainer = this; }
    return this;
  }
  addAt(object: UiObject, index: number) { this.list.splice(index, 0, object); object.parentContainer = this; return this; }
  bringToTop(object: UiObject) { this.list = this.list.filter(child => child !== object); this.list.push(object); return this; }
  removeAll(destroy = false) { if (destroy) for (const child of [...this.list]) child.destroy(); this.list = []; return this; }
  setVisible(v: boolean) { this.visible = v; return this; }
  setAlpha(a: number) { this.alpha = a; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setX(x: number) { this.x = x; return this; }
  setY(y: number) { this.y = y; return this; }
  setTexture(key: string) { this.texture.key = key; return this; }
  setScrollFactor(x: number, y = x) { this.scrollFactorX = x; this.scrollFactorY = y; return this; }
  setCrop(...crop: number[]) { this.crop = crop; return this; }
  setText(text: string) { this.text = text; return this; }
  setColor() { return this; }
  setOrigin() { return this; }
  setDisplaySize() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setInteractive() { return this; }
  disableInteractive() { return this; }
  setStrokeStyle() { return this; }
  setStroke() { return this; }
  setFillStyle() { return this; }
  setTint() { return this; }
  clearTint() { return this; }
  setFontSize() { return this; }
  setWordWrapWidth() { return this; }
  setBlendMode() { return this; }
  setScale() { return this; }
  setFrame() { return this; }
  setSlices() { return this; }
  setLetterSpacing() { return this; }
  setAngle() { return this; }
  stop() { return this; }
  killAll() { return this; }
  emitParticleAt() { return this; }
  clear() { return this; }
  fillStyle() { return this; }
  lineStyle() { return this; }
  fillRoundedRect() { return this; }
  strokeRoundedRect() { return this; }
  fillPoints() { return this; }
  fillRect() { return this; }
  fillTriangle() { return this; }
  lineBetween() { return this; }
  beginPath() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  strokePath() { return this; }
  generateTexture() { return this; }
  destroy() { if (!this.active) return; this.active = false; this.emit('destroy'); this.removeAll(true); }
}

function sceneStub() {
  const tweens: any[] = [];
  const scene: any = {
    input: Object.assign(new EventEmitter(), { setDraggable() {}, dragDistanceThreshold: 3, keyboard: new EventEmitter() }),
    events: new EventEmitter(), load: new EventEmitter(),
    tweens: { killTweensOf() {}, add: (config: any) => {
      const tween = { ...config, removed: false, remove() { this.removed = true; }, destroy() { this.removed = true; }, stop() { this.removed = true; } };
      tweens.push(tween);
      return tween;
    } },
    time: { now: 0, delayedCall: () => ({ destroy() {}, remove() {} }) },
    textures: {
      exists: () => true, remove() {},
      get: () => ({ has: () => true }),
      createCanvas: () => ({ context: {
        createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
      }, refresh() {} }),
    },
    add: {
      container: (x = 0, y = 0, children: UiObject[] = []) => new UiObject('container', x, y).add(children),
      image: (x = 0, y = 0, key: string) => new UiObject('image', x, y).setTexture(key),
      text: (x = 0, y = 0, text = '') => new UiObject('text', x, y).setText(text),
      rectangle: (x = 0, y = 0) => new UiObject('rectangle', x, y),
      circle: (x = 0, y = 0) => new UiObject('circle', x, y),
      nineslice: (x = 0, y = 0) => new UiObject('nineslice', x, y),
      graphics: () => new UiObject('graphics'),
      particles: () => new UiObject('particles'),
    },
  };
  return { scene, tweens };
}

beforeEach(() => { effects.length = 0; });

describe('reopened overlay language and ownership', () => {
  const labels = {
    items: 'ui.items.equipped', upgrades: 'ui.upgrades.cancel', rewards: 'ui.items.rewardBack',
    results: 'ui.results.skipHint', syncing: 'ui.results.continueLobby',
  } as const;
  const texts = (object: UiObject): string[] => [object.text, ...object.list.flatMap(texts)];

  it.each(['items', 'upgrades', 'rewards', 'results', 'syncing'] as const)(
    'reopens %s in the current language and releases the previous view', kind => {
      const locale = getLocale();
      const { scene, tweens } = sceneStub();
      let overlay: any;
      try {
        setLocale('de');
        const closed = vi.fn();
        const presentation = { outcome: 'defeat', mode: 'coop_defense', modeLabel: 'Coop', mapLabel: 'Map',
          localPlayerId: 'local', leaderboard: [], progress: null, technicalMessage: null, itemReward: null } as const;
        const item = { uid: 'reward', slot: 'armor', rarity: 'white', itemLevel: 1, baseValue: 25, affixes: [] } as const;
        const reward = { roundEndedAt: 10, queueIndex: 1, queueSize: 1, epicGuaranteeCount: 0, options: [{
          item, equipped: { ...item, uid: 'equipped' }, directEquip: false, comparison: [], freeStashSlots: 0, salvageXp: 1,
          stash: Array.from({ length: 10 }, (_, index) => ({ ...item, uid: `stored-${index}` })),
        }] } as const;
        if (kind === 'items') overlay = new CoopDefenseItemsOverlay(scene,
          () => ({ items: [], equippedItemIds: {}, pendingRewardCount: 0 }),
          vi.fn(), vi.fn(), vi.fn(), vi.fn(), closed);
        else if (kind === 'upgrades') overlay = new CoopDefenseUpgradesOverlay(scene,
          () => getCoopDefenseProgressSnapshot(0), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(),
          vi.fn(), vi.fn(), vi.fn(), () => ({ weapon1: null, weapon2: null, utility: null, ultimate: null }),
          vi.fn(), vi.fn(), vi.fn(), closed);
        else if (kind === 'rewards') overlay = new CoopDefenseItemRewardOverlay(scene, vi.fn(), () => reward, closed);
        else {
          overlay = new MatchResultsOverlay(scene, closed);
          overlay.setBalanceFeedbackVisible(true); // Meta sets eligibility before showing the view.
        }
        const open = () => {
          if (kind === 'rewards') {
            overlay.show(reward);
            overlay.cards[0].takeButton.emit('pointerdown');
          } else if (kind === 'results') overlay.showReplay(presentation);
          else if (kind === 'syncing') overlay.showSyncing('Coop', 'Map');
          else overlay.show();
        };
        open();
        const oldRoot = overlay.container as UiObject;
        const oldTooltip = (overlay.tooltip ?? overlay.rewardTooltip).container as UiObject;
        const oldEffects = effects.slice();
        const oldLabel = t(labels[kind]);
        expect(texts(oldRoot)).toContain(oldLabel);
        if (kind === 'upgrades') {
          overlay.picker.open({ anchorX: 0, anchorY: 0, title: 'Picker', groups: [{ label: null, entries: [{
            key: 'test', displayName: 'Test', textureKey: null, accentColor: 0xffffff,
            selected: false, disabled: false, onPick: vi.fn(),
          }] }] });
          expect(scene.input.keyboard.listenerCount('keydown-ESC')).toBe(1);
        }
        overlay.hide();
        expect(scene.input.keyboard.listenerCount('keydown-ESC')).toBe(0);
        const fadeOut = kind === 'upgrades' ? tweens.at(-1) : null;
        setLocale('en');
        expect(t(labels[kind])).not.toBe(oldLabel);
        open();
        expect(texts(overlay.container)).toContain(t(labels[kind]));
        expect(oldRoot.active).toBe(false);
        expect(oldTooltip.active).toBe(false);
        expect(oldEffects.every(effect => effect.destroyed)).toBe(true);
        if (fadeOut) expect(fadeOut.removed).toBe(true);
        if (kind === 'results' || kind === 'syncing') expect(overlay.balanceFeedbackAvailable).toBe(true);
        if (kind === 'results') expect(overlay.balanceFeedbackButton.visible).toBe(true);
        expect(scene.load.eventNames().every((event: string) => scene.load.listenerCount(event) === 1)).toBe(true);
        const currentRoot = overlay.container;
        overlay.hide(); open();
        expect(overlay.container).toBe(currentRoot);
        if (kind === 'results') overlay.continueToLobby();
        expect(closed).not.toHaveBeenCalled();
        overlay.destroy();
        expect(scene.load.eventNames()).toEqual([]);
        expect(effects.every(effect => effect.destroyed)).toBe(true);
        expect(scene.input.dragDistanceThreshold).toBe(3);
      } finally { overlay?.destroy(); setLocale(locale); }
    },
  );
});

describe('living UI consumer ownership', () => {
  it('sounds central buttons once at their configured activation edge and keeps rejected or disabled actions silent', () => {
    const { scene } = sceneStub();
    const playLocalSound = vi.fn();
    const unbind = bindUiAudio(scene, { playLocalSound });
    const onClick = vi.fn(() => true);
    const button = new UiButton(scene, { x: 0, y: 0, w: 100, h: 30, onClick, activateOn: 'pointerup' });
    const bg = button.getBackground();
    bg.emit('pointerover'); bg.emit('pointerover');
    expect(playLocalSound).toHaveBeenCalledExactlyOnceWith('sfx_menu_hover');
    bg.emit('pointerup', { id: 1 });
    expect(onClick).not.toHaveBeenCalled();
    bg.emit('pointerdown', { id: 1 });
    expect(onClick).not.toHaveBeenCalled();
    bg.emit('pointerup', { id: 1 }); bg.emit('pointerup', { id: 1 });
    expect(onClick).toHaveBeenCalledOnce();
    expect(playLocalSound).toHaveBeenLastCalledWith('sfx_menu_activate');
    onClick.mockReturnValue(false);
    bg.emit('pointerdown', { id: 1 }); bg.emit('pointerup', { id: 1 });
    button.setEnabled(false);
    bg.emit('pointerdown', { id: 1 }); bg.emit('pointerup', { id: 1 });
    expect(playLocalSound).toHaveBeenCalledTimes(2);
    unbind(); button.destroy();
  });
  it.each(['default', 'forest'] as const)('places button decoration between face and content, including badges and hover transforms (%s)', (skin) => {
    const { scene, tweens } = sceneStub();
    const button = new UiButton(scene, { x: 400, y: 120, w: 190, h: 44, label: 'Items', icon: 'lock', skin });
    expect(button.getBackground().texture.key.includes('_forest_')).toBe(skin === 'forest');
    const layer = button.getEffectLayer() as unknown as UiObject;
    layer.add(new UiObject('living'));
    button.setBadge(2);
    const root = button.getRoot() as unknown as UiObject;
    expect(root.list.map(child => child.kind)).toEqual(['image', 'container', 'image', 'text', 'container']);
    expect(layer.parentContainer).toBe(root);
    expect([layer.x, layer.y, layer.scrollFactorX, layer.scrollFactorY]).toEqual([0, 0, 0, 0]);
    expect(button.getEffectBounds()).toEqual({ x: -93, y: -20, width: 186, height: 40, radius: 12 });
    button.getBackground().emit('pointerover');
    expect(tweens.at(-1).targets).toBe(root);
    button.destroy();
    expect(layer.active).toBe(false);
    expect(layer.list).toEqual([]);
  });

  it('binds both Lobby button effects to their layers and to actual Coop-band visibility', () => {
    const { scene } = sceneStub();
    const lobby: any = new LobbyPlayerProgress(scene, () => {}, () => {});
    lobby.build([]);
    const tooltip = lobby.itemsTooltip.container as UiObject;
    expect(tooltip.parentContainer).toBeNull();
    expect(tooltip.depth).toBeGreaterThan(DEPTH.OVERLAY);
    expect(effects.every(effect => !effect.active)).toBe(true);
    for (const [effect, button] of [[lobby.upgradeBtnEffect, lobby.coopUpgradesBtn], [lobby.itemsBtnEffect, lobby.coopItemsBtn]]) {
      expect(effect.parent).toBe(button.getEffectLayer());
      expect(effect.opts.clipShape).toEqual({ kind: 'roundedRect', ...button.getEffectBounds() });
    }
    expect(lobby.upgradeBtnEffect.opts.variantKey).not.toBe(lobby.itemsBtnEffect.opts.variantKey);
    const progress = { level: 2, levelProgressFraction: 0.5, availableUpgradePoints: 1, availableBossPoints: 0, earnedBossPoints: 0 };
    lobby.setCoopDefenseItemsState(true, 2, false); // Items may arrive before Progress.
    lobby.setCoopDefenseProgress(progress);
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setVisible(true);
    expect(effects.every(effect => effect.active)).toBe(true);
    lobby.setCoopDefenseProgress(null);
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setCoopDefenseItemsState(true, 2, false); // Cached state must stay paused.
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setCoopDefenseProgress(progress);
    expect(effects.every(effect => effect.active)).toBe(true);
    lobby.setVisible(false);
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setVisible(true); // No new snapshot required to restore the last state.
    expect(effects.every(effect => effect.active)).toBe(true);
    tooltip.setVisible(true);
    lobby.setVisible(false);
    expect(tooltip.visible).toBe(false);
    lobby.setVisible(true);
    expect(tooltip.visible).toBe(false);
    lobby.destroy();
    expect(tooltip.active).toBe(false);
    expect(effects.every(effect => effect.destroyed)).toBe(true);
  });

  it('starts and stops Options slider effects, preserving hidden fill updates', () => {
    const { scene, tweens } = sceneStub();
    const options: any = new OptionsOverlay(scene, { setMasterVolume() {} } as never, {} as never);
    options.container = new UiObject('container').setVisible(false);
    options.buildSlider({ key: 'master', label: 'Master', trackY: 100, palette: { dark: 0, mid: 1, light: 2 } }, []);
    for (const method of ['syncFromAudioSystem', 'syncQualityButtons', 'syncAbortSection']) options[method] = () => {};
    expect(effects[0].active).toBe(false);
    options.show();
    expect(effects[0].active).toBe(true);
    options.hide();
    expect(effects[0].active).toBe(false);
    const fadeOut = tweens.at(-1);
    options.setSliderValue('master', 0.25, false, false);
    const storedWidth = effects[0].filledWidth;
    options.show();
    expect(fadeOut.removed).toBe(true);
    expect(effects[0].active).toBe(true);
    expect(effects[0].filledWidth).toBe(storedWidth);
    options.hide();
    options.destroy();
    expect(effects[0].destroyed).toBe(true);
  });

  it('keeps one input binding through language rebuilds and releases it when closed', () => {
    const { scene } = sceneStub();
    scene.scale = { width: GAME_WIDTH };
    const setMasterVolume = vi.fn();
    const options: any = new OptionsOverlay(scene, { setMasterVolume, playLocalSound: vi.fn() } as never, {} as never);
    for (const method of ['syncFromAudioSystem', 'syncQualityButtons', 'buildMusicLoadingIndicator']) options[method] = () => {};
    const locale = getLocale();
    try {
      options.setLocaleSelectionBinding({ canChange: () => true, onChanged: vi.fn() });
      options.build(); options.show();
      for (let change = 0; change < 3; change++) {
        const next = getLocale() === 'de' ? 'en' : 'de';
        options.localeButtons.get(next).background.emit('pointerdown');
        expect(options.isOpen()).toBe(true);
        expect(scene.input.listenerCount('pointermove')).toBe(1);
        expect(scene.input.listenerCount('pointerup')).toBe(1);
        options.draggingSliderKey = 'master';
        setMasterVolume.mockClear();
        scene.input.emit('pointermove', { x: GAME_WIDTH / 2 });
        expect(setMasterVolume).toHaveBeenCalledOnce();
        scene.input.emit('pointerup');
        expect(options.draggingSliderKey).toBeNull();
      }
      options.hide();
      expect(scene.input.listenerCount('pointermove')).toBe(0);
      expect(scene.input.listenerCount('pointerup')).toBe(0);
      options.show(); options.destroy();
      expect(scene.input.listenerCount('pointermove')).toBe(0);
      expect(scene.input.listenerCount('pointerup')).toBe(0);
    } finally { options.destroy(); setLocale(locale); }
  });

  it('sounds an accepted language selection once and keeps the selected language silent', () => {
    const { scene } = sceneStub();
    const options: any = new OptionsOverlay(scene, {} as never, {} as never);
    for (const method of ['syncFromAudioSystem', 'syncQualityButtons', 'buildMusicLoadingIndicator']) options[method] = () => {};
    const playLocalSound = vi.fn();
    const unbind = bindUiAudio(scene, { playLocalSound });
    const locale = getLocale();
    try {
      options.setLocaleSelectionBinding({ canChange: () => true, onChanged: vi.fn() });
      options.build(); options.show();
      const next = locale === 'de' ? 'en' : 'de';
      options.localeButtons.get(next).background.emit('pointerdown');
      expect(playLocalSound).toHaveBeenCalledExactlyOnceWith('sfx_menu_activate');
      options.localeButtons.get(next).background.emit('pointerdown');
      expect(playLocalSound).toHaveBeenCalledTimes(1);
    } finally { options.destroy(); unbind(); setLocale(locale); }
  });

  it('refreshes tutorial controls after the lobby language changes before the next mission', () => {
    const { scene } = sceneStub();
    const locale = getLocale();
    const tutorial: any = new CoopDefenseTutorialPanel(scene);
    try {
      setLocale('de'); tutorial.build();
      tutorial.updateTutorial('Erste Mission', true);
      const previousRoots = [tutorial.tutorialContainer, tutorial.tutorialStepContainer];
      tutorial.reset();
      setLocale('en'); tutorial.updateTutorial('Next mission', true);
      const controlTexts = tutorial.tutorialControlsObjects
        .filter((object: UiObject) => object.kind === 'text').map((object: UiObject) => object.text);
      expect(controlTexts).toEqual([t('ui.help.heading'), ...HELP_CONTROLS.flatMap(entry => [t(entry.keyId), t(entry.descriptionKey)])]);
      expect(tutorial.tutorialBody.text).toBe('Next mission');
      expect(previousRoots.every(root => !root.active)).toBe(true);
      const current = tutorial.tutorialContainer;
      tutorial.updateTutorial('Next mission', true);
      tutorial.updateTutorialStep('Next checkpoint');
      expect(tutorial.tutorialContainer).toBe(current);
      expect(current.active).toBe(true);
    } finally { tutorial.destroy(); setLocale(locale); }
  });

  it('keeps built and closed color swatches inactive, including late refreshes', () => {
    const { scene } = sceneStub();
    const bridge = { getAvailableColors: () => [], getPlayerColor: () => 0, getLocalPlayerId: () => 'local' };
    const panel: any = new LeftSidePanel(scene, bridge as never, {} as never, {} as never);
    panel.pickerContainer = panel.buildPickerContainer();
    panel.schedulePickerDismissListener = () => {};
    expect(effects.length).toBeGreaterThan(1);
    expect(effects.every(effect => !effect.active && effect.opts.sampling === 'compact')).toBe(true);
    bridge.getAvailableColors = () => panel.pickerSwatches.map((swatch: any) => swatch.color);
    panel.openColorPicker();
    expect(effects.every(effect => effect.active)).toBe(true);
    panel.closeColorPicker();
    expect(effects.every(effect => !effect.active)).toBe(true);
    panel.refreshPickerSwatches();
    expect(effects.every(effect => !effect.active)).toBe(true);
    panel.destroyPickerEffects();
    expect(effects.every(effect => effect.destroyed)).toBe(true);
  });

  it('creates lower HUD bars inactive, runs them only while filled and releases them on clear', () => {
    const { scene } = sceneStub();
    const row = new HudResourceRow(scene, new UiObject('container') as never);
    expect(effects).toHaveLength(0);
    const ultimate = { id: 'ultimate', side: 'right', tone: 'red', title: 'Ultimate', frac: 0.7, energy: 1 } as const;
    row.sync([ultimate]);
    expect(effects).toHaveLength(1);
    expect(effects[0].opts.startActive).toBe(false);
    expect(effects[0].active).toBe(true);
    row.sync([{ ...ultimate, frac: 0 }]);
    expect(effects[0].active).toBe(false);
    row.sync([ultimate]);
    row.setPresentationActive(false);
    expect(effects[0].active).toBe(false);
    row.setPresentationActive(true);
    expect(effects[0].active).toBe(true);
    row.clear();
    expect(effects[0].destroyed).toBe(true);
  });

  it('uses the full node contour and stable identity even for hidden partial fills', () => {
    const { scene } = sceneStub();
    const overlay: any = new (CoopDefenseUpgradesOverlay as any)(scene);
    overlay.upgradesContainer = new UiObject('container');
    overlay.getNodeTextureKey = () => null;
    const visuals = { nodeBase: 0, nodeStroke: 1, nodeActive: 2, connector: 3 };
    const node = { id: 'test-upgrade', label: 'Upgrade', kind: 'upgrade', unlocked: true,
      level: 1, maxLevel: 2, startingLevel: 0, refundable: true, bossPointCostPerLevel: 0 };
    overlay.renderNode({ node, x: 100, y: 100 }, visuals);
    const effect = effects[0];
    expect(effect.active).toBe(false);
    expect(effect.opts.sampling).toBe('compact');
    expect(effect.opts.variantKey).toBe(node.id);
    const clip = effect.opts.clipShape;
    expect(effect.y).toBe(clip.y + clip.height / 2);
    expect(effect.height).toBe(clip.height / 2);
    expect(clip.width).toBe(clip.height);
    const group = overlay.upgradesContainer.list[0];
    expect(group.list.indexOf(effect.marker)).toBeGreaterThan(0);
    expect(group.list.findIndex((child: UiObject) => child.kind === 'text')).toBeGreaterThan(group.list.indexOf(effect.marker));
    overlay.visible = true;
    overlay.container = new UiObject('container');
    overlay.hide();
    expect(effect.destroyed).toBe(true);
    overlay.renderNode({ node: { ...node, id: 'base', kind: 'unlock', startingLevel: 1, refundable: false }, x: 0, y: 0 }, visuals);
    expect(effects).toHaveLength(1); // Base unlocks stay static.
  });

  it('cancels a stale upgrade fade when reopened and starts its XP effect again', () => {
    const { scene, tweens } = sceneStub();
    const overlay: any = new (CoopDefenseUpgradesOverlay as any)(scene);
    overlay.container = new UiObject('container').setVisible(false);
    overlay.xpBarEffect = new TestEffect(scene, overlay.container, 0, 0, 100, 12, {}, { startActive: false });
    overlay.refresh = () => {}; // Node refresh ownership is independent of the container fade.
    overlay.show();
    overlay.hide();
    const fadeOut = tweens.at(-1);
    expect(overlay.xpBarEffect.active).toBe(false);
    overlay.show();
    expect(fadeOut.removed).toBe(true);
    expect(overlay.xpBarEffect.active).toBe(true);
    overlay.destroy();
    expect(tweens.at(-1).removed).toBe(true);
    expect(effects.every(effect => effect.destroyed)).toBe(true);
  });
});
