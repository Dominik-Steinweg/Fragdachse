import type { HomingTargetType } from '../types';
export interface ProjectileOriginTarget { readonly kind: 'player' | 'enemy' | 'decoy' | 'construction' | 'base' | 'rock'; readonly id: string }
export function originPhysicalKey(target: { readonly kind: string; readonly id: string | number }): string {
  return `${target.kind === 'construction' || target.kind === 'rock' ? 'obstacle' : target.kind}:${target.id}`;
}
export function homingTargetKind(type: HomingTargetType): ProjectileOriginTarget['kind'] {
  return type === 'players' ? 'player' : type === 'enemies' ? 'enemy' : type === 'decoys' ? 'decoy'
    : type === 'bases' ? 'base' : 'construction';
}
export function shouldIgnoreOriginHit(origin: ProjectileOriginTarget | undefined,
  target: { readonly kind: string; readonly id: string | number }, exited: boolean): boolean {
  return !!origin && !exited && originPhysicalKey(origin) === originPhysicalKey(target);
}
