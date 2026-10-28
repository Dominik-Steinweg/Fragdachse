import type { PersistentBaseEditorScene, PersistentBaseEditorStageOptions } from '../PersistentBaseEditorScene';
import type { PersistentBaseEditorTerrain } from '../../persistentBase/PersistentBaseEditorWorld';

/** What a stage shows and how: the next round's terrain, the host's frozen area stage and the graphics quality. */
export function baseEditorStageKey(terrain: Pick<PersistentBaseEditorTerrain, 'mapId' | 'seed' | 'fingerprint' | 'areaStage'>,
  quality: string): string {
  return [terrain.mapId, terrain.seed, terrain.fingerprint, terrain.areaStage, quality].join('|');
}

/** Quiet time after the next round's terrain changed before its stage is built: the host may still be choosing. */
export const BASE_EDITOR_PREPARE_SETTLE_MS = 3000;

/** What the lobby frame tells the preparation. */
export interface BaseEditorPreparationFrame {
  readonly now: number;
  /** The Bauhof can open here: lobby, co-op, base unlocked. */
  readonly eligible: boolean;
  /** Stage key of the next round's terrain; `undefined` while it is generated, `null` without one. */
  readonly key: string | null | undefined;
  /** A session or an opening owns the stage; the preparation keeps out of its way. */
  readonly busy: boolean;
  /** The player is near the Bauhof: no quiet time. */
  readonly near: boolean;
  readonly options: () => PersistentBaseEditorStageOptions;
}

/** Adds a stage scene to the scene manager and removes it again. */
export interface BaseEditorStageHost {
  add(options: PersistentBaseEditorStageOptions): PersistentBaseEditorScene;
  remove(stage: PersistentBaseEditorScene): void;
}

/**
 * Owns the Bauhof's stage between its sessions. A stage shows one terrain; it is kept while that
 * terrain stays the next round's and released before a round's World is built. A stage without
 * terrain (the personal draft alone) lives for one session.
 */
export class ArenaBaseEditorPreparation {
  private current: { readonly stage: PersistentBaseEditorScene; readonly key: string | null } | null = null;
  /** The next round's terrain as last seen, and since when; `null` after leaving the lobby. */
  private seen: { readonly key: string; readonly since: number } | null = null;

  constructor(private readonly host: BaseEditorStageHost) {}

  /**
   * Builds the stage for the next round's terrain ahead, hidden and on a small budget, and drops
   * one whose terrain went stale. The first terrain after entering the lobby starts at once; a
   * changed one waits for quiet unless the player is near the Bauhof.
   */
  tick(frame: BaseEditorPreparationFrame): void {
    if (frame.busy) return;
    if (!frame.eligible || frame.key === null) {
      this.release();
      if (!frame.eligible) this.seen = null;
      return;
    }
    if (frame.key === undefined || this.current?.key === frame.key) return;
    this.release();
    if (this.seen?.key !== frame.key) this.seen = { key: frame.key, since: this.seen ? frame.now : -Infinity };
    if (frame.near || frame.now - this.seen.since >= BASE_EDITOR_PREPARE_SETTLE_MS) this.acquire(frame.key, frame.options, false);
  }

  /** A stage for the next round's terrain is being built ahead (for the lobby's hint). */
  isPreparing(): boolean {
    return this.current !== null && this.current.key !== null && !this.current.stage.isReady();
  }

  /** The kept stage for this key when it can open a session at once. */
  readyStage(key: string | null): PersistentBaseEditorScene | null {
    const current = this.current;
    return current && current.key === key && current.stage.isReady() ? current.stage : null;
  }

  /** The stage for this key: the kept one, or a new one in its place. `urgent`: a player waits for it. */
  acquire(key: string | null, options: () => PersistentBaseEditorStageOptions, urgent: boolean): PersistentBaseEditorScene {
    if (!this.current || this.current.key !== key || key === null) {
      this.release();
      this.current = { stage: this.host.add(options()), key };
    }
    this.current.stage.setUrgent(urgent);
    return this.current.stage;
  }

  /** After a session: a stage with terrain stays hidden for the next one, the personal draft's goes. */
  endSession(stage: PersistentBaseEditorScene): void {
    if (this.current?.stage !== stage || this.current.key === null) {
      if (this.current?.stage === stage) this.current = null;
      this.host.remove(stage);
      return;
    }
    stage.closeSession();
    stage.setUrgent(false);
  }

  /** Drops the kept stage: its terrain is no longer the next round's, a round starts, or the scene ends. */
  release(): void {
    if (!this.current) return;
    const current = this.current;
    this.current = null;
    if (current) this.host.remove(current.stage);
  }
}
