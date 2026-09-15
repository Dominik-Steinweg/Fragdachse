import * as Phaser from 'phaser';
import { HelpOverlay } from '../ui/HelpOverlay';
import { OptionsOverlay } from '../ui/OptionsOverlay';
import { CoopDefenseUpgradesOverlay } from '../ui/CoopDefenseUpgradesOverlay';
import { CoopDefenseItemsOverlay } from '../ui/CoopDefenseItemsOverlay';
import { CoopDefenseItemRewardOverlay } from '../ui/CoopDefenseItemRewardOverlay';
import { MatchResultsOverlay } from '../ui/MatchResultsOverlay';
import { RoomStatisticsOverlay } from '../ui/RoomStatisticsOverlay';
import { preloadForestAssets } from '../ui/LobbyForestAssets';
import { getForestModalSurfaces, preloadForestModalAssets } from '../ui/ForestModal';
import { ClarityCameraRegistry } from '../scenes/arena/ClarityCameraRegistry';
import { BackdropBlur } from '../effects/postfx/BackdropBlur';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getCoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import { buildDefaultCoopDefenseUpgradeProfile, COOP_DEFENSE_UPGRADE_DEFINITIONS, getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon, levelUpCoopDefenseUpgrade, levelDownCoopDefenseUpgrade,
  respecCoopDefenseUpgradeCategory, setLoadoutToolSlots } from '../utils/coopDefenseUpgrades';
import { rollCoopDefenseItem, type CoopDefenseEquippedItemIds } from '../utils/coopDefenseItems';
import { createMatchItemRewardPresentation, createMatchProgressDelta, type MatchResultsPresentation } from '../ui/MatchResultsModel';
import { COOP_DEFENSE_ITEM_SLOTS } from '../config/coopDefenseItems';
import { COOP_DEFENSE_ITEM_ART_LEVELS, COOP_DEFENSE_ITEM_ART_SLOTS, getCoopDefenseItemArtKey,
  getCoopDefenseItemEmptyArtKey } from '../ui/coopDefenseItemIcons';
import { LOADOUT_CATALOG_ENTRIES } from '../loadout/LoadoutConfig';
import { ROOM_STATISTICS_COUNTERS, type RoomPlayerStatistics } from '../network/RoomStatistics';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { CoopDefenseClassId, CoopDefenseItem, LoadoutSlot } from '../types';
import { setLocale, type Locale } from '../i18n';

const select = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const status = (message: string): void => { document.querySelector('output')!.textContent = message; };
type Overlay = { build(): void; destroy(): void; hide(): void };

