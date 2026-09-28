import type * as Phaser from 'phaser';
import { bridge } from '../../network/bridge';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { ArenaDiagnosticsController } from '../../scenes/arena/ArenaDiagnosticsController';
import type { WeaponSlot } from '../../types';
import type { LinkDiagnostics } from '../../network/peer/TransportDiagnostics';
import type { PerformanceCase, PerformanceWindow } from './contracts';
import { buildPerformanceLoadout, presets } from './loadouts';
import { createPerformanceLabGamePort } from './gamePort';
import { registerReferenceMap, PERFORMANCE_MAP_ID, REFERENCE_SEED } from './referenceMap';

// One fixed experiment. Only graphics quality changes between comparison runs.
export const PROBE_PHASES = [
  { id: 'warmup', seconds: 5 }, { id: 'idle', seconds: 10 }, { id: 'p90', seconds: 20 },
  { id: 'p90-bubble', seconds: 30 }, { id: 'recovery', seconds: 10 },
] as const;
export function probePhase(elapsedMs: number): string | null {
  let end = 0;
  for (const phase of PROBE_PHASES) { end += phase.seconds * 1000; if (elapsedMs < end) return phase.id; }
  return null;
}
let unregister: (() => void) | undefined;
export function prepareNetworkProbe(): void {
  const quality = new URLSearchParams(location.search).get('network-probe');
  if (!['high', 'low'].includes(quality ?? '')) throw new Error('network-probe must be high or low');
  unregister ??= registerReferenceMap();
}
interface ProbeSample {
  atMs: number; phase: string; shots: number; bubbles: number; hits: number;
  projectiles: number; prismShots: number; timeBubbles: number; links: LinkDiagnostics[];
}
declare global {
  interface Window {
    __FD_PROBE__?: { state: string; error?: string; result?: unknown };
  }
}

