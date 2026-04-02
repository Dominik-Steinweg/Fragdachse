import Phaser from 'phaser';
import { bridge } from '../network/bridge';
import type { PlayerManager } from '../entities/PlayerManager';
import {
  DEPTH,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
  getCaptureTheBeerBaseWorldBounds,
  getTopDownMuzzleOrigin,
} from '../config';
import type { SyncedCaptureTheBeerBeer, SyncedCaptureTheBeerState, TeamId } from '../types';

const BEER_SIZE = 16;
const BEER_HALF_SIZE = BEER_SIZE * 0.5;
const BEER_DEPTH = DEPTH.PLAYERS + 0.05;

type InteractionPredicate = (playerId: string) => boolean;

interface LocalBeerState extends SyncedCaptureTheBeerBeer {
  pickupBlockedByPlayerId: string | null;
}

interface LocalCaptureTheBeerState {
  scores: Record<TeamId, number>;
  beers: LocalBeerState[];
}

export class CaptureTheBeerSystem {
  private readonly bottleRects = new Map<TeamId, Phaser.GameObjects.Rectangle>();
  private readonly scratchBeerBounds = new Phaser.Geom.Rectangle();
  private state: LocalCaptureTheBeerState;
  private interactionPredicate: InteractionPredicate | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
  ) {
    this.state = this.createInitialState();
    this.bottleRects.set('blue', this.createBottleRect(TEAM_BLUE_COLOR));
    this.bottleRects.set('red', this.createBottleRect(TEAM_RED_COLOR));
    this.updateVisuals();
  }

  setInteractionPredicate(predicate: InteractionPredicate | null): void {
    this.interactionPredicate = predicate;
  }

  reset(): void {
    this.state = this.createInitialState();
    this.updateVisuals();
  }

  destroy(): void {
    for (const rect of this.bottleRects.values()) {
      rect.destroy();
    }
    this.bottleRects.clear();
  }

  syncSnapshot(snapshot: SyncedCaptureTheBeerState | null): void {
    if (!snapshot) {
      this.reset();
      return;
    }

    const snapshotMap = new Map<TeamId, SyncedCaptureTheBeerBeer>();
    for (const beer of snapshot.beers) snapshotMap.set(beer.teamId, beer);

    this.state = {
      scores: {
        blue: snapshot.scores.blue,
        red: snapshot.scores.red,
      },
      beers: (['blue', 'red'] as const).map((teamId) => {
        const fallback = this.createBeerState(teamId);
        const beer = snapshotMap.get(teamId) ?? fallback;
        return {
          ...fallback,
          ...beer,
          pickupBlockedByPlayerId: null,
        };
      }),
    };
  }

  hostUpdate(interactionsEnabled: boolean): SyncedCaptureTheBeerState {
    this.releasePickupBlocks();
    this.resolveMissingCarrierPlayers();
    this.syncCarrierPositions();

    if (interactionsEnabled) {
      this.resolveGroundInteractions();
      this.syncCarrierPositions();
      this.resolveCaptures();
      this.syncCarrierPositions();
    }

    return this.buildSnapshot();
  }

  updateVisuals(): void {
    for (const beer of this.state.beers) {
      const rect = this.bottleRects.get(beer.teamId);
      if (!rect) continue;
      const position = this.resolveVisualPosition(beer);
      rect.setVisible(true);
      rect.setPosition(position.x, position.y);
    }
  }

  dropBeerForPlayer(playerId: string, x?: number, y?: number): void {
    for (const beer of this.state.beers) {
      if (beer.holderId !== playerId) continue;
      const carrier = this.playerManager.getPlayer(playerId);
      beer.holderId = null;
      beer.state = 'dropped';
      beer.x = x ?? carrier?.sprite.x ?? beer.x;
      beer.y = y ?? carrier?.sprite.y ?? beer.y;
      beer.pickupBlockedByPlayerId = playerId;
    }
  }

  getTeamScore(teamId: TeamId): number {
    return this.state.scores[teamId] ?? 0;
  }

  private createInitialState(): LocalCaptureTheBeerState {
    return {
      scores: { blue: 0, red: 0 },
      beers: [this.createBeerState('blue'), this.createBeerState('red')],
    };
  }

  private createBeerState(teamId: TeamId): LocalBeerState {
    const bounds = getCaptureTheBeerBaseWorldBounds(teamId);
    const defaultX = bounds.x + bounds.width * 0.5;
    const defaultY = bounds.y + bounds.height * 0.5;
    return {
      teamId,
      defaultX,
      defaultY,
      x: defaultX,
      y: defaultY,
      holderId: null,
      state: 'home',
      pickupBlockedByPlayerId: null,
    };
  }

  private createBottleRect(color: number): Phaser.GameObjects.Rectangle {
    const rect = this.scene.add.rectangle(0, 0, BEER_SIZE, BEER_SIZE, color, 1);
    rect.setDepth(BEER_DEPTH);
    rect.setStrokeStyle(2, 0x000000, 1);
    return rect;
  }

  private buildSnapshot(): SyncedCaptureTheBeerState {
    return {
      scores: {
        blue: this.state.scores.blue,
        red: this.state.scores.red,
      },
      beers: this.state.beers.map((beer) => ({
        teamId: beer.teamId,
        defaultX: beer.defaultX,
        defaultY: beer.defaultY,
        x: beer.x,
        y: beer.y,
        holderId: beer.holderId,
        state: beer.state,
      })),
    };
  }

  private getBeer(teamId: TeamId): LocalBeerState {
    return this.state.beers.find((beer) => beer.teamId === teamId) ?? this.state.beers[0];
  }

  private canPlayerInteract(playerId: string): boolean {
    return this.interactionPredicate?.(playerId) ?? true;
  }

  private releasePickupBlocks(): void {
    for (const beer of this.state.beers) {
      if (!beer.pickupBlockedByPlayerId) continue;
      const player = this.playerManager.getPlayer(beer.pickupBlockedByPlayerId);
      if (!player || !this.isPlayerTouchingBeer(player.sprite.getBounds(), beer)) {
        beer.pickupBlockedByPlayerId = null;
      }
    }
  }

  private resolveMissingCarrierPlayers(): void {
    for (const beer of this.state.beers) {
      if (beer.state !== 'carried' || !beer.holderId) continue;
      const carrier = this.playerManager.getPlayer(beer.holderId);
      if (carrier && carrier.body.enable) continue;
      beer.holderId = null;
      beer.state = 'dropped';
      beer.pickupBlockedByPlayerId = null;
    }
  }

  private syncCarrierPositions(): void {
    for (const beer of this.state.beers) {
      if (beer.state !== 'carried' || !beer.holderId) continue;
      const carrier = this.playerManager.getPlayer(beer.holderId);
      if (!carrier) continue;
      const position = this.resolveCarrierPosition(carrier.sprite.x, carrier.sprite.y, carrier.sprite.rotation);
      beer.x = position.x;
      beer.y = position.y;
    }
  }

  private resolveGroundInteractions(): void {
    const players = this.playerManager.getAllPlayers();

    for (const beer of this.state.beers) {
      if (beer.state === 'carried') continue;

      for (const player of players) {
        if (!player.body.enable) continue;
        if (!this.canPlayerInteract(player.id)) continue;
        if (beer.pickupBlockedByPlayerId === player.id) continue;
        if (!this.isPlayerTouchingBeer(player.sprite.getBounds(), beer)) continue;

        const teamId = bridge.getPlayerTeam(player.id);
        if (!teamId) continue;

        if (teamId === beer.teamId) {
          if (beer.state === 'dropped') {
            this.returnBeerHome(beer);
          }
        } else {
          beer.holderId = player.id;
          beer.state = 'carried';
          beer.pickupBlockedByPlayerId = null;
          const position = this.resolveCarrierPosition(player.sprite.x, player.sprite.y, player.sprite.rotation);
          beer.x = position.x;
          beer.y = position.y;
        }
        break;
      }
    }
  }

  private resolveCaptures(): void {
    for (const beer of this.state.beers) {
      if (beer.state !== 'carried' || !beer.holderId) continue;

      const carrierTeam = bridge.getPlayerTeam(beer.holderId);
      if (!carrierTeam || carrierTeam === beer.teamId) continue;
      if (!this.isCarrierInsideBase(beer.holderId, carrierTeam)) continue;

      const ownBeer = this.getBeer(carrierTeam);
      if (ownBeer.state !== 'home') continue;

      this.state.scores[carrierTeam] += 1;
      this.returnBeerHome(beer);
    }
  }

  private returnBeerHome(beer: LocalBeerState): void {
    beer.holderId = null;
    beer.state = 'home';
    beer.x = beer.defaultX;
    beer.y = beer.defaultY;
    beer.pickupBlockedByPlayerId = null;
  }

  private resolveVisualPosition(beer: LocalBeerState): { x: number; y: number } {
    if (beer.state === 'carried' && beer.holderId) {
      const carrier = this.playerManager.getPlayer(beer.holderId);
      if (carrier && carrier.body.enable) {
        return this.resolveCarrierPosition(carrier.sprite.x, carrier.sprite.y, carrier.sprite.rotation);
      }
    }
    return { x: beer.x, y: beer.y };
  }

  private resolveCarrierPosition(x: number, y: number, rotation: number): { x: number; y: number } {
    return getTopDownMuzzleOrigin(x, y, rotation - Math.PI / 2);
  }

  private isPlayerTouchingBeer(playerBounds: Phaser.Geom.Rectangle, beer: LocalBeerState): boolean {
    this.scratchBeerBounds.setTo(
      beer.x - BEER_HALF_SIZE,
      beer.y - BEER_HALF_SIZE,
      BEER_SIZE,
      BEER_SIZE,
    );
    return Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, this.scratchBeerBounds);
  }

  private isCarrierInsideBase(playerId: string, teamId: TeamId): boolean {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || !player.body.enable) return false;

    const bounds = getCaptureTheBeerBaseWorldBounds(teamId);
    return player.sprite.x >= bounds.x
      && player.sprite.x <= bounds.x + bounds.width
      && player.sprite.y >= bounds.y
      && player.sprite.y <= bounds.y + bounds.height;
  }
}