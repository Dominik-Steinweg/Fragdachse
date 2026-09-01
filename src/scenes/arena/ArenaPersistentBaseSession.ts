import type Phaser from 'phaser';
import { bridge } from '../../network/bridge';
import { emitArenaMapGridChanged } from './ArenaEvents';
import type { ArenaContext } from './ArenaContext';
import type { RockVisualHelper } from './RockVisualHelper';
import {
  COOP_DEFENSE_DISMANTLE_RANGE,
  COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
} from '../../config/coopDefenseConstructions';
import { isCoopDefenseMode } from '../../gameModes';
import type { GameMode, LoadoutUseResult, SyncedPlaceableRock, UtilityPlacementPreviewState } from '../../types';
import {
  getStoredLocalOwnerId,
  getStoredPersistentBaseRewardState,
  getStoredPersistentBaseRewardUnlocks,
  getStoredPersonalBaseContribution,
  grantStoredPersistentBaseRewards,
  setStoredPersistentBaseRewardState,
  setStoredPersonalBaseContribution,
} from '../../utils/localPreferences';
import { PersistentBaseRoomSession } from '../../persistentBase/PersistentBaseRoomSession';
import { PersistentBaseRewardGrantService } from '../../persistentBase/PersistentBaseRewardGrant';
import {
  getPersistentBaseRewardDefinition,
  isKnownPersistentBaseRewardId,
  type PersistentBaseRewardDefinition,
} from '../../persistentBase/PersistentBaseRewardCatalog';
import type {
  PersistentBaseRewardId,
  PersistentBaseRewardPlacement,
  PersistentBaseRewardPlacementRequest,
  PersistentBaseRewardSessionState,
} from '../../persistentBase/PersistentBaseRewardTypes';
import { sanitizePersistentBaseRewardPlacementRequest } from '../../persistentBase/PersistentBaseRewardTypes';
import {
  sanitizePersistentBaseMoveRequest,
  type PersistentBaseMoveRequest,
} from '../../persistentBase/PersistentBaseMove';
import {
  getPersistentBaseBuildAreaExtentCells,
  isCellInsidePersistentBaseBuildArea,
  resolvePersistentBaseCell,
} from '../../persistentBase/PersistentBaseCore';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../../persistentBase/PersistentBaseRoundOutcome';
import type { PersistentPlayerBaseContribution } from '../../persistentBase/PersistentBaseTypes';
import type { PersistentBaseTransactionIdentity } from '../../persistentBase/PersistentBaseTransaction';
import type { PersistentBaseWorldBinding } from '../../world/PersistentBaseWorldBinding';
import type { ConstructionWorldRuntime } from '../../world/ConstructionWorldRuntime';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type { WorldPersistentBaseSite } from '../../world/WorldRuntimeContext';
import type { WorldRuntime } from '../../world/WorldRuntime';
import type { WorldPlayerGameplayRuntime } from '../../world/WorldPlayerGameplayRuntime';

/**
 * Der raumlanglebige Owner der persistenten Basis dieses Raums.
 *
 * Er besitzt den committed Raumstand, den Arbeitsstand einer laufenden Activity, die
 * Belohnungsvergabe und alle host-seitigen Management-Anfragen: Platzieren, Verschieben,
 * Beitragsabgleich und Besitzerbindungen. Er lebt laenger als jede World und jede Runde und
 * gehoert deshalb nicht dem World-/Activity-Flow.
 *
 * Er liegt waehrend der Migration im Scene-/Adapter-Layer, weil er die bestehenden RPC-, UI- und
 * RPC-/UI-Pfade bedient; die eigentlichen PB-Owner (`PersistentBaseRoomSession`,
 * `PersistentBaseWorldBinding`, Stores) bleiben unveraendert die fachliche Wahrheit.
 */

/** Was die Session ueber die aktuell gebaute World wissen muss. */
export interface ArenaPersistentBaseWorldPorts {
  /** Die world-lokale Materialisierung der persistenten Basis; `null` ohne World. */
  readonly getWorldBinding: () => PersistentBaseWorldBinding | null;
  /** Der World-Owner der Konstruktionsregeln; `null` ohne World oder auf dem Client. */
  readonly getConstructionRuntime: () => ConstructionWorldRuntime | null;
  readonly getWorldRuntime: () => WorldRuntime | null;
  readonly getPlayerGameplayRuntime: () => WorldPlayerGameplayRuntime | null;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  /** Auch vor der lokalen World-Materialisierung beantwortbar: fuehrt diese World eine Basis? */
  readonly hasPersistentBaseSite: () => boolean;
  readonly getConfiguredGameMode: () => GameMode;
}

export interface ArenaPersistentBaseSessionInput {
  readonly scene: Phaser.Scene;
  readonly ctx: ArenaContext;
  readonly rockVisualHelper: RockVisualHelper;
  readonly world: ArenaPersistentBaseWorldPorts;
}

export class ArenaPersistentBaseSession {
  /**
   * Der raumlanglebige Zustand der persistenten Basis: committed Beitraege, committed
   * Belohnungen und der Arbeitsstand einer laufenden Activity.
   *
   * Genau ein Besitzpfad fuer Host und Gaeste. Er lebt laenger als jede World und jede Runde,
   * weil ein Spieler ueber einen Kartenwechsel hinweg Besitzer seiner Konstruktionen bleibt,
   * und stirbt mit dem Raum. Er wird nie lokal gespeichert und nie vom Kartenabbau geleert.
   */
  readonly session = new PersistentBaseRoomSession();
  /** Shared idempotent grant path for authored map-victory and objective rewards. */
  private readonly grantService = new PersistentBaseRewardGrantService();
  /**
   * Technischer Network-/Projection-Cache: monotone Revision des zuletzt publizierten Reward-
   * Snapshots. Die fachliche Reward-Revision bleibt im `PersistentBaseRewardStore`.
   */
  private projectionRevision = 0;
  /** Technischer Network-/Projection-Dedup-Cache, keine zweite fachliche Reward-Wahrheit. */
  private projectionSignature: string | null = null;

  private readonly scene: Phaser.Scene;
  private readonly ctx: ArenaContext;
  private readonly rockVisualHelper: RockVisualHelper;
  private readonly world: ArenaPersistentBaseWorldPorts;

  constructor(input: ArenaPersistentBaseSessionInput) {
    this.scene = input.scene;
    this.ctx = input.ctx;
    this.rockVisualHelper = input.rockVisualHelper;
    this.world = input.world;
  }

