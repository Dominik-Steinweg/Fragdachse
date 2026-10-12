import { bridge } from '../../network/bridge';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { isLocalScenarioBotPeer } from '../../network/peer/LocalScenarioSession';
import type { CoopDefenseKrakenSystem } from '../../systems/CoopDefenseKrakenSystem';

// Bound by the Activity composition and revoked on detach, never a World/Scene owner.
let active: CoopDefenseKrakenSystem | null = null;
export function krakenDevAuthorized(): boolean {
  return isDevScenarioMode() && bridge.isHost() && bridge.getConnectedPlayers()
    .every(p => p.id === bridge.getLocalPlayerId() || isLocalScenarioBotPeer(p.id));
}
export function bindKrakenDevHost(system: CoopDefenseKrakenSystem): () => void {
  if (!krakenDevAuthorized()) return () => {};
  active = system;
  return () => { if (active === system) active = null; };
}
export function requireKrakenDevHost(): CoopDefenseKrakenSystem {
  if (!krakenDevAuthorized()) throw Error('Isolated dev host required');
  if (!active) throw Error('Active Kraken diagnosis mission required');
  return active;
}
export function readKrakenDevAction() { return active?.getDevAction() ?? null; }
export function readKrakenDevGeometry() { return active?.inspectDevGeometry() ?? null; }
