import { registerDiagnosticMap, type CoopDefenseMapAuthoringConfig } from '../../config/coopDefenseMaps';
import authoredMap from '../../config/coopDefenseMaps/20-abgrundteich.json';
import { krakenAbyssMap } from './krakenAbyssMap';

export const KRAKEN_PERFORMANCE_MAP_ID = 'kraken-performance';
/** Map 20 terrain and waves with an unarmed diagnostic outpost and no opening-wave
 * boss gate, so an observing player can measure the entire scripted encounter. */
export function registerKrakenPerformanceMap(): () => void {
  const map = structuredClone(authoredMap) as CoopDefenseMapAuthoringConfig;
  if (map.boss?.enemyKind !== 'abyssal-kraken' || !map.krakenHabitat) throw Error('Map 20 must contain the Kraken');
  const { startAfterEncounterId: _gate, ...boss } = map.boss;
  // The observer does not defend a base. Reuse the existing unarmed diagnostic
  // outpost so background waves cannot end the capture before the scripted death.
  const { persistentBase: _base, ...world } = map;
  return registerDiagnosticMap({ ...world, boss, bases: krakenAbyssMap().bases, mapId: KRAKEN_PERFORMANCE_MAP_ID });
}
