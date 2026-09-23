import type { PlayerMovementPredictionState } from '../types';

interface Selection { sequence: number; speed: number; canPredict: boolean }
interface Pose { x: number; y: number; positionRevision: number }
interface Entry {
  revision: number;
  positionRevision: number;
  selected: Selection;
  consumed: PlayerMovementPredictionState | null;
  committed: { pose: Pose; state: PlayerMovementPredictionState } | null;
}

/** Selection, physics consumption and POST_UPDATE publication are deliberately distinct. */
export class PlayerMovementAcknowledgements {
  private readonly entries = new Map<string, Entry>();

  private get(id: string, positionRevision: number): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { revision: 0, positionRevision, selected: { sequence: 0, speed: 0, canPredict: false },
        consumed: null, committed: null };
      this.entries.set(id, entry);
    } else if (entry.positionRevision !== positionRevision) {
      entry.positionRevision = positionRevision;
      this.interrupt(id);
    }
    return entry;
  }

  select(id: string, positionRevision: number, sequence: number | undefined, speed: number, canPredict: boolean): void {
    const entry = this.get(id, positionRevision);
    const validSequence = Number.isSafeInteger(sequence) && sequence! > 0 ? sequence! : 0;
    const allowed = canPredict && validSequence > 0 && Number.isFinite(speed) && speed >= 0;
    if (entry.selected.canPredict !== allowed) entry.revision++;
    entry.selected = { sequence: validSequence, speed: Number.isFinite(speed) ? Math.max(0, speed) : 0, canPredict: allowed };
  }

  interrupt(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.revision++;
    entry.selected = { ...entry.selected, canPredict: false };
  }

  consume(id: string, positionRevision: number, deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const entry = this.get(id, positionRevision), selected = entry.selected;
    const previous = entry.consumed;
    entry.consumed = {
      ...selected, revision: entry.revision,
      appliedMs: (previous?.sequence === selected.sequence && previous.revision === entry.revision
        ? previous.appliedMs : 0) + deltaMs,
    };
  }

  commit(id: string, pose: Pose): void {
    const entry = this.get(id, pose.positionRevision);
    if (!entry.consumed) return;
    // Explicit copy: the host passes PlayerEntity, whose pose fields are prototype getters.
    entry.committed = { pose: { x: pose.x, y: pose.y, positionRevision: pose.positionRevision },
      state: { ...entry.consumed } };
  }

  snapshot(id: string, pose: Pose): PlayerMovementPredictionState {
    const entry = this.get(id, pose.positionRevision), committed = entry.committed;
    const matches = committed && committed.state.revision === entry.revision
      && committed.pose.positionRevision === pose.positionRevision
      && committed.pose.x === pose.x && committed.pose.y === pose.y;
    if (matches) return { ...committed.state, canPredict: committed.state.canPredict && entry.selected.canPredict };
    return { sequence: entry.consumed?.sequence ?? 0, appliedMs: 0, revision: entry.revision,
      speed: entry.selected.speed, canPredict: false };
  }

  remove(id: string): void { this.entries.delete(id); }
  clear(): void { this.entries.clear(); }
}
