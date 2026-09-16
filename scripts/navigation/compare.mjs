import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('build/navigation-results');
const args = process.argv.slice(2);
const sessionArg = args.indexOf('--session');
const requestedSession = sessionArg < 0 ? null : args[sessionArg + 1];
const toleranceArg = args.indexOf('--max-regression');
const maxRegression = toleranceArg < 0 ? .05 : Number(args[toleranceArg + 1]);
if (!Number.isFinite(maxRegression) || maxRegression < 0 || maxRegression > 1) throw new Error('Invalid --max-regression fraction');
const limit = 1 + maxRegression;
const scenarios = ['rock-field', 'siege', 'combat', 'allies'];
const loaded = readdirSync(directory).filter(file => scenarios.some(name => file.startsWith(`${name}-`))).map(file => {
  const report = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
  return { file, ...report };
}).filter(report => report.environment?.suite === 'paired');
const session = requestedSession ?? loaded.map(report => report.environment.session).sort().at(-1);
const reports = loaded.filter(report => report.environment.session === session);
if (!reports.length) throw new Error('No paired browser session. Run the lab with suite=paired or supply --session.');
const median = numbers => {
  const values = [...numbers].sort((a, b) => a - b), middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
const comparableKeys = ['cpuMeasurement', 'combatObservation', 'cameraFixture', 'mutations', 'scenarioVersion', 'seed', 'count', 'warmupMs', 'durationMs', 'userAgent', 'hardware', 'gpu',
  'graphicsQuality', 'renderResolution', 'viewport', 'enemyConfig', 'weaponConfig', 'initialLoadout', 'density', 'targetFixture', 'mapId', 'pursuit', 'spawnAudit'];
const variant = report => report.environment.build.startsWith('navigation-baseline:') ? 'baseline' : 'candidate';
const issues = [];
const builds = {};
for (const report of reports) {
  const type = variant(report), e = report.environment;
  (builds[type] ??= new Set()).add(e.build);
  if (!report.valid) issues.push(`${report.file}: manual interaction/diagnostics invalidated the run`);
  if (e.cpuMeasurement !== 'phaser-game-step-v1' || !report.summaries.arcadeCpuMs?.max) issues.push(`${report.file}: complete Game/Arcade CPU timing unavailable`);
  if (e.warmupMs < 10_000 || e.durationMs < 60_000) issues.push(`${report.file}: short run`);
  if (e.mutations) issues.push(`${report.file}: geometry mutation run cannot qualify the fixed reference series`);
  if (e.pursuit || e.spawnAudit) issues.push(`${report.file}: behavior probe cannot qualify the fixed reference series`);
  if (report.summaries.population?.p50 < e.count * .98) issues.push(`${report.file}: population was not maintained`);
  if (!report.summaries.frameCpuMs?.count || !report.summaries.renderCpuMs?.max) issues.push(`${report.file}: CPU/render timing unavailable`);
  if (report.performance?.summaries.observedScope.pageVisible?.some(segment => !segment.value)) issues.push(`${report.file}: page was hidden`);
}
for (const [type, ids] of Object.entries(builds)) if (ids.size !== 1) issues.push(`${type}: mixed build identities in one session`);
const comparisons = scenarios.map(scenario => {
  const subset = reports.filter(report => report.environment.scenario === scenario);
  const pairIds = [...new Set(subset.map(report => report.environment.pair))].sort((a, b) => a - b);
  const pairs = [];
  for (const pairId of pairIds) {
    const pair = subset.filter(report => report.environment.pair === pairId);
    const baseline = pair.find(report => variant(report) === 'baseline'), candidate = pair.find(report => variant(report) === 'candidate');
    if (pair.length !== 2 || !baseline || !candidate) { issues.push(`${scenario}/${pairId}: incomplete or duplicate pair`); continue; }
    for (const key of comparableKeys) if (JSON.stringify(baseline.environment[key]) !== JSON.stringify(candidate.environment[key])) issues.push(`${scenario}/${pairId}: ${key} differs`);
    if (baseline.geometryFingerprint !== candidate.geometryFingerprint) issues.push(`${scenario}/${pairId}: initial layout differs`);
    pairs.push({ pair: pairId, baseline: baseline.file, candidate: candidate.file,
      cpu: { baseline: baseline.summaries.frameCpuMs?.p95, candidate: candidate.summaries.frameCpuMs?.p95 },
      frame: { baseline: baseline.summaries.frameMs.p95, candidate: candidate.summaries.frameMs.p95 },
      host: { baseline: baseline.summaries.totalMs.p95, candidate: candidate.summaries.totalMs.p95 },
      stationary: { baseline: baseline.quality.stationaryWithoutAttackMs, candidate: candidate.quality.stationaryWithoutAttackMs },
      overlapsPerObservation: { baseline: baseline.quality.bodyOverlapSamples / baseline.quality.observations,
        candidate: candidate.quality.bodyOverlapSamples / candidate.quality.observations },
      population: { baseline: baseline.summaries.population, candidate: candidate.summaries.population },
      events: { baselineRespawns: baseline.quality.respawns, candidateRespawns: candidate.quality.respawns } });
  }
  const assess = key => {
    const ratios = pairs.map(pair => pair[key].candidate / pair[key].baseline);
    if (ratios.length < 3 || ratios.some(value => !Number.isFinite(value))) return { status: 'OPEN', ratios };
    // A deterministic paired bootstrap reports uncertainty, not a pooled average hiding scenarios.
    let randomState = 183;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
    const bootstrap = Array.from({ length: 2000 }, () => median(ratios.map(() => ratios[Math.floor(random() * ratios.length)]))).sort((a, b) => a - b);
    const low = bootstrap[50], high = bootstrap[1949], ratio = median(ratios);
    const status = low > limit ? 'FAIL' : high <= limit && Math.max(...ratios) <= Math.max(1.15, limit) ? 'PASS' : ratios.length < 7 ? 'EXTEND_TO_SEVEN' : 'OPEN';
    return { status, medianRatio: ratio, bootstrap95: [low, high], ratios };
  };
  const timingKeys = ['frameCpuMs', 'frameMs', 'sceneCpuMs', 'renderCpuMs', 'arcadeCpuMs',
    'navIntentMs', 'enemyMovementMs', 'enemyAlliesMs', 'enemyAttacksMs', 'combatProjectilesMs',
    'areaEffectsMs', 'worldVisualsMs'];
  const details = Object.fromEntries(['baseline', 'candidate'].map(type => {
    const runs = subset.filter(report => variant(report) === type);
    const values = getter => runs.map(getter).filter(Number.isFinite);
    const middle = getter => { const samples = values(getter); return samples.length ? median(samples) : null; };
    return [type, {
      // These are medians of per-run percentiles, never a sum of component percentiles.
      timingMs: Object.fromEntries(timingKeys.map(key => [key, Object.fromEntries(
        ['p50', 'p95', 'p99'].map(percentile => [percentile, middle(run => run.summaries[key]?.[percentile])]))])),
      gpuP95Ms: middle(run => run.performance?.summaries.gpu?.frameTime?.p95),
      heapP95Bytes: middle(run => run.summaries.heapBytes?.p95),
      fieldsAtEnd: middle(run => run.navigation?.final.fields),
      jobsDuringMeasurement: middle(run => run.navigation?.final.dispatchedJobs - run.navigation?.initial.dispatchedJobs),
      workerComputeDuringMeasurementMs: middle(run => run.navigation?.final.workerComputeTotalMs - run.navigation?.initial.workerComputeTotalMs),
      respawns: middle(run => run.quality.respawns),
      combatantDamageEvents: middle(run => run.combatantDamageEvents
        ? Object.values(run.combatantDamageEvents).reduce((total, event) => total + event.count, 0) : null),
      localNeighborsExamined: middle(run => run.navigation?.final.localNeighborsExamined - run.navigation?.initial.localNeighborsExamined),
      waitingNeighborsObserved: middle(run => run.navigation?.final.waitingNeighborsObserved - run.navigation?.initial.waitingNeighborsObserved),
      breachSearchExpansions: middle(run => run.navigation?.final.breachSearchExpansions - run.navigation?.initial.breachSearchExpansions),
      overlapObservations: middle(run => run.quality.bodyOverlapSamples),
      longFrameEvents: middle(run => run.browserObservations?.longFrames?.length),
    }];
  }));
  return { scenario, pairs, cpu: assess('cpu'), frame: assess('frame'), details };
});
const performanceStatus = issues.length ? 'OPEN' : comparisons.some(c => c.cpu.status === 'FAIL' || c.frame.status === 'FAIL') ? 'FAIL'
  : comparisons.every(c => c.cpu.status === 'PASS' && c.frame.status === 'PASS') ? 'PASS' : 'OPEN';
const result = { schemaVersion: 1, session, generatedAt: new Date().toISOString(), performanceStatus,
  maxRegression,
  qualityStatus: 'Requires the controlled geometry/intent/ability checks and headless comparison; stationary time at a valid attack position is not a stuck unit.',
  issues, builds: Object.fromEntries(Object.entries(builds).map(([key, ids]) => [key, [...ids]])), comparisons };
writeFileSync(resolve(directory, `comparison-${session.replace(/[^\w-]/g, '_')}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ session, performanceStatus, issues, comparisons: comparisons.map(({ scenario, cpu, frame }) => ({ scenario, cpu, frame })) }, null, 2));
if (performanceStatus !== 'PASS') process.exitCode = 2;
