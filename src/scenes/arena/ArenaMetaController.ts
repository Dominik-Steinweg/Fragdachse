import { COOP_DEFENSE_CLASS_IDS, DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../../config/coopDefenseItems';
import { isCoopDefenseMode } from '../../gameModes';
import { getSelectableLoadoutItems } from '../../loadout/LoadoutCatalog';
import type {
  CoopDefenseClassId,
  CoopDefenseItem,
  CoopDefenseItemRewardAction,
  CoopDefenseItemSlot,
  CoopDefensePendingItemReward,
  CoopDefenseUpgradeProfile,
  GameMode,
  GamePhase,
  LoadoutSlot,
  LoadoutToolRef,
} from '../../types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseToolCapacity,
  getCoopDefenseUpgradeLoadoutSelection,
  getSpentCoopDefenseBossPoints,
  getSpentCoopDefenseUpgradePoints,
  getUnlockedLoadoutToolRefs,
  levelDownCoopDefenseUpgrade,
  levelUpCoopDefenseUpgrade,
  respecCoopDefenseUpgradeCategory,
  setLoadoutToolSlots,
  type CoopDefenseUpgradeCategoryId,
} from '../../utils/coopDefenseUpgrades';
import {
  applyCoopDefenseEpicGuarantee,
  getEquippedCoopDefenseItems,
  rollCoopDefenseItemOffer,
  type CoopDefenseEquippedItemIds,
} from '../../utils/coopDefenseItems';
import {
  getCoopDefenseProgressSnapshot,
  type CoopDefenseProgressSnapshot,
} from '../../utils/coopDefenseProgression';
import type { CoopDefenseProgressPreferences } from '../../utils/localPreferences';
import {
  createMatchItemRewardPresentation,
  type MatchItemRewardPresentation,
} from '../../ui/MatchResultsModel';

const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];

/** Persistence bleibt der Adapter/Source of Truth; der Controller kennt nur diesen Vertrag. */
export interface ArenaMetaProgressStore {
  getProgress(): CoopDefenseProgressPreferences;
  restoreProgress(progress: CoopDefenseProgressPreferences): void;
  getClassLoadout(classId: CoopDefenseClassId): Partial<Record<LoadoutSlot, string>>;
  setClassLoadoutSlot(classId: CoopDefenseClassId, slot: LoadoutSlot, itemId: string): void;
  setSharedLoadoutSlot(slot: LoadoutSlot, itemId: string): void;
  switchClassLoadout(
    previousClassId: CoopDefenseClassId,
    nextClassId: CoopDefenseClassId,
    previousLoadout: Partial<Record<LoadoutSlot, string>>,
    nextLoadout: Partial<Record<LoadoutSlot, string>>,
  ): void;
  setUpgradeProfile(profile: CoopDefenseUpgradeProfile, classId?: CoopDefenseClassId): void;
  resetUpgradeProfiles(): void;
  setDebugProgress(totalXp: number, bossPoints: number, highestUnlockedMapId: string): void;
  resetCharacter(): void;
  setItemsUnlocked(unlocked: boolean): boolean;
  unlockItemsAfterVictory(completedMapId: string, firstReward?: CoopDefensePendingItemReward): boolean;
  markItemsSeen(): boolean;
  equipItem(uid: string): boolean;
  unequipItem(slot: CoopDefenseItemSlot): boolean;
  salvageItem(uid: string): number;
  setPendingItemReward(reward: CoopDefensePendingItemReward): boolean;
  claimPendingItemReward(
    roundEndedAt: number,
    offerUid: string,
    salvageUid?: string,
    action?: CoopDefenseItemRewardAction,
  ): ArenaMetaItemRewardClaim | null;
}

/** Kleine Bruecke auf den lokalen Spieler-/Ready-Stand, ohne Netzwerk-Substrat im Owner. */
export interface ArenaMetaSessionPort {
  getGamePhase(): GamePhase;
  getGameMode(): GameMode;
  getLocalPlayerId(): string;
  isLocalReady(): boolean;
  isAuthoritativeLocalReady(): boolean;
  getPlayerLoadoutSlot(playerId: string, slot: LoadoutSlot): string | null | undefined;
  setLocalLoadoutSlot(slot: LoadoutSlot, itemId: string): void;
  setLocalReady(ready: boolean): void;
  setLocalCoopDefenseTotalXp(totalXp: number): void;
}

