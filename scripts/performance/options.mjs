export function parsePerformanceOptions(args) {
  const value = { caseId: 'standard', timeoutMs: 25 * 60_000 };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], arg = args[i + 1];
    if (flag === '--help') { console.log('perf:chrome [--case CASE-ID] [--build SOURCE-HASH] [--duration-seconds N] [--timeout-seconds N] [--capture-profile standard|reduced] [--enemy-eyes on|off] [--time-of-day HH:MM]\nCases: environment.route/dawn, destruction.single/nuke/bfg, enemies.low/medium/high, hazards.void-fire, weapon.glock/p90/plasma/mini-rockets/shotgun/asmd/bite/rocket/tesla/flame/hydra, utility.he/molotov/smoke/time-bubble, construction.defense, ultimate.armageddon, combat.day/night/day-night, recovery.idle'); process.exit(0); }
    if (!arg) throw new Error(`Missing argument for ${flag}`);
    if (flag === '--case') value.caseId = arg;
    else if (flag === '--build' && /^[a-f0-9]{64}$/.test(arg)) value.buildHash = arg;
    else if (flag === '--enemy-eyes' && ['on', 'off'].includes(arg)) value.enemyEyes = arg;
    else if (flag === '--time-of-day' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arg)) {
      const [h, m] = arg.split(':').map(Number); value.timeOfDayMinutes = h * 60 + m;
    }
    else if (flag === '--duration-seconds' || flag === '--timeout-seconds') {
      const ms = Number(arg) * 1000;
      if (!Number.isFinite(ms) || ms <= 0 || ms > 24 * 3600_000) throw new Error(`Invalid duration: ${arg}`);
      value[flag === '--duration-seconds' ? 'durationMs' : 'timeoutMs'] = ms;
    } else if (flag === '--capture-profile' && ['standard', 'reduced'].includes(arg)) value.captureProfile = arg;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!/^(standard|environment\.(route|dawn)|destruction\.(single|nuke|bfg)|enemies\.(low|medium|high)|hazards\.void-fire|weapon\.(glock|p90|plasma|mini-rockets|shotgun|asmd|bite|rocket|tesla|flame|hydra)|utility\.(he|molotov|smoke|time-bubble)|construction\.defense|ultimate\.armageddon|combat\.(day|night|day-night)|recovery\.idle)$/.test(value.caseId)) throw new Error(`Unknown case: ${value.caseId}`);
  if (value.durationMs && (['standard', 'combat.day-night'].includes(value.caseId) || value.durationMs + 60_000 > value.timeoutMs)) throw new Error('Duration requires an individual case and at least 60 seconds of timeout headroom');
  // Long combined captures use the stable low-overhead profile; focused traces retain JS sampling.
  value.captureProfile ??= value.caseId === 'standard' ? 'reduced' : 'standard';
  return value;
}

