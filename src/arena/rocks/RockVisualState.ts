import { multiplyTint } from '../BlobSurfaceShading';
import type { BlobSurfaceCornerTints } from '../BlobSurfaceShading';

/** Rendererunabhaengige Darstellungswahrheit eines einzelnen Felsens. */
export interface RockVisualState {
  readonly id: number;
  readonly gridX: number;
  readonly gridY: number;
  x: number;
  y: number;
  active: boolean;
  frame: number;
  cornerTints: BlobSurfaceCornerTints;
  damageTint: number;
  ownerColor?: number;
  ownerTintStrength: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
}

export type RockVisualStatePatch = Partial<Omit<RockVisualState, 'id' | 'gridX' | 'gridY'>>;

/**
 * Deduplizierter Aenderungstrichter. Gameplay-Pfade schreiben nur hier hinein; der konkrete
 * Renderer konsumiert die finale Pose einmal je Frame.
 */
export class RockVisualStateStore {
  readonly states: Array<RockVisualState | undefined> = [];
  private readonly dirtyIds = new Set<number>();

  add(state: RockVisualState, dirty = true): void {
    this.states[state.id] = state;
    if (dirty) this.dirtyIds.add(state.id);
  }

  get(id: number): RockVisualState | undefined {
    return this.states[id];
  }

  patch(id: number, patch: RockVisualStatePatch): RockVisualState | undefined {
    const state = this.states[id];
    if (!state) return undefined;
    let changed = false;
    for (const [rawKey, value] of Object.entries(patch)) {
      const key = rawKey as keyof RockVisualStatePatch;
      const current = state[key as keyof RockVisualState];
      const equal = Array.isArray(current) && Array.isArray(value)
        ? current.length === value.length && current.every((entry, index) => entry === value[index])
        : Object.is(current, value);
      if (equal) continue;
      (state as unknown as Record<string, unknown>)[rawKey] = value;
      changed = true;
    }
    if (changed) this.dirtyIds.add(id);
    return state;
  }

  markDirty(id: number): void {
    if (this.states[id]) this.dirtyIds.add(id);
  }

  consumeDirtyIds(): number[] {
    const ids = [...this.dirtyIds];
    this.dirtyIds.clear();
    return ids;
  }

  clearDirty(): void {
    this.dirtyIds.clear();
  }

  clear(): void {
    this.states.length = 0;
    this.dirtyIds.clear();
  }
}

/** Bestehende Damage-/Owner-Mischung, getrennt von den vier Surface-Ecktints. */
export function resolveRockStateTint(state: RockVisualState): number {
  if (state.ownerColor === undefined || state.ownerTintStrength <= 0) return state.damageTint;
  const strength = Math.max(0, Math.min(1, state.ownerTintStrength));
  const baseRed = (state.damageTint >> 16) & 0xff;
  const baseGreen = (state.damageTint >> 8) & 0xff;
  const baseBlue = state.damageTint & 0xff;
  const ownerRed = (state.ownerColor >> 16) & 0xff;
  const ownerGreen = (state.ownerColor >> 8) & 0xff;
  const ownerBlue = state.ownerColor & 0xff;
  const red = Math.round(baseRed + (ownerRed - baseRed) * strength);
  const green = Math.round(baseGreen + (ownerGreen - baseGreen) * strength);
  const blue = Math.round(baseBlue + (ownerBlue - baseBlue) * strength);
  return (red << 16) | (green << 8) | blue;
}

/** Reihenfolge wie `Image.setTint`: top-left, top-right, bottom-left, bottom-right. */
export function resolveRockCornerTints(state: RockVisualState): BlobSurfaceCornerTints {
  const stateTint = resolveRockStateTint(state);
  return [
    multiplyTint(stateTint, state.cornerTints[0]),
    multiplyTint(stateTint, state.cornerTints[1]),
    multiplyTint(stateTint, state.cornerTints[2]),
    multiplyTint(stateTint, state.cornerTints[3]),
  ];
}