/** Presentation bleibt bei den bestehenden Overlays/Panels; der Owner liefert nur Read-Daten. */
export interface ArenaMetaPresentationPort {
  setCoopDefenseProgress(progress: CoopDefenseProgressSnapshot | null): void;
  setCoopDefenseItemsState(unlocked: boolean, pendingRewardCount: number, hasUnseenItems: boolean): void;
  refreshUpgradeOverlay(): void;
  scheduleUpgradeOverlayRefresh(): void;
  refreshColorIndicator(): void;
  hideDebugOverlay(): void;
  showUpgradeOverlay(): void;
  showItemsOverlay(): void;
  refreshItemsOverlay(): void;
  isItemsOverlayOpen(): boolean;
  showItemRewardOverlay(presentation: MatchItemRewardPresentation, closeAfterClaim: boolean): void;
  isItemRewardOverlayVisible(): boolean;
}

export interface ArenaMetaItemsOverlayState {
  readonly items: readonly CoopDefenseItem[];
  readonly equippedItemIds: CoopDefenseEquippedItemIds;
  readonly pendingRewardCount: number;
}

export interface ArenaMetaItemRewardClaim {
  readonly acquired: CoopDefenseItem | null;
  readonly salvagedXp: number;
}

export interface ArenaMetaVictoryItemRewardInput {
  readonly completedMapId: string;
  readonly roundEndedAt: number;
  readonly itemLevel: number | null;
  readonly playedClassId: CoopDefenseClassId | null;
  readonly epicGuaranteeCount: number;
}

export interface ArenaMetaVictoryItemRewardResult {
  readonly itemsUnlocked: boolean;
  readonly reward: CoopDefensePendingItemReward | null;
}

export interface ArenaMetaControllerInput {
  readonly progressStore: ArenaMetaProgressStore;
  readonly session: ArenaMetaSessionPort;
  readonly presentation: ArenaMetaPresentationPort;
}

export interface ArenaMetaRefreshOptions {
  readonly stored?: CoopDefenseProgressPreferences;
  readonly refreshOverlay?: boolean;
  readonly forceLoadoutRefresh?: boolean;
}

/**
 * Scene-langlebiger Owner fuer persoenliche Coop-Progression, Upgrades und Loadout-Use-Cases.
 *
 * Der Controller haelt nur den validierten scene-lokalen Read-/Arbeitsstand. Dauerhafte Daten
 * bleiben im injizierten Persistence-Adapter; World-, Activity-, Result- und Persistent-Base-
 * Verantwortungen werden nicht hier gespiegelt oder ausgefuehrt.
 */
export class ArenaMetaController {
  private progress: CoopDefenseProgressSnapshot = getCoopDefenseProgressSnapshot(0);
  private storedProgress: CoopDefenseProgressPreferences | null = null;
  private upgradeProfileSnapshot: CoopDefenseProgressPreferences | null = null;
  private destroyed = false;

  constructor(private readonly input: ArenaMetaControllerInput) {}

  getProgress(): CoopDefenseProgressSnapshot {
    return this.progress;
  }

  /** Liefert den zuletzt validierten Stand; der Adapter bleibt die dauerhafte Wahrheit. */
  getStoredProgress(): CoopDefenseProgressPreferences {
    if (this.storedProgress === null) {
      this.storedProgress = this.input.progressStore.getProgress();
    }
    return this.storedProgress;
  }

  getLastProcessedRoundEndedAt(): number | null {
    return this.getStoredProgress().lastProcessedRoundEndedAt;
  }

  getHighestUnlockedMapId(): string {
    return this.getStoredProgress().highestUnlockedMapId;
  }

  getEquippedItems(): CoopDefenseItem[] {
    if (this.destroyed) return [];
    const stored = this.getStoredProgress();
    return getEquippedCoopDefenseItems(stored.items, stored.equippedItemIds);
  }

