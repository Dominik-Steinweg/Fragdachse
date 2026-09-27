import { expect, it } from 'vitest';
import { createLocalScenarioSession } from '../src/network/peer/LocalScenarioSession';
import { enableDevScenarioMode } from '../src/utils/devScenarioMode';
import { clearActiveSession } from '../src/network/peer/session';

it('requires the isolated dev entry and runs real host RPCs without any transport links', async () => {
  await expect(createLocalScenarioSession({})).rejects.toThrow('isolated dev entry');
  enableDevScenarioMode();
  const session = await createLocalScenarioSession({});
  try {
    expect(session.room.isHost()).toBe(true);
    expect(session.transport.getLinks()).toEqual([]);
    const received: unknown[] = [];
    session.room.registerHostHandler('scenario-test', payload => { received.push(payload); });
    session.room.sendHost('scenario-test', { action: 'real-room' });
    expect(received).toEqual([{ action: 'real-room' }]);
    await expect(session.transport.reconnect()).rejects.toThrow();
  } finally { clearActiveSession(); }
});
