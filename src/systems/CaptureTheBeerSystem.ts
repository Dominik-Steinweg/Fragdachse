import * as Phaser from 'phaser';
import { bridge } from '../network/bridge';
import type { PlayerManager } from '../entities/PlayerManager';
import {
  getCaptureTheBeerBaseWorldBounds,
  getCaptureTheBeerHomeWorldPosition,
} from '../config';
import type { CaptureTheBeerFxEvent, SyncedCaptureTheBeerBeer, SyncedCaptureTheBeerState, TeamId } from '../types';

const BEER_SIZE = 16;
const BEER_HALF_SIZE = BEER_SIZE * 0.5;

type InteractionPredicate = (playerId: string) => boolean;
type CaptureTheBeerFxHandler = (event: CaptureTheBeerFxEvent) => void;

interface LocalBeerState extends SyncedCaptureTheBeerBeer {
  pickupBlockedByPlayerId: string | null;
}

interface LocalCaptureTheBeerState {
  scores: Record<TeamId, number>;
  beers: LocalBeerState[];
}

export class CaptureTheBeerSystem {
  private readonly scratchBeerBounds = new Phaser.Geom.Rectangle();
  private state: LocalCaptureTheBeerState;
  private interactionPredicate: InteractionPredicate | null = null;
  private fxHandler: CaptureTheBeerFxHandler | null = null;

  constructor(private readonly playerManager: PlayerManager) {
    this.state = this.createInitialState();
  }

  setInteractionPredicate(predicate: InteractionPredicate | null): void {
    this.interactionPredicate = predicate;
  }

  setFxHandler(handler: CaptureTheBeerFxHandler | null): void {
    this.fxHandler = handler;
  }

  reset(): void {
    this.state = this.createInitialState();
  }

  destroy(): void {
    this.interactionPredicate = null;
    this.fxHandler = null;
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

  dropBeerForPlayer(playerId: string, x?: number, y?: number): void {
    for (const beer of this.state.beers) {
      if (beer.holderId !== playerId) continue;
      const carrier = this.playerManager.getPlayer(playerId);
      beer.holderId = null;
      beer.state = 'dropped';
      beer.x = x ?? carrier?.sprite.x ?? beer.x;
      beer.y = y ?? carrier?.sprite.y ?? beer.y;
      beer.pickupBlockedByPlayerId = playerId;
      this.emitFx({
        kind: 'drop',
        beerTeamId: beer.teamId,
        x: beer.x,
        y: beer.y,
      });
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
    const home = getCaptureTheBeerHomeWorldPosition(teamId);
    const defaultX = home.x;
    const defaultY = home.y;
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
      const position = this.resolveCarrierPosition(carrier.sprite.x, carrier.sprite.y);
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
            this.returnBeerHome(beer, true);
          }
        } else {
          beer.holderId = player.id;
          beer.state = 'carried';
          beer.pickupBlockedByPlayerId = null;
          const position = this.resolveCarrierPosition(player.sprite.x, player.sprite.y);
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
      const scorerProfile = bridge.getConnectedPlayers().find((player) => player.id === beer.holderId);

      this.state.scores[carrierTeam] += 1;
      this.emitFx({
        kind: 'score',
        beerTeamId: beer.teamId,
        scoreTeamId: carrierTeam,
        scorerName: scorerProfile?.name ?? 'Unknown',
        scorerColor: scorerProfile?.colorHex ?? 0xe0e0e0,
        x: beer.x,
        y: beer.y,
      });
      this.returnBeerHome(beer, true);
    }
  }

  private returnBeerHome(beer: LocalBeerState, emitResetFx: boolean): void {
    const sourceX = beer.x;
    const sourceY = beer.y;
    beer.holderId = null;
    beer.state = 'home';
    beer.x = beer.defaultX;
    beer.y = beer.defaultY;
    beer.pickupBlockedByPlayerId = null;
    if (emitResetFx) {
      this.emitFx({
        kind: 'reset',
        beerTeamId: beer.teamId,
        sourceX,
        sourceY,
        targetX: beer.defaultX,
        targetY: beer.defaultY,
      });
    }
  }

  private resolveCarrierPosition(x: number, y: number): { x: number; y: number } {
    return { x, y };
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

  private emitFx(event: CaptureTheBeerFxEvent): void {
    this.fxHandler?.(event);
  }
}