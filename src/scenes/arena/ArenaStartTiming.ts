import { ARENA_COUNTDOWN_SEC } from '../../config';

/** No extra lead: the visible countdown itself is the synchronization window. */
export function resolveArenaStartTime(nowMs: number, countdownSec = ARENA_COUNTDOWN_SEC): number {
  return nowMs + countdownSec * 1000;
}
