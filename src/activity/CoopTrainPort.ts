import type { TrainEventConfig } from '../types';
import type { CoopDefenseMapEventHandler } from '../systems/CoopDefenseMapEventDirector';
import type { TrainAwarenessSource } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';

/** Narrow Activity-facing port for authored train materialization. */
export interface CoopTrainPort {
  readonly materializeAuthoredTrain: (
    trackGridX: number,
    direction: 1 | -1,
  ) => CoopDefenseMapEventHandler;
  readonly getCurrentTrain: () => TrainAwarenessSource | null;
  readonly getCurrentTrainEvent: () => TrainEventConfig | undefined;
  readonly releaseActivityTrain: () => void;
  readonly clearTrainEvent: () => void;
}