  getItemsOverlayState(): ArenaMetaItemsOverlayState {
    if (this.destroyed) {
      return { items: [], equippedItemIds: {}, pendingRewardCount: 0 };
    }
    const stored = this.getStoredProgress();
    return {
      items: stored.items,
      equippedItemIds: stored.equippedItemIds,
      pendingRewardCount: stored.pendingItemRewards.length,
    };
  }

  refreshItemsPresentation(): void {
    if (this.destroyed) return;
    const stored = this.getStoredProgress();
    this.input.presentation.setCoopDefenseItemsState(
      isCoopDefenseMode(this.input.session.getGameMode()) && stored.itemsUnlocked,
      stored.pendingItemRewards.length,
      stored.unseenItems,
    );
  }

  refresh(options: ArenaMetaRefreshOptions = {}): void {
    if (this.destroyed) return;

    const stored = options.stored ?? this.input.progressStore.getProgress();
    const previousProgress = this.progress;
    this.storedProgress = stored;

    const classesUnlocked = stored.unlockedClassIds.length > 0;
    const activeClassId = classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    this.progress = getCoopDefenseProgressSnapshot(
      stored.totalXp,
      activeProfile,
      stored.completedBossMapIds.length,
      activeClassId,
      classesUnlocked,
      stored.unlockedClassIds,
    );
    this.input.session.setLocalCoopDefenseTotalXp(this.progress.totalXp);

    const loadoutProjectionChanged = this.hasLoadoutProjectionChanged(
      previousProgress,
      this.progress,
    );
    const loadoutResynced = options.forceLoadoutRefresh || loadoutProjectionChanged
      ? this.resyncLoadoutWithUnlocks(stored)
      : false;
    if (options.forceLoadoutRefresh || loadoutResynced || loadoutProjectionChanged) {
      this.input.presentation.refreshColorIndicator();
    }

    this.input.presentation.setCoopDefenseProgress(
      isCoopDefenseMode(this.input.session.getGameMode()) ? this.progress : null,
    );
    this.refreshItemsPresentation();
    if (options.refreshOverlay !== false) this.input.presentation.refreshUpgradeOverlay();
  }

  openUpgradeOverlay(): void {
    if (this.destroyed) return;
    if (this.input.session.getGamePhase() !== 'LOBBY'
      || !isCoopDefenseMode(this.input.session.getGameMode())) return;
    if (this.input.session.isLocalReady() || this.input.session.isAuthoritativeLocalReady()) return;

    this.input.presentation.hideDebugOverlay();
    this.refresh({ refreshOverlay: false });
    this.upgradeProfileSnapshot = this.getStoredProgress();
    this.input.presentation.showUpgradeOverlay();
  }

  cancelUpgradeChanges(): void {
    if (this.destroyed) return;
    const snapshot = this.upgradeProfileSnapshot;
    this.upgradeProfileSnapshot = null;
    if (!snapshot) return;

    this.setLocalReady(false);
    this.input.progressStore.restoreProgress(snapshot);
    this.refresh({ stored: snapshot });
  }

  applyUpgradeChanges(): void {
    if (this.destroyed) return;
    this.upgradeProfileSnapshot = null;
  }

  selectClass(classId: CoopDefenseClassId): void {
    if (this.destroyed) return;
    if (this.input.session.getGamePhase() !== 'LOBBY'
      || !isCoopDefenseMode(this.input.session.getGameMode())) return;

    const stored = this.getStoredProgress();
    if (!stored.unlockedClassIds.includes(classId)) return;

    const previousLoadout: Partial<Record<LoadoutSlot, string>> = {};
    const localId = this.input.session.getLocalPlayerId();
    for (const slot of LOADOUT_SLOTS) {
      const itemId = this.input.session.getPlayerLoadoutSlot(localId, slot);
      if (itemId) previousLoadout[slot] = itemId;
    }

    const savedNextLoadout = this.input.progressStore.getClassLoadout(classId);
    const profile = stored.profilesByClass[classId];
    const nextLoadout: Partial<Record<LoadoutSlot, string>> = {};
    for (const slot of LOADOUT_SLOTS) {
      const selectable = getSelectableLoadoutItems(
        slot,
        this.input.session.getGameMode(),
        profile,
        classId,
      );
      if (selectable.length === 0) continue;
      const savedId = savedNextLoadout[slot];
      nextLoadout[slot] = savedId && selectable.some((item) => item.id === savedId)
        ? savedId
        : selectable[0].id;
    }

    this.setLocalReady(false);
    this.input.progressStore.switchClassLoadout(
      stored.selectedClassId,
      classId,
      previousLoadout,
      nextLoadout,
    );
    for (const slot of LOADOUT_SLOTS) {
      const itemId = nextLoadout[slot];
      if (itemId && this.input.session.getPlayerLoadoutSlot(localId, slot) !== itemId) {
        this.input.session.setLocalLoadoutSlot(slot, itemId);
      }
    }
    this.refreshAfterMutation({ ...stored, selectedClassId: classId });
  }