class ForestUiPreview extends Phaser.Scene {
  private overlay: Overlay | null = null;
  private quality = new GraphicsQualityController('high');
  preload(): void {
    preloadForestAssets(this.load);
    preloadForestModalAssets(this.load);
    this.load.image('preview-grass', '/assets/sprites/gras_bg_tile.png');
    const keys = new Set<string>();
    const icon = (key: string | null, folder = 'Loadout'): void => {
      if (!key || keys.has(key)) return;
      keys.add(key); this.load.image(key, `/assets/sprites/${folder}/${key}.png`);
    };
    for (const entry of LOADOUT_CATALOG_ENTRIES) icon(entry.iconKey);
    for (const entry of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
      if (entry.kind === 'upgrade' || hasCoopDefenseDedicatedUpgradeIcon(entry.id)) icon(getCoopDefenseUpgradeTextureKey(entry.id));
    }
    for (const slot of COOP_DEFENSE_ITEM_ART_SLOTS) {
      icon(getCoopDefenseItemEmptyArtKey(slot), 'coop-defense');
      for (const level of COOP_DEFENSE_ITEM_ART_LEVELS) icon(getCoopDefenseItemArtKey(slot, level), 'coop-defense');
    }
  }
  create(): void {
    const clarity = this.cameras.add(0, 0, 1920, 1080).setName('clarity');
    const registry = new ClarityCameraRegistry(this, this.cameras.main, clarity);
    registry.install(); this.quality.attach(this);
    this.add.tileSprite(960, 540, 1920, 1080, 'preview-grass');
    const blur = new BackdropBlur(this, () => getForestModalSurfaces(this));
    const open = (): void => this.open();
    for (const id of ['menu', 'variant', 'locale']) select(id).addEventListener('change', open);
    document.getElementById('reopen')!.addEventListener('click', open);
    this.events.once('shutdown', () => {
      this.overlay?.destroy(); blur.destroy(); registry.destroy(); this.quality.destroy();
      for (const id of ['menu', 'variant', 'locale']) select(id).removeEventListener('change', open);
      document.getElementById('reopen')!.removeEventListener('click', open);
    });
    this.open();
  }
  private open(): void {
    this.overlay?.destroy(); this.overlay = null;
    setLocale(select('locale').value as Locale);
    const menu = select('menu').value, variant = select('variant').value, locked = variant === 'locked';
    status('Bereit · Änderungen nur im Arbeitsspeicher');
    const closed = (): void => { this.overlay?.hide(); status('Geschlossen · Neu öffnen zum Wiederholen'); };
    let seed = 14923;
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let items: CoopDefenseItem[] = COOP_DEFENSE_ITEM_SLOTS.flatMap(slot =>
      Array.from({ length: locked ? 1 : 11 }, (_, i) => ({ ...rollCoopDefenseItem(slot, 1 + i % 5, null, random), uid: `${slot}-${i}` })));
    const equipped: CoopDefenseEquippedItemIds = Object.fromEntries(COOP_DEFENSE_ITEM_SLOTS.map(slot => [slot, `${slot}-0`]));
    let pending = true;
    const offers = COOP_DEFENSE_ITEM_SLOTS.slice(0, 3).map(slot => rollCoopDefenseItem(slot, 5, null, random));
    const reward = () => createMatchItemRewardPresentation(pending ? { roundEndedAt: 100, mapId: '17', offers } : null,
      items, equipped, { index: 0, size: 3 });
    if (menu === 'help') {
      const overlay = new HelpOverlay(this); this.overlay = overlay; overlay.build(); overlay.show();
    } else if (menu === 'options') {
      const volume = { master: .75, effects: .65, music: .4 };
      const audio = { getMasterVolume: () => volume.master, getEffectsVolume: () => volume.effects, getMusicVolume: () => volume.music,
        setMasterVolume: (v: number) => { volume.master = v; }, setEffectsVolume: (v: number) => { volume.effects = v; },
        setMusicVolume: (v: number) => { volume.music = v; }, playLocalSound: () => status('Audio-Vorschau ausgelöst') } as unknown as GameAudioSystem;
      const overlay = new OptionsOverlay(this, audio, this.quality); this.overlay = overlay;
      overlay.setAbortMatchBinding({ canAbort: () => !locked && variant !== 'client', abort: closed });
      overlay.setSpectatorMatchBinding({ canSpectate: () => !locked, spectate: closed });
      overlay.setLocaleSelectionBinding({ canChange: () => locked, onChanged: locale => { select('locale').value = locale; } });
      overlay.build(); overlay.show();
    } else if (menu === 'items') {
      const overlay = new CoopDefenseItemsOverlay(this, () => ({ items, equippedItemIds: equipped, pendingRewardCount: 3 }),
        uid => { const item = items.find(i => i.uid === uid)!; equipped[item.slot] = uid; overlay.refresh(); },
        slot => { delete equipped[slot]; overlay.refresh(); },
        uid => { items = items.filter(i => i.uid !== uid); overlay.refresh(); },
        () => { select('menu').value = 'rewards'; this.open(); }, closed);
      this.overlay = overlay; overlay.build(); overlay.show();
    } else if (menu === 'rewards') {
      const overlay = new CoopDefenseItemRewardOverlay(this, (_round, uid, salvageUid, action) => {
        const item = offers.find(i => i.uid === uid)!; items = items.filter(i => i.uid !== salvageUid); items.push(item);
        if (action === 'equip') equipped[item.slot] = uid;
        pending = false; status('Angebot im Testzustand übernommen'); return true;
      }, reward, closed);
      this.overlay = overlay; overlay.build(); overlay.show(reward()!);
    } else if (menu === 'upgrades') {
      let classId: CoopDefenseClassId = 'inspector_gadachs', profile = buildDefaultCoopDefenseUpgradeProfile(classId);
      const progress = () => getCoopDefenseProgressSnapshot(locked ? 0 : 90000, profile, locked ? 0 : 15, classId, !locked);
      const loadout: Record<LoadoutSlot, string | null> = { weapon1: LOADOUT_CATALOG_ENTRIES.find(e => e.slot === 'weapon1')?.id ?? null, weapon2: LOADOUT_CATALOG_ENTRIES.find(e => e.slot === 'weapon2')?.id ?? null, utility: null, ultimate: null };
      const reset = (): boolean => { profile = buildDefaultCoopDefenseUpgradeProfile(classId); return true; };
      const overlay = new CoopDefenseUpgradesOverlay(this, progress,
        id => { const next = levelUpCoopDefenseUpgrade(profile, id, progress().level, 15, classId); if (next) profile = next; return !!next; },
        id => { const next = levelDownCoopDefenseUpgrade(profile, id, classId); if (next) profile = next; return !!next; },
        category => { const next = respecCoopDefenseUpgradeCategory(profile, category, classId); if (next) profile = next; return !!next; },
        reset, () => true, reset, id => { classId = id; reset(); overlay.refresh(); }, () => false,
        tools => { const next = setLoadoutToolSlots(profile, tools, classId); if (next) profile = next; return !!next; }, () => loadout,
        (slot, id) => { loadout[slot] = id; return true; }, closed, closed);
      this.overlay = overlay; overlay.build(); overlay.show();
    } else if (menu === 'statistics') {
      const rows: RoomPlayerStatistics[] = Array.from({ length: 24 }, (_, i) => ({
        ...Object.fromEntries(ROOM_STATISTICS_COUNTERS.map((key, j) => [key, (i + 1) * (j + 20)])),
        id: `p${i}`, name: i === 0 ? 'Dachs mit außergewöhnlich langem Namen' : `Walddachs ${i + 1}`,
        colorHex: [0xbcba75, 0x67b6bd, 0xc47368][i % 3], teamId: i % 2 ? 'red' : 'blue',
      } as RoomPlayerStatistics));
      const overlay = new RoomStatisticsOverlay(this); this.overlay = overlay; overlay.build(); overlay.show(rows);
    } else {
      const overlay = new MatchResultsOverlay(this, closed); this.overlay = overlay; overlay.build();
      const before = getCoopDefenseProgressSnapshot(87000, undefined, 12, 'inspector_gadachs', false);
      const after = getCoopDefenseProgressSnapshot(90000, undefined, 15);
      const presentation: MatchResultsPresentation = { outcome: variant === 'defeat' ? 'defeat' : 'victory',
        mode: 'coop_defense', modeLabel: 'Dachs vs. Zombies', mapLabel: 'Map 17 – Bierrettung', localPlayerId: 'p0',
        leaderboard: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: i === 0 ? 'Dachs mit außergewöhnlich langem Namen' : `Walddachs ${i + 1}`,
          colorHex: [0xbcba75, 0x67b6bd, 0xc47368][i % 3], teamId: null, frags: 120 - i * 7,
          roundEndedAt: 100, gameMode: 'coop_defense', mapName: '17' })),
        progress: createMatchProgressDelta(before, after, 3000, 'Map 18 – Bahnhof', true, true, true),
        technicalMessage: null, itemReward: reward() };
      if (variant === 'sync') overlay.showSyncing(presentation.modeLabel, presentation.mapLabel);
      else if (variant === 'technical') overlay.showTechnicalAbort(select('locale').value === 'en'
        ? 'The connection to the host was interrupted.' : 'Die Verbindung zum Host wurde unterbrochen.');
      else if (variant === 'replay') overlay.showReplay(presentation);
      else overlay.show(presentation);
    }
  }
}

void Promise.all([document.fonts.load('700 20px "Chakra Petch"'), document.fonts.load('500 20px "Chakra Petch"'),
  document.fonts.load('500 20px "JetBrains Mono"')]).then(() => {
  new Phaser.Game({ type: Phaser.WEBGL, parent: 'preview', width: 1920, height: 1080,
    backgroundColor: '#162319', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true }, audio: { noAudio: true }, scene: ForestUiPreview });
});
