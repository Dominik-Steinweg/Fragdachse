/** Reuses the existing ordinary ready/start/abort lab port; no gameplay fixtures. */
export async function measureSuiteLoading(page, guard) {
  const wait = async (read, accepts) => {
    for (;;) {
      await guard();
      const state = await page.evaluate(read);
      if (state.hidden || !state.focused) throw Error('Load page lost visibility/focus');
      if (state.error) throw Error(state.error);
      if (accepts(state)) return state;
      await page.waitForTimeout(100);
    }
  };
  await wait(() => ({ state: window.__FD_PERF__?.state, error: window.__FD_PERF__?.error,
    hidden: document.hidden, focused: document.hasFocus() }), s => s.state === 'awaiting-audio');
  const bootRevealMs = await page.evaluate(() => performance.getEntriesByType('mark')
    .find(e => e.name.endsWith(':lobby-revealed'))?.startTime);
  const bootEvidence = await page.evaluate(() => ({
    marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('FD:lab:'))
      .map(e => ({ name: e.name, atMs: e.startTime })),
    navigation: performance.getEntriesByType('navigation').map(e => e.toJSON()),
    slowestResources: performance.getEntriesByType('resource').sort((a,b) => b.duration-a.duration).slice(0,20)
      .map(e => ({ name: new URL(e.name).pathname, initiator: e.initiatorType, fromMs: e.startTime,
        durationMs: e.duration, transferBytes: e.transferSize })),
  }));
  await page.mouse.click(4, 4);
  await page.waitForFunction(() => window.__FD_PERF__.audioState() === 'running');
  await page.evaluate(() => window.__FD_PERF__.prepareLoad());
  const read = () => ({ ...window.__FD_PERF__.load.status(), at: performance.now(),
    error: window.__FD_PERF__.error, hidden: document.hidden, focused: document.hasFocus() });
  const from = await page.evaluate(() => { const at = performance.now(); window.__FD_PERF__.load.start('1'); return at; });
  let revealAt;
  const playable = await wait(read, s => {
    if (!s.worldId?.endsWith(':1')) return false;
    if (s.revealReady) revealAt ??= s.at;
    return s.ready && s.revealReady;
  });
  const timeline = await page.evaluate(() => window.__FD_BOOT__?.timeline?.() ?? null);
  const world = timeline?.runs.findLast(r => r.scope === 'world' && r.startedAt >= from);
  const backFrom = await page.evaluate(() => { const at = performance.now(); window.__FD_PERF__.load.lobby(); return at; });
  const lobby = await wait(read, s => s.lobbyReady && s.revealReady);
  const bootStart = bootEvidence.marks.find(e => e.name.endsWith(':boot-start'))?.atMs;
  return { bootRevealMs, bootEvidence, bootToLobbyMs: bootStart == null ? null : bootRevealMs - bootStart,
    connectionWaitMs: bootEvidence.navigation[0]?.connectStart ?? null,
    map: '1', mapReadyMs: world?.outcome === 'ready' ? world.durationMs : null,
    commandToRevealMs: revealAt - from, commandToPlayableMs: playable.at - from,
    returnToLobbyMs: lobby.at - backFrom, loadingTimeline: timeline,
    notes: ['Reveal is eligibility, polled at 100 ms; playable includes the ordinary countdown.',
      'Internal map-ready is n/a on revisions without LoadingTimeline; no substitute is synthesized.'] };
}
