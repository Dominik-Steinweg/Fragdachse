/**
 * Shared mutable flags for the local player's in-round state.
 *
 * Written by HostUpdateCoordinator and ClientUpdateCoordinator each frame,
 * read by ArenaScene.update() to gate AimSystem / fog overlay rendering.
 */
export class LocalPlayerState {
  alive    = false;
  burrowed = false;
  /** Tracks the alive-state the fog overlay was last rendered for (null = not yet tracked). */
  overlayTrackedAlive: boolean | null = null;
}