export function attachNetworkProbe(scene: Phaser.Scene, flow: ArenaRuntime, players: PlayerManager,
  diagnostics: ArenaDiagnosticsController, input: (angle: number, slot: WeaponSlot | null) => void,
  lobbyReady: () => boolean, setQuality: (level: 'high' | 'low') => void): () => void {
  const quality = new URLSearchParams(location.search).get('network-probe') as 'high' | 'low';
  const host = bridge.isHost(), localId = bridge.getLocalPlayerId();
  const build = buildPerformanceLoadout('P90', false, 'TIME_BUBBLE');
  const slot = presets.P90.slot as WeaponSlot;
  const test: PerformanceCase = { id: 'network.p90-bubble', version: 1, kind: 'utility',
    itemId: 'TIME_BUBBLE', slot, commit: build.commit, durationMs: 75_000, tailMs: 0,
    minimumActions: 0, actionIntervalMs: build.effective[slot].cooldown, enemyCount: 0, targetDistance: 220 };
  const port = createPerformanceLabGamePort(scene, flow, players, diagnostics, input, lobbyReady, 2);
  setQuality(quality);
  // Mode/map changes invalidate Ready commits; select them before the client gets ready.
  if (host) { bridge.setGameMode('coop_defense'); bridge.setCoopDefenseMapId(PERFORMANCE_MAP_ID); }
  const api = window.__FD_PROBE__ = { state: 'lobby' } as NonNullable<Window['__FD_PROBE__']>;
  const samples: ProbeSample[] = [], updates: number[] = [], windows: PerformanceWindow[] = [];
  let started = false, prepared = false, done = false, recording = false, requestedAt = 0;
  let startAt = 0, roundStart = 0, nextSample = 0, nextShot = 0, sequence = 0, shots = 0, bubbles = 0, hits = 0;
  let removeHits: (() => void) | undefined;
  let lastState: ReturnType<typeof bridge.getLatestGameState>;
  const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:100000;padding:12px;background:#101821;color:white;font:14px sans-serif;max-width:410px;border:1px solid #8ba0b5';
  const title = document.createElement('strong'); title.textContent = `Netzwerk-Test · ${host ? 'Host' : 'Client'} · ${quality}`;
  const status = document.createElement('p');
  const link = document.createElement('a');
  link.href = `${location.origin}${location.pathname}?network-probe=${quality}#r=${bridge.getRoomCode()}`;
  link.textContent = 'Client in zweitem Fenster öffnen'; link.target = '_blank'; link.style.color = '#8ecbff';
  link.hidden = !host;
  link.onclick = event => { event.preventDefault(); window.open(link.href, '_blank', 'popup,width=1280,height=720'); };
  const ready = document.createElement('button'); ready.textContent = host ? 'Messung starten' : 'Client bereit'; ready.disabled = true;
  const download = document.createElement('button'); download.textContent = 'Ergebnis herunterladen'; download.disabled = true;
  panel.append(title, status, link, document.createElement('br'), ready, download); document.body.append(panel);
  const show = (text: string) => { status.textContent = text; };
  const count = (key: 'shots' | 'hits') => {
    const window = windows.find(w => w.id === probePhase(performance.now() - startAt));
    if (window) { window.load ??= {}; window.load[key] = Number(window.load[key] ?? 0) + 1; }
  };
  show(host ? 'Zuerst den Client öffnen und dort „Client bereit“ anklicken.' : 'Bereit klicken; anschließend startet der Host den gemeinsamen Durchlauf.');
  const stop = (reason?: string) => {
    if (done) return;
    done = true; input(0, null); removeHits?.();
    if (host && prepared && bridge.getArenaStartTime() === roundStart) {
      flow.rpcPorts.heldAction.clearPlayer(localId); flow.navigationLabPort.removeEnemies();
    }
    const game = recording ? diagnostics.stopScenarioRecording() : null; recording = false;
    api.state = reason ? 'failed' : 'complete'; api.error = reason;
    api.result = { schemaVersion: 1, experiment: 'p90-bubble-1', role: host ? 'host' : 'client',
      room: bridge.getRoomCode(), roundStart, quality, viewport,
      buildSignature: build.buildSignature, cooldownMs: test.actionIntervalMs,
      userAgent: navigator.userAgent, createdAt: new Date().toISOString(), error: reason ?? null,
      windows, samples, updates, game };
    ready.disabled = true; download.disabled = false;
    show(reason ? `Abgebrochen: ${reason}` : 'Fertig. Datei herunterladen; für den nächsten Vergleich beide Fenster neu laden.');
  };
  ready.onclick = () => {
    try {
      if (!lobbyReady() || bridge.getConnectedPlayers().length !== 2) throw new Error('Genau ein Host und ein Client müssen in der Lobby sein.');
      Object.assign(viewport, { width: innerWidth, height: innerHeight, dpr: devicePixelRatio });
      if (host) port.start(PERFORMANCE_MAP_ID, REFERENCE_SEED, build.commit);
      else { bridge.setLocalReadyWithCommittedLoadout(build.commit); flow.setIsLocalReady(true); }
      started = true; requestedAt = performance.now(); ready.disabled = true; api.state = 'waiting'; show('Warte auf den gemeinsamen Arenastart …');
    } catch (error) { show(String(error)); }
  };
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(api.result)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `network-${host ? 'host' : 'client'}-${quality}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tick = () => {
    if (done) return;
    if (!started) {
      const peers = bridge.getConnectedPlayers();
      ready.disabled = !lobbyReady() || peers.length !== 2
        || (host && peers.some(p => p.id !== localId && !bridge.getPlayerReady(p.id)));
      return;
    }
    try {
      if (bridge.getConnectedPlayers().length !== 2 || bridge.isHost() !== host) throw new Error('Teilnehmer oder Host geändert');
      if (prepared && (bridge.getGamePhase() !== 'ARENA' || bridge.getArenaStartTime() !== roundStart)) throw new Error('Test-Runde wurde verlassen');
      if (document.hidden || innerWidth !== viewport.width || innerHeight !== viewport.height || devicePixelRatio !== viewport.dpr) throw new Error('Fenster verborgen oder Auflösung geändert');
      if (!prepared) {
        if (performance.now() - requestedAt > 180_000) throw new Error('Arenastart dauert länger als drei Minuten');
        if (!bridge.isArenaStarted() || bridge.isArenaCountdownActive() || !players.getPlayer(localId)) return;
        if (host && (!port.isReady() || port.prepareCase?.(test) === false)) return;
        // Use the existing authoritative round clock, not wall clocks from different PCs.
        roundStart = bridge.getArenaStartTime();
        const elapsed = bridge.getSynchronizedNow() - roundStart;
        if (elapsed > 4000) throw new Error('Messbereitschaft nach Warmup-Frist; beide Fenster neu laden');
        startAt = performance.now() - elapsed;
        let fromMs = startAt;
        for (const phase of PROBE_PHASES) {
          windows.push({ id: phase.id, kind: phase.id === 'warmup' ? 'preparation' : phase.id === 'recovery' ? 'recovery' : 'measurement',
            fromMs, toMs: fromMs + phase.seconds * 1000 });
          fromMs += phase.seconds * 1000;
        }
        if (host) {
          removeHits = port.observeHits(() => { hits++; count('hits'); });
          // Keep both cameras near the same fixture; only the host produces weapon load.
          const p = players.getPlayer(localId)!;
          for (const other of players.getAllPlayers()) if (other.id !== localId) other.setPosition(p.x, p.y + 64);
        }
        diagnostics.startScenarioRecording({ probe: 'p90-bubble-1', role: host ? 'host' : 'client', quality },
          { maxFrames: 50_000, maxDurationMs: 120_000 });
        recording = true; prepared = true;
      }
      const now = performance.now(), phase = probePhase(now - startAt);
      if (!phase) { stop(); return; }
      api.state = phase;
      if (host) {
        port.maintainTargets();
        if ((phase === 'p90' || phase === 'p90-bubble') && now >= nextShot) {
          const result = port.attack(slot, ++sequence, true);
          if (result?.ok) { shots++; count('shots'); nextShot = now + test.actionIntervalMs; }
          else if (result?.reason !== 'cooldown') throw new Error(`P90: ${result?.reason}`);
        }
        const bubble = bridge.getPlayerTimeBubbleUtilityState(localId);
        if (phase === 'p90-bubble' && (!bubble || bubble.phase === 'cooldown')
          && bridge.getPlayerUtilityCooldownUntil(localId, 'TIME_BUBBLE') <= bridge.getSynchronizedNow()) {
          const result = port.performAction?.(test, ++sequence, true);
          if (result?.ok) bubbles++;
          else if (result?.reason && result.reason !== 'cooldown') throw new Error(`TimeBubble: ${result.reason}`);
        }
      }
      const state = bridge.getLatestGameState();
      if (!host && state && state !== lastState) { updates.push(now); lastState = state; }
      if (now >= nextSample) {
        nextSample = now + 1000;
        const links = bridge.getTransportDiagnostics();
        if (links.length !== 1 || links.some(l => l.disconnectCount > 0)) throw new Error('Verbindung fehlt oder wurde unterbrochen');
        const special = flow.getWorldProjectileRuntime()?.getDebugSpecialProjectileCounts();
        samples.push({ atMs: now, phase, shots, bubbles, hits, links,
          projectiles: flow.getWorldProjectileRuntime()?.getDebugActiveProjectileCount() ?? 0,
          prismShots: special?.prismShots ?? 0, timeBubbles: flow.getScenarioObservation().timeBubbles });
        show(`${phase} · ${Math.floor((now - startAt) / 1000)} / 75 s · ${host ? `${shots} Schüsse` : `${updates.length} Updates`}`);
      }
    } catch (error) { stop(error instanceof Error ? error.message : String(error)); }
  };
  scene.events.on('postupdate', tick);
  return () => {
    stop('Scene beendet'); scene.events.off('postupdate', tick); panel.remove();
    if (host && bridge.getArenaStartTime() === roundStart) port.discard();
    unregister?.(); unregister = undefined;
  };
}
