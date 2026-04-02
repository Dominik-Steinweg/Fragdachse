import { bridge }            from '../../network/bridge';
import type { ArenaContext }        from './ArenaContext';
import type { RendererBundle }      from './RendererBundle';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';
import type { LeftSidePanel }       from '../../ui/LeftSidePanel';

/**
 * Registers all bridge RPC handlers in one place.
 *
 * Handlers that need the lifecycle coordinator (e.g., train-destroyed) receive it
 * via setLifecycle() after construction to avoid circular dependencies between
 * RpcCoordinator and ArenaLifecycleCoordinator.
 */
export class RpcCoordinator {
  private lifecycle: ArenaLifecycleCoordinator | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly leftPanel: LeftSidePanel,
  ) {}

  setLifecycle(lifecycle: ArenaLifecycleCoordinator): void {
    this.lifecycle = lifecycle;
  }

  registerAll(): void {
    this.registerDashHandler();
    this.registerBurrowRpcHandler();
    this.registerDecoyStealthBreakHandler();
    this.registerLoadoutUseHandler();
    this.registerCaptureTheBeerFxHandler();
    this.registerExplosionEffectHandler();
    this.registerGrenadeCountdownHandler();
    this.registerBfgLaserBatchHandler();
    this.registerBurrowVisualHandler();
    this.registerShockwaveEffectHandler();
    this.registerShotFxHandler();
    this.registerTranslocatorFlashHandler();
    this.registerColorHandlers();
    this.registerKillEventHandler();
    this.registerTrainDestroyedHandler();
    this.registerPickupPowerUpHandler();
  }

  private registerDashHandler(): void {
    bridge.registerDashHandler((playerId, dx, dy) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (bridge.isArenaCountdownActive()) return;
      this.ctx.hostPhysics.handleDashRPC(playerId, dx, dy);
    });
  }

  private registerBurrowRpcHandler(): void {
    bridge.registerBurrowHandler((playerId, wantsBurrowed) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      if (bridge.isArenaCountdownActive()) return;
      this.ctx.burrowSystem?.handleBurrowRequest(playerId, wantsBurrowed);
    });
  }

  private registerDecoyStealthBreakHandler(): void {
    bridge.registerDecoyStealthBreakHandler((playerId) => {
      if (!bridge.isHost()) return;
      if (bridge.getGamePhase() !== 'ARENA') return;
      this.ctx.decoySystem.breakStealth(playerId, Date.now());
    });
  }

  private registerLoadoutUseHandler(): void {
    bridge.registerLoadoutUseHandler((slot, angle, targetX, targetY, senderId, shotId, params, clientX, clientY, clientNow) => {
      if (!bridge.isHost()) return { ok: false, reason: 'blocked' };
      if (bridge.isArenaCountdownActive()) return { ok: false, reason: 'blocked' };
      return this.ctx.loadoutManager?.use(slot, senderId, angle, targetX, targetY, clientNow ?? Date.now(), shotId, params, clientX, clientY)
        ?? { ok: false, reason: 'blocked' };
    });
  }

  private registerCaptureTheBeerFxHandler(): void {
    bridge.registerCaptureTheBeerFxHandler((event) => {
      this.renderers.beer.playFx(event);
    });
  }

  private registerExplosionEffectHandler(): void {
    bridge.registerExplosionEffectHandler((x, y, radius, color, visualStyle) => {
      this.ctx.effectSystem.playExplosionEffect(x, y, radius, color, visualStyle);
    });
  }

  private registerGrenadeCountdownHandler(): void {
    bridge.registerGrenadeCountdownHandler((x, y, value) => {
      this.ctx.effectSystem.playCountdownText(x, y, value);
    });
  }

  private registerBfgLaserBatchHandler(): void {
    bridge.registerBfgLaserBatchHandler((lines, color) => {
      for (const line of lines) {
        this.ctx.effectSystem.playHitscanTracer(line.sx, line.sy, line.ex, line.ey, color, 2);
      }
    });
  }

  private registerBurrowVisualHandler(): void {
    bridge.registerBurrowVisualHandler((playerId, phase) => {
      const entity = this.ctx.playerManager.getPlayer(playerId);
      if (!entity) return;
      if (phase === 'windup' || phase === 'recovery') {
        this.ctx.effectSystem.playBurrowPhaseEffect(entity.sprite.x, entity.sprite.y, phase);
      }
      entity.setBurrowPhase(phase, true);
      this.ctx.effectSystem.syncBurrowState(playerId, phase, entity.sprite);
      // Keep client coordinator in sync so applyBurrowVisual() doesn't re-trigger
      this.clientUpdate.setBurrowPhase(playerId, phase);
    });
  }

  private registerShockwaveEffectHandler(): void {
    bridge.registerShockwaveEffectHandler((x, y) => {
      this.ctx.effectSystem.playShockwaveEffect(x, y);
    });
  }

  private registerShotFxHandler(): void {
    bridge.registerShotFxHandler((shooterId, duration, intensity) => {
      if (shooterId === bridge.getLocalPlayerId()) {
        this.scene.cameras.main.shake(duration, intensity);
      }
    });
  }

  private registerTranslocatorFlashHandler(): void {
    bridge.registerTranslocatorFlashHandler((x, y, color, type) => {
      this.renderers.translocatorTeleport?.playFlash(x, y, color, type);
    });
  }

  private registerColorHandlers(): void {
    bridge.registerColorRequestHandler((color, id) => {
      bridge.hostHandleColorRequest(color, id);
    });
    bridge.registerColorAcceptedHandler((id, _color) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorAccepted();
      }
      this.leftPanel.refreshColorPickerIfOpen();
    });
    bridge.registerColorDeniedHandler((id) => {
      if (id === bridge.getLocalPlayerId()) {
        this.leftPanel.onColorDenied();
      }
    });
    bridge.registerColorChangeHandler((_id, _color) => {
      this.leftPanel.refreshColorPickerIfOpen();
    });
  }

  private registerKillEventHandler(): void {
    bridge.registerKillEventHandler(event => {
      this.ctx.rightPanel.addKillFeedEntry(
        event.killerName, event.killerColor,
        event.weapon,
        event.victimName, event.victimColor,
      );
    });
  }

  private registerTrainDestroyedHandler(): void {
    bridge.registerTrainDestroyedHandler(() => {
      this.lifecycle?.onTrainDestroyed();
      this.ctx.rightPanel.showTrainDestroyed();
    });
  }

  private registerPickupPowerUpHandler(): void {
    bridge.registerPickupPowerUpHandler((uid, playerId) => {
      const player = this.ctx.playerManager.getPlayer(playerId);
      if (!player) return;
      this.ctx.powerUpSystem?.tryPickup(playerId, uid, player.sprite.x, player.sprite.y);
    });
  }
}
