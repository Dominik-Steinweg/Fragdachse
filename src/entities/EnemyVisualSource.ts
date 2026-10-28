import type Phaser from 'phaser';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { SyncedEnemyState } from '../types';

/** Presentation capabilities; no simulation mutations are exposed. */
export interface EnemyVisualSource {
  readonly eliteAffixId?: import('../dawn/contracts/DawnContentIds').DawnEliteAffixId;
  readonly id: string;
  readonly kind: CoopDefenseEnemyKind;
  readonly faction: 'hostile' | 'allied';
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly getHp: () => number;
  readonly getNetSnapshot: () => SyncedEnemyState;
  /** Replicated Kabummtula timeline (alert, rush, telegraph, leap); absent on non-spider views. */
  readonly getKaboomtulaState?: () => import('../systems/KaboomtulaState').KaboomtulaState;
  /** Replicated pounce timeline (aim, locked landing, flight); absent on non-pouncing views. */
  readonly getPounceState?: () => import('../systems/EnemyPounceState').EnemyPounceState;
  /** Replicated heat cycle (charge, booked warning, burst); absent on views without a heat burst. */
  readonly getHeatBurstState?: () => import('../systems/EnemyHeatBurstState').EnemyHeatBurstState;
  /** Presented general vulnerability (host status or replicated snapshot), never a rule input. */
  readonly isVulnerable: () => boolean;
  /** Optional local gesture; placeholders and other enemy views need no cast clip. */
  readonly playFirestarterCast?: (now: number) => void;
}
