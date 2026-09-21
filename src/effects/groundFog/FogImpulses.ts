import { FOG, type FogQuality, type FogRect } from './FogConfig';
export interface FogImpulse {
  x: number; y: number; endX: number; endY: number; radius: number;
  strength: number; kind: 'motion' | 'projectile' | 'explosion' | 'melee'; priority: number;
  arcDegrees?: number;
}
/** Bounded, spatially merged input. It contains observations, never simulated fog cells. */
export class FogImpulses {
  private readonly pending = new Map<string, FogImpulse>();
  dropped = 0;
  add(input: FogImpulse): void {
    if (!Number.isFinite(input.x + input.y + input.endX + input.endY + input.radius + input.strength) || input.radius <= 0) return;
    const size = input.kind === 'explosion' ? Math.max(24, input.radius * .4) : 16;
    // Keep both endpoints in the key: a bounce may not become a diagonal shortcut.
    const sector = input.kind === 'melee' ? `:${Math.atan2(input.endY - input.y, input.endX - input.x).toFixed(2)}:${input.arcDegrees}` : '';
    const key = `${input.kind}:${Math.floor(input.x / size)},${Math.floor(input.y / size)}:${Math.floor(input.endX / size)},${Math.floor(input.endY / size)}${sector}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.strength = Math.min(1, existing.strength + input.strength * .35);
      existing.radius = Math.max(existing.radius, input.radius); existing.priority = Math.max(existing.priority, input.priority); return;
    }
    if (this.pending.size >= FOG.impulses.high * 2) {
      let weakestKey: string | undefined, weakest = input.priority;
      for (const [k, value] of this.pending) if (value.priority < weakest) { weakest = value.priority; weakestKey = k; }
      this.dropped++;
      if (weakestKey === undefined) return;
      this.pending.delete(weakestKey);
    }
    this.pending.set(key, { ...input, strength: Math.min(1, Math.max(0, input.strength)) });
  }
  drain(quality: FogQuality, view: FogRect): FogImpulse[] {
    const values = [...this.pending.values()].filter(p =>
      Math.max(p.x, p.endX) + p.radius >= view.x && Math.min(p.x, p.endX) - p.radius <= view.x + view.width
      && Math.max(p.y, p.endY) + p.radius >= view.y && Math.min(p.y, p.endY) - p.radius <= view.y + view.height);
    values.sort((a, b) => b.priority - a.priority || b.strength - a.strength);
    const limit = FOG.impulses[quality]; this.dropped += Math.max(0, values.length - limit);
    this.pending.clear(); return values.slice(0, limit);
  }
  clear(): void { this.pending.clear(); }
  get size(): number { return this.pending.size; }
}
