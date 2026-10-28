import type { PersistentBaseEditorScene, PersistentBaseEditorStageOptions } from '../PersistentBaseEditorScene';
import type { PersistentBaseEditorTerrain } from '../../persistentBase/PersistentBaseEditorWorld';

/** What a stage shows and how: the next round's terrain, the host's frozen area stage and the graphics quality. */
export function baseEditorStageKey(terrain: PersistentBaseEditorTerrain, quality: string): string {
  return [terrain.mapId, terrain.seed, terrain.fingerprint, terrain.areaStage, quality].join('|');
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

  constructor(private readonly host: BaseEditorStageHost) {}

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
    const current = this.current;
    this.current = null;
    if (current) this.host.remove(current.stage);
  }
}