  levelUpUpgrade(upgradeId: string): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    const classesUnlocked = stored.unlockedClassIds.length > 0;
    const activeClassId = classesUnlocked ? stored.selectedClassId : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = levelUpCoopDefenseUpgrade(
      activeProfile,
      upgradeId,
      this.progress.level,
      stored.completedBossMapIds.length,
      activeClassId,
    );
    if (!nextProfile) return false;

    this.setLocalReady(false);
    this.input.progressStore.setUpgradeProfile(nextProfile, activeClassId);

    const loadoutSelection = getCoopDefenseUpgradeLoadoutSelection(upgradeId);
    if (loadoutSelection && activeClassId !== 'inspector_gadachs') {
      this.input.session.setLocalLoadoutSlot(loadoutSelection.slot, loadoutSelection.itemId);
      if (stored.classesUnlocked) {
        this.input.progressStore.setClassLoadoutSlot(
          activeClassId,
          loadoutSelection.slot,
          loadoutSelection.itemId,
        );
      } else {
        this.input.progressStore.setSharedLoadoutSlot(
          loadoutSelection.slot,
          loadoutSelection.itemId,
        );
      }
    }

    this.refreshAfterMutation(this.replaceLiveProfile(stored, activeClassId, nextProfile));
    return true;
  }

  levelDownUpgrade(upgradeId: string): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    const activeClassId = stored.classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = levelDownCoopDefenseUpgrade(activeProfile, upgradeId, activeClassId);
    if (!nextProfile) return false;

    this.setLocalReady(false);
    this.input.progressStore.setUpgradeProfile(nextProfile, activeClassId);
    this.refreshAfterMutation(this.replaceLiveProfile(stored, activeClassId, nextProfile));
    return true;
  }

  toggleLoadoutTool(tool: LoadoutToolRef): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    if (stored.selectedClassId !== 'inspector_gadachs') return false;

    const profile = stored.profilesByClass.inspector_gadachs;
    const current = [...(profile.toolLoadout ?? [])];
    const index = current.findIndex((entry) => entry.kind === tool.kind && entry.id === tool.id);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      if (current.length >= getCoopDefenseToolCapacity(profile)) return false;
      if (!getUnlockedLoadoutToolRefs(profile).some((entry) => (
        entry.kind === tool.kind && entry.id === tool.id
      ))) return false;
      current.push({ ...tool });
    }

    const nextProfile = setLoadoutToolSlots(profile, current);
    this.setLocalReady(false);
    this.input.progressStore.setUpgradeProfile(nextProfile, 'inspector_gadachs');
    this.refreshAfterMutation(this.replaceLiveProfile(stored, 'inspector_gadachs', nextProfile));
    return true;
  }

  setLoadoutTools(tools: readonly LoadoutToolRef[]): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    if (stored.selectedClassId !== 'inspector_gadachs') return false;

    const profile = stored.profilesByClass.inspector_gadachs;
    if (tools.length > getCoopDefenseToolCapacity(profile)) return false;
    const unlocked = getUnlockedLoadoutToolRefs(profile);
    if (!tools.every((tool) => unlocked.some((entry) => (
      entry.kind === tool.kind && entry.id === tool.id
    )))) return false;

    const nextProfile = setLoadoutToolSlots(profile, tools.map((tool) => ({ ...tool })));
    this.input.progressStore.setUpgradeProfile(nextProfile, 'inspector_gadachs');
    this.setLocalReady(false);
    this.refreshAfterMutation(this.replaceLiveProfile(stored, 'inspector_gadachs', nextProfile));
    return true;
  }

  getLocalLoadoutSelection(): Record<LoadoutSlot, string | null> {
    if (this.destroyed) {
      return { weapon1: null, weapon2: null, utility: null, ultimate: null };
    }
    const localId = this.input.session.getLocalPlayerId();
    return {
      weapon1: this.input.session.getPlayerLoadoutSlot(localId, 'weapon1') ?? null,
      weapon2: this.input.session.getPlayerLoadoutSlot(localId, 'weapon2') ?? null,
      utility: this.input.session.getPlayerLoadoutSlot(localId, 'utility') ?? null,
      ultimate: this.input.session.getPlayerLoadoutSlot(localId, 'ultimate') ?? null,
    };
  }

  selectLoadoutItem(slot: LoadoutSlot, itemId: string): boolean {
    if (this.destroyed) return false;
    if (this.input.session.getGamePhase() !== 'LOBBY'
      || !isCoopDefenseMode(this.input.session.getGameMode())) return false;

    const localId = this.input.session.getLocalPlayerId();
    if (this.input.session.getPlayerLoadoutSlot(localId, slot) === itemId) return false;
    const stored = this.getStoredProgress();

    this.setLocalReady(false);
    this.input.session.setLocalLoadoutSlot(slot, itemId);
    if (stored.classesUnlocked) {
      this.input.progressStore.setClassLoadoutSlot(stored.selectedClassId, slot, itemId);
    } else {
      this.input.progressStore.setSharedLoadoutSlot(slot, itemId);
    }
    this.refresh({ stored, refreshOverlay: false, forceLoadoutRefresh: true });
    this.input.presentation.scheduleUpgradeOverlayRefresh();
    return true;
  }

  categoryRespec(categoryId: CoopDefenseUpgradeCategoryId): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    const activeClassId = stored.classesUnlocked
      ? stored.selectedClassId
      : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const activeProfile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const nextProfile = respecCoopDefenseUpgradeCategory(activeProfile, categoryId, activeClassId);
    if (!nextProfile) return false;

    this.setLocalReady(false);
    this.input.progressStore.setUpgradeProfile(nextProfile, activeClassId);
    this.refreshAfterMutation(this.replaceLiveProfile(stored, activeClassId, nextProfile));
    return true;
  }

  classRespec(): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    if (!stored.classesUnlocked) return false;

    const activeClassId = stored.selectedClassId;
    const activeProfile = stored.profilesByClass[activeClassId];
    if (
      getSpentCoopDefenseUpgradePoints(activeProfile, activeClassId) <= 0
      && getSpentCoopDefenseBossPoints(activeProfile, activeClassId) <= 0
    ) return false;

    const nextProfile = buildDefaultCoopDefenseUpgradeProfile(activeClassId);
    this.setLocalReady(false);
    this.input.progressStore.setUpgradeProfile(nextProfile, activeClassId);
    this.refreshAfterMutation(this.replaceLiveProfile(stored, activeClassId, nextProfile));
    return true;
  }

  canFullRespec(): boolean {
    if (this.destroyed) return false;
    const stored = this.getStoredProgress();
    if (!stored.classesUnlocked) {
      return getSpentCoopDefenseUpgradePoints(
        stored.defaultProfile,
        DEFAULT_COOP_DEFENSE_CLASS_ID,
      ) > 0 || getSpentCoopDefenseBossPoints(
        stored.defaultProfile,
        DEFAULT_COOP_DEFENSE_CLASS_ID,
      ) > 0;
    }

    return COOP_DEFENSE_CLASS_IDS.some((classId) => {
      const profile = stored.profilesByClass[classId];
      return getSpentCoopDefenseUpgradePoints(profile, classId) > 0
        || getSpentCoopDefenseBossPoints(profile, classId) > 0;
    });
  }

  fullRespec(): boolean {
    if (this.destroyed || !this.canFullRespec()) return false;
    this.setLocalReady(false);
    this.input.progressStore.resetUpgradeProfiles();
    this.refresh({ refreshOverlay: false });
    this.input.presentation.scheduleUpgradeOverlayRefresh();
    return true;
  }

  setDebugProgress(totalXp: number, bossPoints: number, highestUnlockedMapId: string): void {
    if (this.destroyed) return;
    this.input.progressStore.setDebugProgress(totalXp, bossPoints, highestUnlockedMapId);
    this.refresh();
  }

  resetCharacter(): void {
    if (this.destroyed) return;
    this.input.progressStore.resetCharacter();
    this.refresh();
  }

  setDebugItemsUnlocked(unlocked: boolean): void {
    if (this.destroyed) return;
    this.input.progressStore.setItemsUnlocked(unlocked);
    this.refresh();
  }

  openItemsOverlay(): void {
    if (this.destroyed) return;
    if (this.input.session.getGamePhase() !== 'LOBBY'
      || !isCoopDefenseMode(this.input.session.getGameMode())) return;
    if (this.input.session.isLocalReady() || this.input.session.isAuthoritativeLocalReady()) return;

    const stored = this.readFreshStoredProgress();
    if (!stored.itemsUnlocked) return;

    this.input.presentation.hideDebugOverlay();
    this.input.progressStore.markItemsSeen();
    this.refresh({ refreshOverlay: false });
    this.input.presentation.showItemsOverlay();
  }

  equipItem(uid: string): boolean {
    if (this.destroyed || !this.input.progressStore.equipItem(uid)) return false;
    this.refresh();
    return true;
  }

  unequipItem(slot: CoopDefenseItemSlot): boolean {
    if (this.destroyed || !this.input.progressStore.unequipItem(slot)) return false;
    this.refresh();
    return true;
  }

  salvageItem(uid: string): number {
    if (this.destroyed) return 0;
    const xp = this.input.progressStore.salvageItem(uid);
    if (xp <= 0) return 0;
    this.refresh();
    return xp;
  }

  getItemRewardPresentation(roundEndedAt?: number): MatchItemRewardPresentation | null {
    if (this.destroyed) return null;
    const stored = this.readFreshStoredProgress();
    const pendingRewards = stored.pendingItemRewards;
    const index = roundEndedAt === undefined
      ? 0
      : pendingRewards.findIndex((reward) => reward.roundEndedAt === roundEndedAt);
    const pending = index >= 0 ? pendingRewards[index] : null;
    return createMatchItemRewardPresentation(
      pending,
      stored.items,
      stored.equippedItemIds,
      { index: index >= 0 ? index : 0, size: Math.max(1, pendingRewards.length) },
    );
  }

  openItemRewardOverlay(automaticRoundEndedAt?: number, automatic = false): void {
    if (this.destroyed || this.input.presentation.isItemRewardOverlayVisible()) return;
    if (automatic && automaticRoundEndedAt === undefined) return;

    const presentation = this.getItemRewardPresentation(automaticRoundEndedAt);
    if (!presentation) return;
    this.input.presentation.showItemRewardOverlay(presentation, automatic);
  }

  claimItemReward(
    roundEndedAt: number,
    offerUid: string,
    salvageUid?: string,
    action: CoopDefenseItemRewardAction = 'take',
  ): ArenaMetaItemRewardClaim | null {
    if (this.destroyed) return null;
    const claim = this.input.progressStore.claimPendingItemReward(
      roundEndedAt,
      offerUid,
      salvageUid,
      action,
    );
    if (!claim) return null;

    this.refresh();
    if (this.input.presentation.isItemsOverlayOpen()) {
      this.input.progressStore.markItemsSeen();
      this.refresh({ refreshOverlay: false });
    }
    this.input.presentation.refreshItemsOverlay();
    return claim;
  }

  recordVictoryItemReward(
    input: ArenaMetaVictoryItemRewardInput,
  ): ArenaMetaVictoryItemRewardResult {
    if (this.destroyed) return { itemsUnlocked: false, reward: null };

    const stored = this.getStoredProgress();
    const shouldAtomicallyUnlockItems = input.completedMapId === COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID
      && !stored.itemsUnlocked
      && input.itemLevel !== null;
    let itemsUnlocked = false;
    if (!shouldAtomicallyUnlockItems) {
      itemsUnlocked = this.input.progressStore.unlockItemsAfterVictory(input.completedMapId);
    }

    let reward: CoopDefensePendingItemReward | undefined;
    if (input.itemLevel !== null && (stored.itemsUnlocked || shouldAtomicallyUnlockItems)) {
      const offers = rollCoopDefenseItemOffer(input.itemLevel, input.playedClassId);
      reward = {
        roundEndedAt: input.roundEndedAt,
        mapId: input.completedMapId,
        epicGuaranteeCount: input.epicGuaranteeCount,
        offers: applyCoopDefenseEpicGuarantee(
          offers,
          input.epicGuaranteeCount,
          input.playedClassId,
        ),
      };
      if (shouldAtomicallyUnlockItems) {
        itemsUnlocked = this.input.progressStore.unlockItemsAfterVictory(
          input.completedMapId,
          reward,
        );
      } else {
        this.input.progressStore.setPendingItemReward(reward);
      }
    }

    const current = this.readFreshStoredProgress();
    return {
      itemsUnlocked,
      reward: current.pendingItemRewards.find(
        (entry) => entry.roundEndedAt === input.roundEndedAt,
      ) ?? null,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.upgradeProfileSnapshot = null;
  }

  private setLocalReady(ready: boolean): void {
    this.input.session.setLocalReady(ready);
  }

  private readFreshStoredProgress(): CoopDefenseProgressPreferences {
    const stored = this.input.progressStore.getProgress();
    this.storedProgress = stored;
    return stored;
  }

  private refreshAfterMutation(stored: CoopDefenseProgressPreferences): void {
    this.refresh({ stored, refreshOverlay: false });
    this.input.presentation.scheduleUpgradeOverlayRefresh();
  }

  private replaceLiveProfile(
    stored: CoopDefenseProgressPreferences,
    classId: CoopDefenseClassId,
    profile: CoopDefenseUpgradeProfile,
  ): CoopDefenseProgressPreferences {
    if (stored.unlockedClassIds.length === 0) {
      return { ...stored, defaultProfile: profile };
    }
    return {
      ...stored,
      profilesByClass: {
        ...stored.profilesByClass,
        [classId]: profile,
      },
    };
  }

  private hasLoadoutProjectionChanged(
    before: CoopDefenseProgressSnapshot,
    after: CoopDefenseProgressSnapshot,
  ): boolean {
    if (before.classId !== after.classId || before.toolSlotCapacity !== after.toolSlotCapacity) return true;
    if (before.unlockedClassIds.join('|') !== after.unlockedClassIds.join('|')) return true;
    if (before.toolLoadout.map((tool) => `${tool.kind}:${tool.id}`).join('|')
      !== after.toolLoadout.map((tool) => `${tool.kind}:${tool.id}`).join('|')) return true;
    for (const slot of LOADOUT_SLOTS) {
      const beforeItems = before.unlockedItemsBySlot[slot].map((item) => item.id).join('|');
      const afterItems = after.unlockedItemsBySlot[slot].map((item) => item.id).join('|');
      if (beforeItems !== afterItems) return true;
    }
    return false;
  }

  private resyncLoadoutWithUnlocks(stored: CoopDefenseProgressPreferences): boolean {
    if (this.input.session.getGamePhase() !== 'LOBBY'
      || !isCoopDefenseMode(this.input.session.getGameMode())) return false;

    const classId = stored.classesUnlocked ? stored.selectedClassId : DEFAULT_COOP_DEFENSE_CLASS_ID;
    const profile = stored.classesUnlocked
      ? stored.profilesByClass[stored.selectedClassId]
      : stored.defaultProfile;
    const localId = this.input.session.getLocalPlayerId();
    let changed = false;
    for (const slot of LOADOUT_SLOTS) {
      const selectable = getSelectableLoadoutItems(
        slot,
        this.input.session.getGameMode(),
        profile,
        classId,
      );
      if (selectable.length === 0) continue;
      const current = this.input.session.getPlayerLoadoutSlot(localId, slot);
      if (current && selectable.some((item) => item.id === current)) continue;
      this.input.session.setLocalLoadoutSlot(slot, selectable[0].id);
      changed = true;
      if (stored.classesUnlocked) {
        this.input.progressStore.setClassLoadoutSlot(classId, slot, selectable[0].id);
      } else {
        this.input.progressStore.setSharedLoadoutSlot(slot, selectable[0].id);
      }
    }
    return changed;
  }
}