  private get worldRuntime(): WorldRuntime | null { return this.world.getWorldRuntime(); }
  private get placementSystem() { return this.worldRuntime?.materialization?.placement ?? null; }
  private get baseManager() { return this.worldRuntime?.materialization?.bases ?? null; }
  private get worldContext() { return this.worldRuntime?.context ?? null; }
  private get playerSystems() { return this.world.getPlayerGameplayRuntime()?.systems ?? null; }

  /** Uebernimmt die Runtime-Objekte der aktuellen World; ohne World fuehrt der Raum keine. */
  useWorldRuntimes(runtimes: Parameters<PersistentBaseRoomSession['useWorldRuntimes']>[0]): void {
    this.session.useWorldRuntimes(runtimes);
  }

  /**
   * Host-Gate fuer eine PB-Mutation gegen die aktuell offene Activity-Transaction.
   *
   * `PersistentBaseRoomSession` bleibt die einzige Source of Truth. Der World-Teil wird hier
   * bewusst mitgeprueft, damit dieser Gate sowohl fuer dedizierte Requests als auch fuer den
   * generischen Loadout-RPC dieselbe World-Revision schuetzt.
   */
  acceptsPersistentBaseMutation(
    worldRevision: number,
    activityRevision?: number,
  ): boolean {
    if (bridge.getCurrentWorldRevision() !== worldRevision) return false;
    return this.session.acceptsMutation({ worldRevision, activityRevision });
  }

  acceptsCurrentPersistentBaseMutation(activityRevision?: number): boolean {
    const worldRevision = bridge.getCurrentWorldRevision();
    return worldRevision !== null
      && this.session.acceptsMutation({ worldRevision, activityRevision });
  }

  /**
   * Oeffnet den PB-Working-State an der fachlichen Activity-Identity – nicht an ihrer lokalen
   * Runtime. Der Host bereitet den committed Raumstand hier vor, damit auch ein Activity-Start
   * ohne World-Rebuild eine frische Baseline erhaelt.
   */
  beginPersistentBaseTransaction(activity: ActivityDescriptor): void {
    if (!bridge.isHost() || !this.world.hasPersistentBaseSite()) return;
    this.ingestOfferedPersistentBaseContributions();
    this.session.rewards.replaceCommittedState(getStoredPersistentBaseRewardState());
    this.session.beginTransaction({
      worldRevision: activity.worldRevision,
      activityRevision: activity.activityRevision,
    });
  }

  /**
   * Beendet den PB-Working-State beim Ende der Activity-Identity. Ein vorher explizit
   * angewendetes Round-Ergebnis hat die Transaction bereits terminal geschlossen und ist daher
   * idempotent. Ein Activity-Wechsel ohne Ergebnis rollt den alten Working-State zurueck.
   */
  endPersistentBaseTransaction(activity: ActivityDescriptor): void {
    if (!bridge.isHost() || !this.session.hasOpenTransaction) return;
    applyPersistentBaseRoundOutcome('rollback', {
      session: this.session,
      isRuntimeObjectAlive: (runtimeId) => this.placementSystem?.hasRuntimeRock(runtimeId) === true,
      identity: {
        worldRevision: activity.worldRevision,
        activityRevision: activity.activityRevision,
      },
    });
    this.publishPersistentBaseRewardSessionState();
  }

  /** Grants authored persistent-base rewards to the frozen round participants. */
  grantAuthoredPersistentBaseRewards(
    rewardIds: readonly PersistentBaseRewardId[] | undefined,
  ): void {
    if (!bridge.isHost() || !rewardIds || rewardIds.length === 0) return;
    const result = this.grantService.grant(
      rewardIds,
      bridge.getRoundResultEligiblePlayerIds(),
      {
        localPlayerId: bridge.getLocalPlayerId(),
        applyLocal: grantStoredPersistentBaseRewards,
        confirmForPlayer: (playerId, ids) => bridge.hostGrantPersistentBaseRewards(playerId, ids),
      },
    );
    if (result.newlyGrantedByPlayerId.size > 0) this.publishPersistentBaseRewardSessionState();
  }

  /**
   * Haelt persoenlichen Beitrag und Host-Bestaetigung in Fluss.
   *
   * Beide Richtungen sind bewusst Zustand statt Ereignis: Ein spaeter beitretender Host liest den
   * Beitrag ohne Nachfrage, und eine Bestaetigung erreicht ihren Besitzer auch dann noch, wenn
   * sie waehrend eines Szenenwechsels ausgesprochen wurde.
   */
  syncPersistentBaseContributions(): void {
    // Anbieten heisst nicht bauen: Der Host entscheidet, was davon in seiner Welt steht.
    bridge.offerPersistentBaseContribution(getStoredPersonalBaseContribution());

    // Nur ein host-bestaetigter Stand darf lokal fortgeschrieben werden. Ohne diese Regel koennte
    // ein manipulierter Client seine eigene Revision erhoehen und ungeprueftes Bauwerk dauerhaft
    // in den autoritativen Fluss druecken.
    const confirmed = bridge.getConfirmedPersistentBaseContribution();
    if (confirmed && confirmed.ownerId === getStoredLocalOwnerId()) {
      setStoredPersonalBaseContribution(confirmed);
    }

    if (bridge.isHost()) this.ingestOfferedPersistentBaseContributions();
  }

  /**
   * Keeps personal host confirmations and the host-owned reward projection in sync. Clients only
   * persist the reliable cumulative grant state; the host publishes the current-world projection.
   */
  syncPersistentBaseRewards(): void {
    const confirmed = bridge.getConfirmedPersistentBaseRewardGrant();
    if (confirmed) grantStoredPersistentBaseRewards(confirmed.rewardIds);

    if (!bridge.isHost()) return;
    const site = this.worldContext?.persistentBaseSite ?? null;
    if (!site || !this.session.rewards) {
      bridge.publishPersistentBaseRewardSessionState(null);
      return;
    }
    this.publishPersistentBaseRewardSessionState();
  }

