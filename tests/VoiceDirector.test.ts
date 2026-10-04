import { describe, expect, it } from 'vitest';
import { DamageBurstObserver, VoiceDirector } from '../src/voice/VoiceDirector';
import { VoiceRuntime, VOICE_ULTIMATES, type VoicePlayer } from '../src/voice/VoiceRuntime';
import { VOICE_EVENTS, type VoicePackage } from '../src/voice/VoicePackage';
import type { VoiceLibrary } from '../src/voice/VoiceLibrary';
import ultimates from '../src/loadout/content/data/ultimates.json';

function pack(id = 'voice'): VoicePackage {
  return { checksum: id, files: {}, manifest: { schema: 1, catalogVersion: 1, packageId: id, version: 1, voiceId: id, name: id, language: 'de', missingEvents: [],
    clips: VOICE_EVENTS.flatMap(event => [1, 2, 3].map(n => ({ id: `${event}${n}`, sentenceId: `${event}${n}`, event, duration: 2, codec: 'vorbis' as const, bytes: 1, sha256: '', file: '' }))) } };
}
describe('shared host voice selection', () => {
  it('picks one priority winner, expires missed events and reserves victory once', () => {
    const director = new VoiceDirector(); const packages = new Map([['a', pack()], ['b', pack('b')]]);
    director.reset({ worldRevision: 1, roundRevision: 2 });
    director.offer('a', 'kill', 1000); director.offer('b', 'leader', 1000);
    expect(director.select(1200, packages)).toMatchObject({ event: 'leader', speakerId: 'b', worldRevision: 1, roundRevision: 2 });
    director.offer('a', 'kill', 2000);
    expect(director.select(3200, packages)).toBeNull();
    expect(director.select(12000, packages)).toBeNull();
    director.offer('a', 'victory', 13000); director.offer('b', 'victory', 13000);
    expect(director.select(13200, packages)).toMatchObject({ event: 'victory', speakerId: 'a' });
    director.offer('b', 'victory', 25000); expect(director.select(25200, packages)).toBeNull();
  });
  it('excludes the last two sentences and never substitutes a missing voice', () => {
    const director = new VoiceDirector(); const packages = new Map([['a', pack()]]); const clips = [];
    for (const now of [1000, 12000, 23000, 34000]) { director.offer('a', 'kill', now); clips.push(director.select(now + 200, packages)?.clipId); }
    expect(new Set(clips.slice(0, 3)).size).toBe(3); expect(clips[3]).toBe(clips[0]);
    director.offer('missing', 'victory', 45000); expect(director.select(45200, packages)).toBeNull();
  });
  it('waits for the current clip before the victory exception and drops old scopes', () => {
    const director = new VoiceDirector(); const packages = new Map([['a', pack()]]);
    director.offer('a', 'kill', 1000); director.select(1200, packages);
    director.offer('a', 'victory', 1300);
    expect(director.select(1500, packages)).toMatchObject({ event: 'victory', playAt: 3700 });
    expect(director.select(3700, packages)).toBeNull();
    director.offer('a', 'ready', 5000); director.reset({ worldRevision: 2, roundRevision: 3 });
    expect(director.select(6000, packages)).toBeNull();
  });
});
describe('relative effective damage', () => {
  function warm(observer: DamageBurstObserver, scale: number) {
    for (let n = 0; n < 5; n++) { expect(observer.observe(n * 2200, 100 * scale, 'build')).toBe(false); observer.tick(n * 2200 + 2100); }
  }
  it('needs prior active windows, scales with output and does not use the candidate as baseline', () => {
    for (const scale of [1, 100]) {
      const observer = new DamageBurstObserver(); warm(observer, scale);
      expect(observer.observe(11200, 300 * scale, 'build')).toBe(true);
      expect(observer.observe(11201, 1000 * scale, 'build')).toBe(false);
      expect(observer.observe(35000, 10000 * scale, 'new-loadout')).toBe(false);
    }
  });
  it('does not add idle zeroes and requires both recovery and cooldown', () => {
    const observer = new DamageBurstObserver(); warm(observer, 1);
    for (let time = 12000; time < 60000; time += 2000) observer.tick(time);
    expect(observer.observe(60000, 120, 'build')).toBe(false);
    expect(observer.observe(60010, 200, 'build')).toBe(true);
    observer.tick(65000); observer.tick(68000);
    expect(observer.observe(69000, 1000, 'build')).toBe(false);
    observer.tick(72000); observer.tick(75000);
    expect(observer.observe(83000, 1000, 'build')).toBe(true);
  });
});
describe('voice runtime authority and lifetime', () => {
  function fixture() {
    let now = 1000; let active = false; let worldRevision = 1; let mode = 'deathmatch'; let host = true;
    const build = {};
    const players: VoicePlayer[] = [{ id: 'a', checksum: 'voice', score: 0, participant: true, ready: true, build }, { id: 'b', checksum: 'other', score: 0, participant: true, ready: false, build }];
    const sent: any[] = []; const packages = new Map([['voice', pack()], ['other', pack('other')]]);
    const runtime = new VoiceRuntime({ now: () => now, isHost: () => host, scope: () => ({ worldRevision, roundRevision: active ? 2 : 0 }), active: () => active,
      lobby: () => !active, players: () => players, mode: () => mode, send: event => sent.push(event) }, { packages, revision: 0 } as VoiceLibrary, null);
    return { runtime, players, sent, tick: (time: number) => { now = time; runtime.update(); }, arena: () => { active = true; }, world: () => { worldRevision++; }, mode: (m: string) => { mode = m; }, client: () => { host = false; } };
  }
  it('greets once per room, not after menu/reconnect or a late match join', () => {
    const f = fixture(); f.tick(1000); f.tick(1200); expect(f.sent).toHaveLength(1);
    f.players[0].ready = false; f.tick(15000); f.players[0].ready = true; f.tick(16000); f.tick(16200); expect(f.sent).toHaveLength(1);
    f.arena(); f.tick(20000); f.players[1].ready = true; f.tick(21000); f.tick(21200); expect(f.sent).toHaveLength(1);
  });
  it('keeps exact round assignments, ignores PvE kills and unlisted actions', () => {
    const f = fixture(); f.arena(); f.tick(1000); f.players[0].checksum = 'other';
    f.runtime.kill('a'); f.tick(1200); expect(f.sent[0]).toMatchObject({ speakerId: 'a', checksum: 'voice' });
    f.mode('coop_defense'); f.runtime.kill('b'); f.runtime.ultimate('b', 'RIGHT_CLICK'); f.tick(12000); expect(f.sent).toHaveLength(1);
    f.client(); f.runtime.ultimate('b', [...VOICE_ULTIMATES][0]); f.tick(23000); expect(f.sent).toHaveLength(1);
  });
  it('debounces a changed unique PvP leader and favors it over the concurrent kill', () => {
    const f = fixture(); f.arena(); f.players[0].score = 1; f.tick(1000);
    f.players[1].score = 2; f.tick(2000); f.runtime.kill('b'); f.tick(2200); expect(f.sent).toHaveLength(0);
    f.tick(4010); expect(f.sent[0]).toMatchObject({ event: 'leader', speakerId: 'b' });
  });
  it('only marks existing authored Ultimates as voice-relevant', () => { for (const id of VOICE_ULTIMATES) expect(ultimates.ultimates).toHaveProperty(id); });
});
