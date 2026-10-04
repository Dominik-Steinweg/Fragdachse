export const viewport = { width: 960, height: 540 };
export const tolerance = { delta: 12, maxRatio: .001 };
const target = (gridX, gridY) => ({ action: 'target', gridX, gridY });
const camera = zoom => ({ action: 'camera', zoom, focusTarget: true });
const step = frames => ({ action: 'step', frames });
const debug = extra => ({ action: 'renderDebug', disable: [], ...extra });
const review = extra => ({ action: 'armageddonReview', count: 4, progress: .65, ...extra });
const shot = (id, commands = []) => ({ id, commands, masks: [] });
// Exclude the observer's animated status rings and the screen HUD; all nine
// turret canvases, their supports and world lighting remain inside the comparison.
const towerShot = (id, commands = []) => ({ id, commands,
  masks: [{ x: 0, y: 0, width: 160, height: 540 }, { x: 0, y: 0, width: 960, height: 30 }] });
const base = { version: 1, classId: 'dachs_nukem', mapId: '1', seed: 12345, timeOfDay: 720,
  player: { gridX: 27, gridY: 28 }, hideAim: true, freezeMission: true, suppressWaves: true, hideTutorial: true };

// Each group boots a fresh isolated tab. Every selected group replays all preceding cues.
export const groups = [
  { id: 'lobby', scenario: null, setup: [debug({ lobbyTimeOfDay: 720 })], shots: [shot('lobby-day')] },
  { id: 'day', scenario: base, setup: [target(28, 23), camera(1.4)], shots: [
    shot('map1-day'), shot('fog-rocks', [target(27, 18), camera(2)]),
    shot('zoom-wide', [target(28, 23), camera(1)]), shot('zoom-close', [camera(2.5)]),
    shot('player-material', [target(27, 28), camera(4)]),
    shot('player-normal', [debug({ characterMaterialView: 'normal' })]),
    shot('enemies-day', [debug({ characterMaterialView: 'material' }), { action: 'enemyMeshReview', count: 4, pose: 4 }, step(1)]),
  ] },
  { id: 'dusk', scenario: { ...base, timeOfDay: 1140 }, setup: [target(28, 23), camera(1.4)], shots: [shot('map1-dusk')] },
  { id: 'night', scenario: { ...base, timeOfDay: 0 }, setup: [target(28, 23), camera(1.4)], shots: [
    shot('map1-night'), shot('enemies-night', [{ action: 'enemyMeshReview', count: 4, pose: 4 }, step(1)]),
  ] },
  { id: 'low', scenario: base, setup: [{ action: 'quality', level: 'low' }, target(28, 23), camera(1.4)], shots: [shot('map1-low')] },
  { id: 'explosion', scenario: base, setup: [target(27, 26), camera(2)], shots: [
    shot('explosion-f01', [review({ count: 1, singleImpact: true }), step(1)]),
    shot('explosion-f12', [step(11)]), shot('explosion-f36', [step(24)]),
  ] },
  { id: 'armageddon', scenario: base, setup: [target(27, 24), camera(1.5)], shots: [
    shot('armageddon-normal', [review({}), step(1)]),
    shot('armageddon-void', [review({ variant: 'void' }), step(1)]),
    shot('armageddon-impact', [review({ singleImpact: true }), step(12)]),
  ] },
  // Seed 12345 parks the train's primary blast at world (9504, 1352).
  { id: 'train', scenario: { ...base, mapId: '7', player: null }, setup: [
    { action: 'trainShowcase', follow: false, focus: 'loco', zoom: 1.5 },
    { action: 'stop' }, target(296.5, 41.75), camera(1.5),
  ], shots: [
    shot('train-intact', [step(1)]), shot('train-destroyed-f12', [{ action: 'trainExplosion' }, step(12)]),
  ] },
  { id: 'towers', scenario: { ...base, player: { gridX: 20, gridY: 24 } },
    setup: [target(24, 24), camera(8), { action: 'turretMaterialReview' }], shots: [
      towerShot('towers-day'),
      towerShot('towers-dusk', [{ action: 'options', values: { timeOfDay: 1020 } }, step(60)]),
      towerShot('towers-night', [{ action: 'options', values: { timeOfDay: 0 } }, step(60)]),
    ] },
];
