import type Phaser from 'phaser';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { SyncedEnemyState } from '../types';

/** Presentation capabilities; no simulation mutations are exposed. */
export interface EnemyVisualSource {
  readonly id: string;
  readonly kind: CoopDefenseEnemyKind;
  readonly faction: 'hostile' | 'allied';
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly getHp: () => number;
  readonly getNetSnapshot: () => SyncedEnemyState;
  /** Presented general vulnerability (host status or replicated snapshot), never a rule input. */
  readonly isVulnerable: () => boolean;
  /** Optional local gesture; placeholders and other enemy views need no cast clip. */
  readonly playFirestarterCast?: (now: number) => void;
}
