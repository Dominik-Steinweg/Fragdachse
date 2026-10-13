import { bridge } from '../../network/bridge';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { isLocalScenarioBotPeer } from '../../network/peer/LocalScenarioSession';
import { markStoredCoopDefenseMapCompleted, updateStoredDawnProgress } from '../../utils/localPreferences';
import { DAWN_UNLOCK_AFTER_MAP_ID } from '../../dawn/rules/DawnUnlock';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../../dawn/rules/DawnPhase';
import type { DawnPhaseId, DawnSchedule } from '../../config/dawn/dawnContent';
import type { DevScenario } from './config';

/** Called only after the dev entry has replaced browser storage, before the Ready commit. */
export function prepareScenarioProgram(config: DevScenario): void {
  if (!isDevScenarioMode() || !bridge.isHost() || !bridge.getConnectedPlayers()
    .every(player => player.id === bridge.getLocalPlayerId() || isLocalScenarioBotPeer(player.id))) {
    throw new Error('Isolated dev host required');
  }
  if (config.dawn) {
    markStoredCoopDefenseMapCompleted(DAWN_UNLOCK_AFTER_MAP_ID);
    if (!updateStoredDawnProgress(draft => { draft.expansionLevel = config.dawn!.threat - 1; })) {
      throw new Error('Dawn-Threat konnte nicht gesetzt werden.');
    }
    bridge.setCoopProgram({ kind: 'dawn' });
  } else {
    bridge.setCoopProgram({ kind: 'campaign' });
    bridge.setCoopDefenseMapId(config.mapId!);
  }
}

export function dawnPhaseElapsed(schedule: DawnSchedule, phase: DawnPhaseId, offsetMs: number): number {
  if (!Number.isSafeInteger(offsetMs) || offsetMs < 0) throw new Error('offsetMs: nichtnegative ganze Millisekunden erwartet.');
  const startMs = getDawnPhaseStartMs(schedule, phase);
  const endMs = resolveDawnPhase(schedule, startMs).phaseEndMs;
  if (offsetMs >= endMs - startMs) throw new Error('offsetMs muss innerhalb der gewählten Phase liegen.');
  return startMs + offsetMs;
}
