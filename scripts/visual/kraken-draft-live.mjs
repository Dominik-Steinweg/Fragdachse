import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

/** Measures real wall time outside the deterministic browser clock. No production writes. */
export async function runKrakenDraftLive({ args, page, report, out, command, status, step, settle, grid, capture, boards, save }) {
  const phase = s => s.krakenResidency?.state?.phase.kind;
  const versionFile = 'art/poc/pipeline-v2/drafts/version.json';
  const wait = async (test, label, limit = 1800) => {
    let s = await status();
    for (let i = 0; !test(s); i++) {
      if (i >= limit) throw Error(`${label}: timed out`);
      s = await step(3);
    }
    return s;
  };
  // Asset source transactions resolve only after a postrender. Pump zero-delta frames
  // while awaiting them, so a paused review cannot deadlock its own reload promise.
  const reload = async c => {
    let done = false, result, failure;
    const work = page.evaluate(c => window.devScenario.run(c), c)
      .then(r => { result = r; }, e => { failure = e; }).finally(() => { done = true; });
    const deadline = performance.now() + 180000;
    while (!done) {
      if (performance.now() > deadline) throw Error(`Reload timed out: ${JSON.stringify(c)}`);
      const s = await status();
      if (s.ready && s.paused && s.pendingSteps === 0) await command({ action: 'settle', frames: 3 });
      await page.waitForTimeout(50);
    }
    await work;
    if (failure) throw failure;
    if (!result.ok) throw Error(result.error);
    return result.status;
  };
  const volley = async (group, measuredStart = null) => {
    await command({ action: 'krakenTarget', gridX: 45, gridY: 40 });
    await step(3);
    await wait(s => phase(s) === 'surfaced' && !s.krakenResidency.state.bodyAction && !s.krakenResidency.state.spines.length,
      'Available surfaced body');
    await command({ action: 'krakenAct', act: 'spines' });
    let s = await wait(s => s.krakenDevAction?.status === 'started' && s.krakenResidency.state.bodyAction?.kind === 'spines', 'Spine volley');
    const a = s.krakenResidency.state.bodyAction;
    const focus = { ...s.krakenResidency.hostPosition };
    if (measuredStart !== null) {
      report.iteration.firstRenderedClipAt = new Date().toISOString();
      report.iteration.commandToVisibleClipMs = performance.now() - measuredStart;
      report.iteration.firstRenderedState = s;
      await save();
    }
    for (const offset of [0, 420, 760, 870, 980, 1090, 1200, 1310, 1760]) {
      while (s.krakenResidency.hostNow < a.startedAt + offset) s = await step(Math.min(12, Math.max(1, Math.ceil((a.startedAt + offset - s.krakenResidency.hostNow) * .06))));
      await capture(group, s, focus);
    }
    return s;
  };
  await reload({ action: 'krakenMission', skipIntro: true, drafts: true });
  await page.waitForFunction(() => window.devScenario.status().ready && window.devScenario.status().paused);
  await command({ action: 'quality', level: 'high' });
  await command({ action: 'options', values: { refillHp: true, hideAim: true, hideTutorial: true, timeOfDay: 720 } });
  await command({ action: 'figureSun', azimuth: 135, elevation: 28 });
  await settle();
  report.draftStart = await status();
  report.versionBefore = JSON.parse(await readFile(versionFile, 'utf8'));
  const identity = report.draftStart.krakenResidency.state.boss;
  await reload({ action: 'krakenAssets', source: 'production' });
  await volley('production-v13-spines');
  await reload({ action: 'krakenAssets', source: 'draft' });
  await volley('draft-before-spines');
  await command({ action: 'resume' });

  report.iteration = { command: 'npm run kraken:iterate -- --clips spine-volley', startedAt: new Date().toISOString(),
    clock: 'Node performance.now / real UTC; browser Date.now is the deterministic simulation clock', attempts: [] };
  const start = performance.now();
  const attempts = Math.min(2, Math.max(1, Number(args['iterate-attempts'] ?? 2)));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const log = path.join(out, `iterate-${attempt}.log`);
    await writeFile(log, '');
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run kraken:iterate -- --clips spine-volley'], {
        cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BLENDER_PATH: process.env.BLENDER_PATH ?? 'D:/Blender Foundation/Blender 5.2/blender.exe',
          PYTHONDONTWRITEBYTECODE: '1', OPTIX_CACHE_PATH: path.resolve('art/poc/pipeline-v2/drafts/.optix-cache'),
          CUDA_CACHE_PATH: path.resolve('art/poc/pipeline-v2/drafts/.cuda-cache') },
      });
      let writes = Promise.resolve();
      const output = chunk => { process.stdout.write(chunk); writes = writes.then(() => appendFile(log, chunk)); };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.once('error', reject);
      child.once('close', code => { void writes.then(() => resolve(code), reject); });
    });
    report.iteration.attempts.push({ attempt, startedAt, endedAt: new Date().toISOString(), exitCode, log: path.basename(log) });
    await save();
    if (exitCode === 0) break;
    if (attempt === attempts) throw Error('Iterate failed; retry budget exhausted, see iteration logs');
    console.error('Iterate failed; repeating once for concurrent authoring changes.');
    await page.waitForTimeout(1000);
  }
  report.iteration.processCompletedMs = performance.now() - start;
  report.versionAfter = JSON.parse(await readFile(versionFile, 'utf8'));
  if (report.versionAfter.version === report.versionBefore.version) throw Error('Iterate did not publish a new version');
  // Prefer the existing publication poll; the manual command is the supported fallback.
  try { await page.waitForFunction(v => window.devScenario.status().krakenAssets?.version === v,
    report.versionAfter.version, { timeout: 30000, polling: 100 }); }
  catch { await reload({ action: 'krakenReloadAssets' }); report.iteration.manualReload = true; }
  report.iteration.reloadVisibleMs = performance.now() - start;
  await command({ action: 'pause' });
  await settle();
  const loaded = await status();
  report.reloadState = loaded;
  if (JSON.stringify(loaded.krakenResidency.state.boss) !== JSON.stringify(identity)) throw Error('Draft reload replaced the host boss identity');
  if (!(loaded.krakenAssets.renderedConsumers > 0)) throw Error('Reload was not confirmed by a rendered consumer');
  await volley('draft-after-spines', start);
  const label = report.versionAfter.assets['abyssal-kraken'].label;
  report.iteration.clipRequests = report.draftRequests.filter(r => r.url.includes(`/${label}/`) && /\/spine-volley[-/]/.test(r.url));
  // Atlas pages are spine-volley-<page>.png?v=<hash>; the clip folder only holds shadow meshes.
  if (!report.iteration.clipRequests.some(r => r.status === 200 && /\.png(\?|$)/.test(r.url))) throw Error('New draft spine-volley pixels were not requested');
  await boards();
  report.completed = true;
  await save();
}