  /** Host entry point for the dedicated reward-placement RPC. */
  placePersistentBaseReward(
    playerId: string,
    request: PersistentBaseRewardPlacementRequest,
  ): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'blocked' };
    const sanitizedRequest = sanitizePersistentBaseRewardPlacementRequest(request);
    if (!sanitizedRequest) return { ok: false, reason: 'invalid' };
    if (!this.acceptsPersistentBaseMutation(
      sanitizedRequest.worldRevision,
      sanitizedRequest.activityRevision,
    )) return { ok: false, reason: 'blocked' };
    const site = this.worldContext?.persistentBaseSite ?? null;
    const store = this.session.rewards;
    const placementSystem = this.placementSystem;
    const world = bridge.getWorldDescriptor();
    if (!site || !store || !placementSystem || !world || sanitizedRequest.worldRevision !== world.worldRevision) {
      return { ok: false, reason: 'blocked' };
    }
    if (!isKnownPersistentBaseRewardId(sanitizedRequest.rewardId)) return { ok: false, reason: 'invalid' };
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!player || !player.active || !this.mayManagePersistentBase(playerId)
      || !this.world.getPlayerCapabilities(playerId).canPlace
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const unlocks = getStoredPersistentBaseRewardUnlocks();
    if (!store.canPlaceReward(sanitizedRequest.rewardId, unlocks)) return { ok: false, reason: 'blocked' };
    const definition = getPersistentBaseRewardDefinition(sanitizedRequest.rewardId);
    if (definition.category === 'baseTurret' && !this.isPersistentBaseRuntimeActive(site)) {
      return { ok: false, reason: 'blocked' };
    }
    const cell = this.resolvePersistentBaseRewardCell(site, sanitizedRequest);
    if (!cell || !this.isPersistentBaseRewardPlacementInDomain(definition, site, sanitizedRequest)) {
      return { ok: false, reason: 'placement' };
    }
    const cellWorld = placementSystem.getWorldPointForCell(cell.gridX, cell.gridY);
    if (Math.hypot(player.x - cellWorld.x, player.y - cellWorld.y) > COOP_DEFENSE_DISMANTLE_RANGE) {
      return { ok: false, reason: 'placement' };
    }
    if (store.getState().placements.some((entry) => {
      const occupied = this.resolvePersistentBaseRewardCell(site, entry);
      return occupied?.gridX === cell.gridX && occupied.gridY === cell.gridY;
    })) return { ok: false, reason: 'placement' };
    if (!placementSystem.canMaterializePersistentBaseRewardCell(cell.gridX, cell.gridY, true)) {
      return { ok: false, reason: 'placement' };
    }

    // A reward has higher composite priority than personal contributions. Remove only the
    // conflicting runtime object and release its runtime binding; the owner's blueprint remains.
    const occupant = placementSystem.getRuntimeRockAt(cell.gridX, cell.gridY);
    let displacedPersonalRuntimeId: number | null = null;
    if (occupant && occupant.ownership !== 'base-owned') {
      const isPersistentContribution = this.session.contributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true;
      // A reward may displace a persistent contribution, but must never silently delete an
      // unrelated live utility for which there is no blueprint to reconstruct on rollback.
      if (!isPersistentContribution) return { ok: false, reason: 'placement' };
      this.world.getWorldBinding()?.releasePersonalRuntimeForRewardConflict(occupant.id);
      displacedPersonalRuntimeId = occupant.id;
    }
    const placement: PersistentBaseRewardPlacement = {
      rewardId: sanitizedRequest.rewardId,
      relativeGridX: sanitizedRequest.relativeGridX,
      relativeGridY: sanitizedRequest.relativeGridY,
      angle: sanitizedRequest.angle,
    };
    if (!store.placeReward(placement)) return { ok: false, reason: 'blocked' };
    let runtime: SyncedPlaceableRock | null = null;
    try {
      runtime = this.world.getWorldBinding()?.materializeRewardPlacement(placement, definition) ?? null;
    } catch {
      // Keep the request transactional even if a provider throws instead of returning null.
      runtime = null;
    }
    if (!runtime) {
      store.rollbackPlacement(sanitizedRequest.rewardId);
      // Re-run the existing deterministic composite after every failed materialization. This
      // restores the displaced personal runtime from its unchanged blueprint, including any
      // pedestal registration, instead of maintaining a second reconstruction path here.
      this.reconcilePersistentBaseWorld();
      if (displacedPersonalRuntimeId !== null) {
        emitArenaMapGridChanged(this.scene.game.events, {
          reason: 'placeables_batch_removed',
          source: 'placeable_rock',
        });
      }
      return { ok: false, reason: 'placement' };
    }
    if (displacedPersonalRuntimeId !== null) {
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
    }
    this.persistCurrentCommittedPersistentBaseRewards();
    this.publishPersistentBaseRewardSessionState();
    this.reconcilePersistentBaseWorld();
    return { ok: true };
  }

  /** Liefert die lokale Reward-Vorschau aus dem verlaesslichen Session-Snapshot. */
  getPersistentBaseRewardIdsForPlayer(playerId: string): PersistentBaseRewardId[] {
    const site = this.worldContext?.persistentBaseSite ?? null;
    const session = bridge.getPersistentBaseRewardSessionState();
    // Enumeration and temporary availability are deliberately separate: an unlocked, unplaced
    // reward remains visible in the radial while the player is dead, burrowed or otherwise
    // unable to place. The action resolver supplies the disabled state; preview/host validation
    // below still enforce the capability contract.
    if (!site || !this.mayManagePersistentBase(playerId)) return [];

    const hostState = bridge.isHost() ? this.session.rewards?.getState() : undefined;
    const availableRewardIds = hostState
      ? getStoredPersistentBaseRewardUnlocks()
      : session?.availableRewardIds;
    const placements = hostState?.placements ?? session?.placements ?? [];
    if (!availableRewardIds) return [];
    // Kanonisches Placement-Gate nach 3F: freigeschaltet und aktuell nicht platziert. Ein
    // zurueckgebautes Reward ist damit wieder platzierbar; eine Platzierungshistorie existiert
    // nicht mehr.
    return availableRewardIds.filter((rewardId) => (
      !placements.some((placement) => placement.rewardId === rewardId)
      && (getPersistentBaseRewardDefinition(rewardId).category !== 'baseTurret'
        || this.isPersistentBaseRuntimeActive(site))
    ));
  }

  /**
   * Ob ein Spieler in dieser World ueberhaupt Persistent-Base-Management ausfuehren darf.
   *
   * Nach 3F ist das keine Klassenfrage mehr: Base-owned Rewards gehoeren der Host-Basis, nicht
   * dem ausfuehrenden Spieler, und jede Coop-Defense-Klasse darf sie platzieren, verschieben und
   * zurueckbauen. Persoenliche Konstruktionen bleiben davon unberuehrt strikt owner-basiert.
   */
  mayManagePersistentBase(playerId: string): boolean {
    return isCoopDefenseMode(this.world.getConfiguredGameMode())
      && bridge.getPlayerCurrentLoadoutSnapshot(playerId) !== null;
  }

  isPersistentBaseRuntimeActive(site: WorldPersistentBaseSite): boolean {
    const baseManager = this.baseManager;
    if (!baseManager) return true;
    const base = baseManager.getBase(site.baseId);
    return base !== undefined && !base.isInert();
  }

  /**
   * Verfuegbarkeit fuer eine lokale Persistent-Base-Vorschau.
   *
   * Der Host liest den autoritativen Combat-Runtime-State. Ein Client hat bewusst keinen lokalen
   * Combat-Runtime-State und verwendet deshalb den zuletzt replizierten PlayerNetState. Diese
   * Entscheidung gilt nur fuer Preview/UI; Commit-Pfade validieren weiterhin hostseitig separat.
   */
  isPlayerAvailableForPersistentBaseAction(playerId: string): boolean {
    if (bridge.isHost()) {
      return this.ctx.combatSystem.isAlive(playerId)
        && !this.ctx.combatSystem.isBurrowed(playerId);
    }

    const state = bridge.getLatestGameState()?.players[playerId];
    return state?.alive === true && state.isBurrowed !== true;
  }

  /** Liefert die lokale Reward-Vorschau aus dem verlaesslichen Session-Snapshot. */
  getPersistentBaseRewardPlacementPreview(
    playerId: string,
    rewardId: PersistentBaseRewardId,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const site = this.worldContext?.persistentBaseSite ?? null;
    const placementSystem = this.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    const session = bridge.getPersistentBaseRewardSessionState();
    if (!site || !placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      || !this.world.getPlayerCapabilities(playerId).canPlace
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)
      || !isKnownPersistentBaseRewardId(rewardId)) return undefined;

    const hostState = bridge.isHost() ? this.session.rewards?.getState() : undefined;
    const placements = hostState?.placements ?? session?.placements ?? [];
    if (!this.getPersistentBaseRewardIdsForPlayer(playerId).includes(rewardId)) return undefined;

    const definition = getPersistentBaseRewardDefinition(rewardId);
    if (definition.category === 'baseTurret' && !this.isPersistentBaseRuntimeActive(site)) return undefined;
    const targetCell = placementSystem.getClampedTargetCell(
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!targetCell) return undefined;
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, targetCell.gridX, targetCell.gridY);
    const angle = Math.atan2(targetCell.y - player.y, targetCell.x - player.x);
    const placement: PersistentBaseRewardPlacement | null = relative
      ? {
          rewardId,
          relativeGridX: relative.relativeGridX,
          relativeGridY: relative.relativeGridY,
          angle,
        }
      : null;
    const domainValid = placement !== null
      && this.isPersistentBaseRewardPlacementInDomain(definition, site, placement);
    const duplicateCell = placement !== null && placements.some((candidate) => {
      const occupied = this.resolvePersistentBaseRewardCell(site, candidate);
      return occupied?.gridX === targetCell.gridX && occupied.gridY === targetCell.gridY;
    });
    const occupant = placementSystem.getRuntimeRockAt(targetCell.gridX, targetCell.gridY);
    const persistentContribution = occupant
      ? this.session.contributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true
      : false;
    const conflictAllowed = !occupant || occupant.ownership === 'base-owned' || persistentContribution;
    const isValid = domainValid
      && !duplicateCell
      && conflictAllowed
      && placementSystem.canMaterializePersistentBaseRewardCell(targetCell.gridX, targetCell.gridY, true);
    return {
      angle,
      targetX: targetCell.x,
      targetY: targetCell.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: 0,
      range: COOP_DEFENSE_DISMANTLE_RANGE,
      kind: definition.category === 'baseTurret' ? 'turret' : 'pedestal',
      sourceSlot: 'utility',
      constructionId: definition.gameplaySource.kind === 'construction-definition'
        ? definition.gameplaySource.constructionId
        : undefined,
      powerUpDefId: definition.gameplaySource.kind === 'power-up-definition'
        ? definition.gameplaySource.powerUpDefId
        : undefined,
      mode: 'place',
    };
  }

  /** Sendet eine Preview-Auswahl ueber den dedizierten Reward-Pfad zum Host. */
  async requestPersistentBaseRewardPlacement(
    rewardId: PersistentBaseRewardId,
    preview: Pick<UtilityPlacementPreviewState, 'gridX' | 'gridY' | 'angle'>,
  ): Promise<LoadoutUseResult> {
    const site = this.worldContext?.persistentBaseSite ?? null;
    const world = bridge.getWorldDescriptor();
    if (!site || !world || !isKnownPersistentBaseRewardId(rewardId)) return { ok: false, reason: 'blocked' };
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, preview.gridX, preview.gridY);
    if (!relative) return { ok: false, reason: 'placement' };
    return bridge.sendPersistentBaseRewardPlacement({
      worldRevision: world.worldRevision,
      rewardId,
      relativeGridX: relative.relativeGridX,
      relativeGridY: relative.relativeGridY,
      angle: preview.angle,
    });
  }

  // ── Repositioning ─────────────────────────────────────────────────────────

  /**
   * Vorschau der Quellwahl: Was der Spieler unter dem Cursor verschieben darf.
   *
   * Bewusst dieselbe Ownership-Domain wie der Rueckbau: eigene persoenliche Konstruktion oder
   * ein base-owned Persistent-Base-Reward. Ein fremder Beitrag, authored Weltgeometrie und
   * nicht als Konstruktion gefuehrte Runtime-Objekte sind keine gueltigen Quellen.
   */
  getPersistentBaseMoveSourcePreview(
    playerId: string,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      // Host und Client verwenden dieselbe Availability-Regel; die Quelle des Zustands bleibt
      // dabei role-aware: autoritativer Combat-State beim Host, replizierter Player-State beim Client.
      || !this.world.getPlayerCapabilities(playerId).canDismantle
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)) return undefined;
    const preview = placementSystem.getManagementSourcePreview(
      playerId,
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
      'move-source',
    );
    if (!preview) return undefined;
    const source = preview.sourceRuntimeId === undefined
      ? undefined
      : placementSystem.getRuntimeRock(preview.sourceRuntimeId);
    return { ...preview, isValid: this.isMovablePersistentBaseSource(playerId, source) };
  }

  /** Zielvorschau einer bereits gewaehlten Quelle; ohne gueltige Quelle gibt es keine Vorschau. */
  getPersistentBaseMoveTargetPreview(
    playerId: string,
    sourceRuntimeId: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.placementSystem;
    const player = this.ctx.playerManager.getPlayer(playerId);
    const site = this.worldContext?.persistentBaseSite ?? null;
    if (!placementSystem || !player || !player.active
      || !this.mayManagePersistentBase(playerId)
      // Host und Client verwenden dieselbe Availability-Regel; die Quelle des Zustands bleibt
      // dabei role-aware: autoritativer Combat-State beim Host, replizierter Player-State beim Client.
      || !this.world.getPlayerCapabilities(playerId).canDismantle
      || !this.isPlayerAvailableForPersistentBaseAction(playerId)) return undefined;
    const source = placementSystem.getRuntimeRock(sourceRuntimeId);
    if (!this.isMovablePersistentBaseSource(playerId, source) || !source) return undefined;

    const rewardId = source.persistentRewardId;
    if (rewardId !== undefined) {
      if (!site || !isKnownPersistentBaseRewardId(rewardId)) return undefined;
      return this.buildPersistentBaseRewardMovePreview(site, rewardId, source, player, pointerX, pointerY);
    }

    const definition = this.world.getConstructionRuntime()?.getDefinition(source.constructionId);
    if (!definition) return undefined;
    const preview = placementSystem.getConstructionPlacementPreview(
      definition,
      player.x,
      player.y,
      pointerX,
      pointerY,
      source.id,
    );
    if (!preview) return undefined;
    // Ein persistenter Beitrag ist genau ein Beitrag innerhalb des Baubereichs. Verliesse er
    // ihn, koennte der Store ihn nicht mehr halten - das waere ein Abriss und kein Move.
    const staysPersistent = !this.isPersistentBaseBuildAreaCell(site, source.gridX, source.gridY)
      || this.isPersistentBaseBuildAreaCell(site, preview.gridX, preview.gridY);
    return { ...preview, isValid: preview.isValid && staysPersistent, mode: 'move-target', sourceRuntimeId };
  }

  /** Sendet eine Zielvorschau ueber den dedizierten Move-Pfad zum Host. */
  async requestPersistentBaseMove(
    sourceRuntimeId: number,
    preview: Pick<UtilityPlacementPreviewState, 'gridX' | 'gridY'>,
  ): Promise<LoadoutUseResult> {
    const world = bridge.getWorldDescriptor();
    const source = this.placementSystem?.getRuntimeRock(sourceRuntimeId);
    if (!world || !source) return { ok: false, reason: 'blocked' };
    return bridge.sendPersistentBaseMove({
      worldRevision: world.worldRevision,
      sourceRuntimeId,
      sourceGridX: source.gridX,
      sourceGridY: source.gridY,
      targetGridX: preview.gridX,
      targetGridY: preview.gridY,
    });
  }

  /**
   * Host-Einstiegspunkt fuer das Verschieben persistenter Basisobjekte.
   *
   * Der Host validiert vollstaendig neu, bevor er mutiert; konkurrierende Anfragen entscheidet
   * damit die erste vom Host akzeptierte Mutation. Ein Fehlschlag laesst die Quelle in jedem
   * Fall unveraendert - es entsteht kein teilweise verschobener Zustand.
   */
  movePersistentBaseObject(playerId: string, request: PersistentBaseMoveRequest): LoadoutUseResult {
    if (!bridge.isHost()) return { ok: false, reason: 'invalid' };
    const sanitized = sanitizePersistentBaseMoveRequest(request);
    if (!sanitized) return { ok: false, reason: 'invalid' };
    if (!this.acceptsPersistentBaseMutation(sanitized.worldRevision, sanitized.activityRevision)) {
      return { ok: false, reason: 'blocked' };
    }
    const world = bridge.getWorldDescriptor();
    const placementSystem = this.placementSystem;
    if (!world || !placementSystem || sanitized.worldRevision !== world.worldRevision) {
      return { ok: false, reason: 'blocked' };
    }
    const player = this.ctx.playerManager.getPlayer(playerId);
    if (!player || !player.active
      || !this.mayManagePersistentBase(playerId)
      || !this.world.getPlayerCapabilities(playerId).canDismantle
      || !this.ctx.combatSystem.isAlive(playerId)
      || this.ctx.combatSystem.isBurrowed(playerId)) {
      return { ok: false, reason: 'blocked' };
    }
    const now = Date.now();
    if (this.playerSystems?.loadout?.isManagementActionOnCooldown(playerId, 'reposition', now)) {
      return { ok: false, reason: 'cooldown' };
    }

    const source = placementSystem.getRuntimeRock(sanitized.sourceRuntimeId);
    // Die Quelle muss beim Commit noch dasselbe Objekt an derselben Zelle sein; sonst wurde sie
    // zwischen Vorschau und Bestaetigung zerstoert, zurueckgebaut oder ersetzt.
    if (!source
      || source.gridX !== sanitized.sourceGridX
      || source.gridY !== sanitized.sourceGridY
      || !this.isMovablePersistentBaseSource(playerId, source)) {
      return { ok: false, reason: 'blocked' };
    }

    // Zielpruefung ueber genau dieselbe Vorschau, die auch der Client sieht: Der Host baut damit
    // keine zweite, vereinfachte Placement-Regel nach.
    const targetWorld = placementSystem.getWorldPointForCell(sanitized.targetGridX, sanitized.targetGridY);
    const preview = this.getPersistentBaseMoveTargetPreview(
      playerId,
      source.id,
      targetWorld.x,
      targetWorld.y,
    );
    if (!preview
      || !preview.isValid
      || preview.gridX !== sanitized.targetGridX
      || preview.gridY !== sanitized.targetGridY) {
      return { ok: false, reason: 'placement' };
    }

    const result = source.persistentRewardId === undefined
      ? this.hostMovePersonalConstruction(playerId, source, preview)
      : this.hostMovePersistentBaseReward(source, preview);
    if (result.ok) this.markManagementActionUsed(playerId, 'reposition', now);
    return result;
  }

  /** Thin PB adapter; construction relocation is owned by the World runtime. */
  hostMovePersonalConstruction(
    playerId: string,
    source: SyncedPlaceableRock,
    preview: UtilityPlacementPreviewState,
  ): LoadoutUseResult {
    return this.world.getConstructionRuntime()?.movePersonalConstruction(playerId, source, preview)
      ?? { ok: false, reason: 'blocked' };
  }

  /** Base-owned Reward: Store-Placement, Runtime, Podest und Composite wandern in einem Schritt. */
  hostMovePersistentBaseReward(
    source: SyncedPlaceableRock,
    preview: UtilityPlacementPreviewState,
  ): LoadoutUseResult {
    const placementSystem = this.placementSystem;
    const site = this.worldContext?.persistentBaseSite ?? null;
    const store = this.session.rewards;
    const rewardId = source.persistentRewardId;
    if (!placementSystem || !site || !store || rewardId === undefined) return { ok: false, reason: 'blocked' };
    const previousPlacement = store.getState().placements.find((entry) => entry.rewardId === rewardId);
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, preview.gridX, preview.gridY);
    if (!previousPlacement || !relative) return { ok: false, reason: 'placement' };

    // Ein Reward hat hoehere Composite-Prioritaet als persoenliche Beitraege. Verdraengt wird nur
    // das Runtime-Objekt; der Blueprint seines Besitzers bleibt gespeichert.
    const occupant = placementSystem.getRuntimeRockAt(preview.gridX, preview.gridY);
    let displacedPersonalRuntime = false;
    if (occupant && occupant.id !== source.id && occupant.ownership !== 'base-owned') {
      const isPersistentContribution = this.session.contributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true;
      if (!isPersistentContribution) return { ok: false, reason: 'placement' };
      this.world.getWorldBinding()?.releasePersonalRuntimeForRewardConflict(occupant.id);
      displacedPersonalRuntime = true;
    }

    const previous: SyncedPlaceableRock = { ...source };
    if (!store.moveReward({
      rewardId,
      relativeGridX: relative.relativeGridX,
      relativeGridY: relative.relativeGridY,
      angle: preview.angle,
    })) {
      if (displacedPersonalRuntime) this.reconcilePersistentBaseWorld();
      return { ok: false, reason: 'blocked' };
    }
    const relocated = placementSystem.relocateRock(source.id, preview.gridX, preview.gridY, preview.angle);
    if (!relocated) {
      store.moveReward(previousPlacement);
      this.reconcilePersistentBaseWorld();
      return { ok: false, reason: 'placement' };
    }

    this.world.getWorldBinding()?.relocateRewardRuntime(rewardId, relocated);
    this.relocatePlaceableRuntimePresentation(previous, relocated);
    this.persistCurrentCommittedPersistentBaseRewards();
    this.publishPersistentBaseRewardSessionState();
    // Ein einziger Composite-Lauf gegen den neuen Zustand: Die Quellzelle wird wieder frei, die
    // Zielzelle bleibt reserviert.
    this.reconcilePersistentBaseWorld();
    return { ok: true };
  }

  /** Gueltige Move-Quelle: eigenes Konstrukt oder base-owned Persistent-Base-Reward. */
  isMovablePersistentBaseSource(
    playerId: string,
    source: SyncedPlaceableRock | undefined,
  ): boolean {
    if (!source) return false;
    if (source.ownership === 'base-owned') {
      return source.persistentRewardId !== undefined
        && isKnownPersistentBaseRewardId(source.persistentRewardId);
    }
    return this.world.getConstructionRuntime()?.isMovableConstructionSource(playerId, source) ?? false;
  }

  /** True, wenn diese absolute Rasterzelle im aktiven Baubereich der persistenten Basis liegt. */
  isPersistentBaseBuildAreaCell(
    site: WorldPersistentBaseSite | null,
    gridX: number,
    gridY: number,
  ): boolean {
    return site !== null && isCellInsidePersistentBaseBuildArea(
      gridX - site.anchor.gridX,
      gridY - site.anchor.gridY,
      site.buildArea,
    );
  }

  /** Zielvorschau eines bereits platzierten Rewards; seine eigene Zelle ist kein Zielkonflikt. */
  buildPersistentBaseRewardMovePreview(
    site: WorldPersistentBaseSite,
    rewardId: PersistentBaseRewardId,
    source: SyncedPlaceableRock,
    player: { readonly x: number; readonly y: number },
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const placementSystem = this.placementSystem;
    if (!placementSystem) return undefined;
    const definition = getPersistentBaseRewardDefinition(rewardId);
    const targetCell = placementSystem.getClampedTargetCell(
      player.x,
      player.y,
      pointerX,
      pointerY,
      COOP_DEFENSE_DISMANTLE_RANGE,
    );
    if (!targetCell) return undefined;
    const relative = this.resolvePersistentBaseRewardRelativeCell(site, targetCell.gridX, targetCell.gridY);
    const angle = Math.atan2(targetCell.y - player.y, targetCell.x - player.x);
    const placement: PersistentBaseRewardPlacement | null = relative
      ? {
          rewardId,
          relativeGridX: relative.relativeGridX,
          relativeGridY: relative.relativeGridY,
          angle,
        }
      : null;
    const session = bridge.getPersistentBaseRewardSessionState();
    const placements = (bridge.isHost() ? this.session.rewards?.getState().placements : undefined)
      ?? session?.placements
      ?? [];
    const duplicateCell = placement !== null && placements.some((candidate) => {
      if (candidate.rewardId === rewardId) return false;
      const occupied = this.resolvePersistentBaseRewardCell(site, candidate);
      return occupied?.gridX === targetCell.gridX && occupied.gridY === targetCell.gridY;
    });
    const occupant = placementSystem.getRuntimeRockAt(targetCell.gridX, targetCell.gridY);
    const persistentContribution = occupant
      ? this.session.contributions?.getRuntimeBindings()
        .some((binding) => binding.runtimeId === occupant.id) === true
      : false;
    const conflictAllowed = !occupant
      || occupant.id === source.id
      || occupant.ownership === 'base-owned'
      || persistentContribution;
    const isValid = placement !== null
      && this.isPersistentBaseRewardPlacementInDomain(definition, site, placement)
      && !duplicateCell
      && conflictAllowed
      && (definition.category !== 'baseTurret' || this.isPersistentBaseRuntimeActive(site))
      && placementSystem.canMaterializePersistentBaseRewardCell(
        targetCell.gridX,
        targetCell.gridY,
        true,
        source.id,
      );
    return {
      angle,
      targetX: targetCell.x,
      targetY: targetCell.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: 0,
      range: COOP_DEFENSE_DISMANTLE_RANGE,
      kind: definition.category === 'baseTurret' ? 'turret' : 'pedestal',
      sourceSlot: 'utility',
      constructionId: definition.gameplaySource.kind === 'construction-definition'
        ? definition.gameplaySource.constructionId
        : undefined,
      powerUpDefId: definition.gameplaySource.kind === 'power-up-definition'
        ? definition.gameplaySource.powerUpDefId
        : undefined,
      mode: 'move-target',
      sourceRuntimeId: source.id,
    };
  }

  /**
   * Setzt die Darstellung eines verschobenen Runtime-Objekts auf seine neue Zelle um.
   *
   * Nur Darstellung: Runtime-ID, HP, Besitz und alle registrierten Systemreferenzen bleiben
   * bestehen. `releasePlaceableRuntime` waere hier ausdruecklich falsch - es wuerde Podeste und
   * Zielverfolgung abmelden, die dieser Move gerade erhalten soll.
   */
  relocatePlaceableRuntimePresentation(
    previous: SyncedPlaceableRock,
    next: SyncedPlaceableRock,
  ): void {
    this.rockVisualHelper.removePlaceableRockVisual(previous, false);
    this.rockVisualHelper.materializePlaceableRock(next, false);
    // Zwei Zellen haben sich geaendert; die unvollstaendige Payload erzwingt bewusst genau einen
    // Flowfield-/Fire-Resync fuer beide.
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeables_batch_removed',
      source: next.kind === 'rock'
        ? 'placeable_rock'
        : next.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
    });
  }

  /** Startet den kurzen Doppelinput-Schutz einer Management-Aktion und repliziert ihn. */
  markManagementActionUsed(playerId: string, action: 'reposition' | 'dismantle', now: number): void {
    this.playerSystems?.loadout?.markManagementActionUsed(
      playerId,
      action,
      now,
      COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
    );
    // Ueber denselben keyed Kanal wie Utility- und Bau-Cooldowns, damit das Radial denselben
    // echten Zustand darstellt.
    bridge.publishUtilityCooldownUntil(
      playerId,
      now + COOP_DEFENSE_MANAGEMENT_COOLDOWN_MS,
      `management:${action}`,
    );
  }


  removeGuestSessionOwner(playerId: string): void {
    if (!bridge.isHost() || playerId === bridge.getLocalPlayerId()) return;
    const runtimeIds = this.session.removePlayerOwner(playerId);
    let removedCount = 0;
    for (const runtimeId of runtimeIds) {
      const removed = this.placementSystem?.removeRock(runtimeId);
      if (!removed) continue;
      this.world.getConstructionRuntime()?.finalizeDismantledConstruction(removed, false);
      removedCount += 1;
    }
    // Guest constructions outside a persistent base are still World-owned runtime objects and
    // must not survive the owner's final leave/spectator transition.
    for (const construction of this.placementSystem?.getOwnedConstructions(playerId) ?? []) {
      // Older snapshots may not carry the explicit ownership field yet. The owner identity still
      // makes this a guest-owned runtime; only authored base-owned objects stay reserved.
      if (construction.ownership === 'base-owned') continue;
      const removed = this.placementSystem?.removeRock(construction.id);
      if (!removed) continue;
      this.world.getConstructionRuntime()?.finalizeDismantledConstruction(removed, false);
      removedCount += 1;
    }
    if (removedCount > 0) {
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeables_batch_removed',
        source: 'placeable_rock',
      });
    }
    // Mit dem Verdraenger faellt der Grund: Ein zuvor unterdrueckter Blueprint eines anderen
    // Besitzers darf jetzt wieder erscheinen.
    this.reconcilePersistentBaseWorld();
  }

  /** Verwirft einen offenen Missions-Working-State vor einem technischen World-Teardown. */
  /**
   * Schliesst den Arbeitsstand einer beendeten Runde ab: Was die Runde ueberlebt hat, wird
   * committed, alles andere faellt zurueck.
   *
   * Genau ein terminaler Abschluss pro Transaction; eine stale Identity trifft ihn nicht mehr.
   * Der Flow entscheidet nur, *wann* eine Runde endet - was daraus fuer den Bestand folgt, gehoert
   * diesem Owner.
   */
  applyRoundOutcome(
    outcome: Parameters<typeof applyPersistentBaseRoundOutcome>[0],
    identity?: PersistentBaseTransactionIdentity,
  ): void {
    this.publishConfirmedPersistentBaseContributions(
      applyPersistentBaseRoundOutcome(outcome, {
        session: this.session,
        isRuntimeObjectAlive: (runtimeId) => this.placementSystem?.hasRuntimeRock(runtimeId) === true,
        identity,
      }),
    );
    this.persistCurrentCommittedPersistentBaseRewards();
    this.publishPersistentBaseRewardSessionState();
  }

  /** Uebersetzt einen Rundenausgang in seinen Bestandsabschluss. */
  applyRoundConclusion(
    roundConclusion: Parameters<typeof resolvePersistentBaseRoundOutcome>[0],
    identity?: PersistentBaseTransactionIdentity,
  ): void {
    this.applyRoundOutcome(resolvePersistentBaseRoundOutcome(roundConclusion), identity);
  }

  rollbackPersistentBaseMissionIfActive(): void {
    if (!bridge.isHost()) return;
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome(null), {
      session: this.session,
      isRuntimeObjectAlive: (runtimeId) => this.placementSystem?.hasRuntimeRock(runtimeId) === true,
    });
    this.publishPersistentBaseRewardSessionState();
  }

  /**
   * Uebernimmt die aktuell angebotenen Beitraege aller verbundenen Spieler.
   *
   * Ein Angebot ist nur ein Angebot: Der Host sanitisiert es an der Netzwerkgrenze und
   * entscheidet erst beim Merge, was davon in der Welt steht. Eine bereits uebernommene Revision
   * wird nicht erneut eingelesen, damit ein wiederholt gesendeter Zustand nichts anstoesst.
   */
  ingestOfferedPersistentBaseContributions(): void {
    if (!bridge.isHost()) return;
    // Die Profilidentitaet des Hosts ist der erste Claim. Dadurch ist sie fuer Gastangebote
    // reserviert, ohne dass der Coordinator selbst eine zweite Binding-Map fuehrt.
    this.session.bindPlayerOwner(
      bridge.getLocalPlayerId(),
      getStoredLocalOwnerId(),
    );
    let ingestedSomething = false;
    for (const playerId of bridge.getConnectedPlayerIds()) {
      const offered = playerId === bridge.getLocalPlayerId()
        ? getStoredPersonalBaseContribution()
        : bridge.getPlayerPersistentBaseContribution(playerId);
      if (!offered) continue;
      // Claim, Contribution und Annahme-Revision gehoeren gemeinsam in die RoomSession.
      ingestedSomething = this.session.acceptContributionOffer(playerId, offered)
        || ingestedSomething;
    }
    // Ein waehrend der Mission eingetroffener Beitrag traegt sofort bei, statt bis zur naechsten
    // World zu warten.
    if (ingestedSomething && this.session.hasOpenTransaction) {
      this.reconcilePersistentBaseWorld();
    }
  }

  /** Die dauerhafte Besitzeridentitaet hinter einer Raum-Spieler-ID; leer, wenn keine bekannt ist. */
  resolveOwnerId(playerId: string): string {
    this.ensureLocalPersistentBaseOwnerBinding(playerId);
    return this.session.getOwnerIdForPlayer(playerId) ?? '';
  }

  /** Der lokale Profil-Owner ist der erste Raum-Claim, auch wenn noch kein Angebot vorliegt. */
  ensureLocalPersistentBaseOwnerBinding(playerId: string): void {
    if (playerId !== bridge.getLocalPlayerId()) return;
    this.session.bindPlayerOwner(playerId, getStoredLocalOwnerId());
  }

  /**
   * Die Raum-Spieler-ID hinter einer Besitzeridentitaet; sie bestimmt Farbe und Berechtigungen.
   *
   * Nur der lokale Spieler leitet seine Identitaet aus dem eigenen Profil ab; jede andere kommt
   * aus einem bereits angenommenen Angebot. Beides bleibt getrennt, damit eine Spieler-ID nie
   * aus einer Besitzeridentitaet erraten wird.
   */
  resolvePlayerIdForOwner(ownerId: string): string | null {
    this.ensureLocalPersistentBaseOwnerBinding(bridge.getLocalPlayerId());
    return this.session.getPlayerIdForOwner(ownerId);
  }

  /**
   * Baut die sichtbare Basis aus allen persoenlichen Beitraegen auf.
   *
   * Der Merge selbst ist rein und deterministisch; hier wird nur materialisiert, was er
   * freigegeben hat. Ein Konflikt bleibt genau das - er entfernt nichts aus dem Besitz seines
   * Besitzers und erscheint im naechsten Raum moeglicherweise wieder.
   */
  /**
   * Rechnet das Composite nach einem Beitritt neu und materialisiert, was neu dazugekommen ist.
   *
   * Der Merge ist deterministisch und liefert fuer bereits stehende Konstruktionen dasselbe
   * Ergebnis wie zuvor; materialisiert wird deshalb nur, was noch kein Runtime-Objekt hat. So
   * bleibt eine laufende Mission unberuehrt, waehrend der neue Spieler trotzdem sofort beitraegt.
   */
  reconcilePersistentBaseWorld(): void {
    this.world.getWorldBinding()?.reconcile();
  }

  publishPersistentBaseRewardSessionState(): void {
    if (!bridge.isHost()) return;
    const world = bridge.getWorldDescriptor();
    const store = this.session.rewards;
    if (!world || !store || !this.worldContext?.persistentBaseSite) {
      bridge.publishPersistentBaseRewardSessionState(null);
      return;
    }
    const state = store.getState();
    const availableRewardIds = getStoredPersistentBaseRewardUnlocks();
    const signature = JSON.stringify({
      worldRevision: world.worldRevision,
      availableRewardIds,
      placements: state.placements,
    });
    if (signature === this.projectionSignature) return;
    this.projectionSignature = signature;
    this.projectionRevision = Math.max(
      state.revision,
      this.projectionRevision + 1,
    );
    const session: PersistentBaseRewardSessionState = {
      worldRevision: world.worldRevision,
      revision: this.projectionRevision,
      availableRewardIds,
      placements: state.placements,
    };
    bridge.publishPersistentBaseRewardSessionState(session);
  }

  persistCurrentCommittedPersistentBaseRewards(): void {
    if (!bridge.isHost()) return;
    const store = this.session.rewards;
    if (!store || store.hasActiveMission) return;
    setStoredPersistentBaseRewardState(store.getState());
  }

  resolvePersistentBaseRewardCell(
    site: WorldPersistentBaseSite,
    placement: Pick<PersistentBaseRewardPlacement, 'relativeGridX' | 'relativeGridY'>,
  ): { gridX: number; gridY: number; domain: 'base-surface' | 'courtyard-build-area' | 'entrance' } | null {
    return resolvePersistentBaseCell(
      site.anchor,
      placement.relativeGridX,
      placement.relativeGridY,
      site.orientation,
      site.buildArea,
    );
  }

  resolvePersistentBaseRewardRelativeCell(
    site: WorldPersistentBaseSite,
    gridX: number,
    gridY: number,
  ): { relativeGridX: number; relativeGridY: number; domain: 'base-surface' | 'courtyard-build-area' | 'entrance' } | null {
    const extent = Math.max(2, getPersistentBaseBuildAreaExtentCells(site.buildArea));
    for (let relativeGridY = -extent; relativeGridY <= extent; relativeGridY += 1) {
      for (let relativeGridX = -extent; relativeGridX <= extent; relativeGridX += 1) {
        const cell = resolvePersistentBaseCell(
          site.anchor,
          relativeGridX,
          relativeGridY,
          site.orientation,
          site.buildArea,
        );
        if (cell?.gridX === gridX && cell.gridY === gridY) {
          return { relativeGridX, relativeGridY, domain: cell.domain };
        }
      }
    }
    return null;
  }

  isPersistentBaseRewardPlacementInDomain(
    definition: PersistentBaseRewardDefinition,
    site: WorldPersistentBaseSite,
    placement: PersistentBaseRewardPlacement,
  ): boolean {
    const cell = this.resolvePersistentBaseRewardCell(site, placement);
    if (!cell) return false;
    if (definition.placementRule === 'base-surface') return cell.domain === 'base-surface';
    return isCellInsidePersistentBaseBuildArea(
      placement.relativeGridX,
      placement.relativeGridY,
      site.buildArea,
    );
  }

  /** Stellt jedem Besitzer seinen host-bestaetigten Beitrag zu und speichert den eigenen lokal. */
  publishConfirmedPersistentBaseContributions(
    confirmed: readonly PersistentPlayerBaseContribution[],
  ): void {
    if (!bridge.isHost()) return;
    const localOwnerId = getStoredLocalOwnerId();
    for (const contribution of confirmed) {
      if (contribution.ownerId === localOwnerId) {
        setStoredPersonalBaseContribution(contribution);
        continue;
      }
      const playerId = this.resolvePlayerIdForOwner(contribution.ownerId);
      // Ein bereits getrennter Gast bekommt nichts nachgeliefert: Sein voriger Stand bleibt auf
      // seinem Geraet gueltig, und ein nachtraeglicher Zustellmechanismus gehoert nicht hierher.
      if (playerId) bridge.hostConfirmPersistentBaseContribution(playerId, contribution);
    }
  }

  emitPersistentRestoreAdded(runtime: SyncedPlaceableRock): void {
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'placeable_added',
      source: runtime.kind === 'pedestal'
        ? 'placeable_pedestal'
        : runtime.kind === 'turret' ? 'placeable_turret' : 'placeable_rock',
      obstacleId: runtime.id,
      gridX: runtime.gridX,
      gridY: runtime.gridY,
      collisionMode: runtime.collisionMode,
    });
  }

  /** Bestaetigt genau die bereits host-validierte Lobby-Aenderung ihres Besitzers. */
  publishImmediatePersistentBaseContribution(ownerId: string): void {
    const confirmed = this.session.contributions.getCommittedContribution(ownerId);
    if (confirmed) this.publishConfirmedPersistentBaseContributions([confirmed]);
  }
}
