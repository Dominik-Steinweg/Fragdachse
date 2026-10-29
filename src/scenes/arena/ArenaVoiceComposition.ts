import { bridge } from '../../network/bridge';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import { VoiceRuntime } from '../../voice/VoiceRuntime';
import { readVoicePreferences, voiceLibrary } from '../../voice/VoiceLibrary';

/** Voice packs are optional content: the library loads them after the boot reveal (`voiceLibrary.load`). */
export function composeArenaVoice(audio: GameAudioSystem): VoiceRuntime {
  bridge.setLocalVoiceChecksum(readVoicePreferences().checksum);
  const runtime = new VoiceRuntime({
    now: () => bridge.getSynchronizedNow(),
    isHost: () => bridge.isHost(),
    scope: () => ({ worldRevision: bridge.getWorldDescriptor()?.worldRevision ?? 0,
      roundRevision: bridge.getRoundParticipation()?.roundRevision ?? 0 }),
    active: () => bridge.isArenaStarted() && bridge.getRoundState()?.status === 'active',
    lobby: () => bridge.getGamePhase() === 'LOBBY',
    mode: () => bridge.getGameMode(),
    players: () => bridge.getConnectedPlayers().map(player => ({
      id: player.id, checksum: player.voiceChecksum ?? null,
      ready: bridge.getPlayerWorldLoadReady(player.id, bridge.getWorldDescriptor()?.worldRevision ?? 0),
      participant: bridge.getWorldParticipation(player.id) === 'interactive' && bridge.getRoundRole(player.id) === 'participant',
      score: bridge.getPlayerFrags(player.id), build: bridge.getPlayerCommittedLoadout(player.id),
    })),
    send: event => bridge.broadcastVoice(event),
  }, voiceLibrary, audio.getVoiceAudioChannel());
  bridge.registerVoiceHandler(event => runtime.receive(event));
  return runtime;
}
