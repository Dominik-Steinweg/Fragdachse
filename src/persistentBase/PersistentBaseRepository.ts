import {
  getStoredPersistentBaseState,
  setStoredPersistentBaseState,
} from '../utils/localPreferences';
import { clonePersistentBaseState } from './PersistentBaseTypes';
import type { PersistentBaseState } from './PersistentBaseTypes';

export interface PersistentBaseRepositoryPort {
  load(): PersistentBaseState;
  save(state: PersistentBaseState): void;
}

/** Domain boundary for the committed persistent base. It never touches LocalStorage directly. */
export class PersistentBaseRepository implements PersistentBaseRepositoryPort {
  load(): PersistentBaseState {
    return getStoredPersistentBaseState();
  }

  save(state: PersistentBaseState): void {
    setStoredPersistentBaseState(clonePersistentBaseState(state));
  }
}

