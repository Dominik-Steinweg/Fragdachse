import { PLAYER_SIZE } from '../../config';
import { HeadlessStaticTargetWorld } from './HeadlessStaticTargetWorld';

/**
 * Abwaertskompatibler Single-Target-Wrapper. Die gemeinsame statische Simulationslogik
 * liegt in `HeadlessStaticTargetWorld.ts` und wird hier nicht dupliziert.
 */
export class HeadlessSingleTargetWorld extends HeadlessStaticTargetWorld {
  constructor(
    targetDistance: number,
    seed = 1,
    recordEvents = true,
    targetRadius = PLAYER_SIZE * 0.5,
  ) {
    super(targetDistance, seed, recordEvents, targetRadius, 'single_target_static');
  }
}
