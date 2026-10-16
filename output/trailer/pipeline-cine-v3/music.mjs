// Generates the music bed variants and trailer accents with Stable Audio 3 (ComfyUI on :8188).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8188';
const DIR = 'C:/Fragdachse/output/trailer/pipeline-cine-v3/music';
const WF = 'C:/Fragdachse/tools/audio-studio/workflows/';
mkdirSync(DIR, { recursive: true });

const NEG_MUSIC = 'vocals, singing, speech, lyrics, cheerful, happy, pop, acoustic guitar, lo-fi, low quality, distorted mix, clipping';
const NEG_SFX = 'music, melody, vocals, speech, low quality, clipping';
const jobs = [
  ...[11, 23, 37, 41].map(seed => ({ name: `bed-${seed}`, model: 'medium', seconds: 32, seed, negative: NEG_MUSIC,
    text: 'Epic dark cinematic monster trailer music, 120 BPM, D minor. Opens with an ominous deep sub drone and a slow '
      + 'heartbeat pulse for six seconds, then a massive braam and huge taiko drums kick in: driving aggressive hybrid '
      + 'orchestral action, pounding low brass, fast staccato string ostinato, distorted synth bass, metallic hits, '
      + 'rising intensity, a short breath around twenty-four seconds, then a final enormous orchestral impact with a long '
      + 'reverb tail. Polished Hollywood trailer production, wide stereo, no vocals.' })),
  // V2 beds: punchier hybrid action with clear downbeats; cut in 8 s phrases (120 BPM = 4 bars).
  ...[3, 52, 64, 77, 88, 95].map(seed => ({ name: `beat-${seed}`, model: 'medium', seconds: 32, seed, negative: NEG_MUSIC,
    text: 'Aggressive epic hybrid trailer action music, 120 BPM, D minor, four-on-the-floor huge taiko and cinematic '
      + 'drum kit, heavy distorted synth bass pulse on every eighth note, pounding low brass stabs on the downbeats, '
      + 'fast staccato strings, metallic percussion hits, tension risers every eight bars, relentless driving energy '
      + 'from the first second, punchy transients, loud and dynamic, polished modern game trailer production, no vocals.' })),
  // V3.2 beds: hard-hitting, drum-led trailer action with very clear beats for beat-locked cuts.
  ...[301, 317, 331, 347].map(seed => ({ name: `punch-${seed}`, model: 'medium', seconds: 48, seed, negative: NEG_MUSIC + ', ambient, soft, quiet intro, slow build',
    text: 'Hard-hitting epic hybrid trailer action music at exactly 120 BPM in D minor. Massive punchy kick drum on every beat, '
      + 'huge cracking snare on beats two and four, thunderous taiko and tom fills every bar, heavy distorted sub bass pulsing '
      + 'in eighth notes, aggressive low brass stabs, metallic hits, full energy from the very first second, tight and rhythmic, '
      + 'extremely loud punchy transients, modern AAA game trailer, wide stereo, no vocals.' })),
  ...[353, 367].map(seed => ({ name: `punch-${seed}`, model: 'medium', seconds: 48, seed, negative: NEG_MUSIC + ', ambient, soft, quiet intro, slow build',
    text: 'Aggressive cinematic trailerstep at 120 BPM: booming four-on-the-floor kick, hard clap snare backbeat, massive '
      + 'distorted reese bass, epic orchestral brass and choir-free staccato strings, huge braam impacts on every downbeat '
      + 'of each four-bar phrase, relentless driving groove, very punchy and loud, modern game trailer production, no vocals.' })),
  // V3 beds: 40 s of relentless hybrid action at 120 BPM for the fast-cut feature run.
  ...[105, 117, 129, 131].map(seed => ({ name: `drive-${seed}`, model: 'medium', seconds: 40, seed, negative: NEG_MUSIC,
    text: 'Relentless epic hybrid trailer action music, 120 BPM, D minor, huge taiko and cinematic drum kit hits on every '
      + 'beat, aggressive distorted synth bass ostinato on sixteenth notes, massive low brass stabs, fast staccato strings, '
      + 'braams and metallic impacts, constant forward momentum, rising intensity every eight bars, very loud punchy '
      + 'transients, modern AAA game trailer production, wide stereo, no vocals.' })),
  // Dawn teaser: eerie night, ticking clock, the sun will not come.
  ...[201, 213].map(seed => ({ name: `dawn-${seed}`, model: 'medium', seconds: 14, seed, negative: NEG_MUSIC,
    text: 'Eerie dark cinematic night ambience, slow ticking clock, deep sub pulses, distant howls, dissonant high strings '
      + 'tremolo, a lonely detuned music box melody, ominous horror trailer tension building slowly, no drums, no vocals.' })),
  { name: 'tick', model: 'sfx', seconds: 5, seed: 47, negative: NEG_SFX,
    text: 'Heavy old clock ticking loudly, slow mechanical tick tock in a dark empty hall with reverb' },
  { name: 'portal', model: 'sfx', seconds: 5, seed: 53, negative: NEG_SFX,
    text: 'Sci-fi portal opening, energetic electric swirl and whoosh with a resonant hum' },
  { name: 'flyby', model: 'sfx', seconds: 5, seed: 59, negative: NEG_SFX,
    text: 'Squadron of jet drones flying low overhead, fast powerful whoosh doppler flyby' },
  { name: 'hit-low', model: 'sfx', seconds: 5, seed: 61, negative: NEG_SFX,
    text: 'Massive cinematic trailer boom, deep distorted sub impact with long dark rumble tail' },
  { name: 'stinger', model: 'sfx', seconds: 5, seed: 67, negative: NEG_SFX,
    text: 'Short aggressive cinematic hit with metallic scrape and reverse swell into a punch, trailer transition' },
  { name: 'shield', model: 'sfx', seconds: 5, seed: 31, negative: NEG_SFX,
    text: 'Bullets ricocheting off a glowing energy shield, rapid electric zaps and crackling force field impacts' },
  { name: 'charge', model: 'sfx', seconds: 5, seed: 37, negative: NEG_SFX,
    text: 'Heavy armored beast charging at full speed, thundering footsteps and a violent rushing whoosh ending in a crash' },
  { name: 'reverse', model: 'sfx', seconds: 5, seed: 41, negative: NEG_SFX,
    text: 'Reverse cymbal swell and reversed boom rising into a sudden cut, cinematic trailer transition' },
  { name: 'subdrop', model: 'sfx', seconds: 5, seed: 43, negative: NEG_SFX,
    text: 'Deep cinematic sub drop, massive low frequency boom with dark tail, trailer hit' },
  { name: 'braam', model: 'sfx', seconds: 5, seed: 5, negative: NEG_SFX,
    text: 'Huge cinematic trailer braam, massive low brass blast with sub bass boom and long dark reverb tail' },
  { name: 'impact', model: 'sfx', seconds: 5, seed: 7, negative: NEG_SFX,
    text: 'Deep cinematic trailer impact hit, heavy sub drop boom with metallic crash and short reverb' },
  { name: 'riser', model: 'sfx', seconds: 5, seed: 9, negative: NEG_SFX,
    text: 'Tense cinematic riser, rising reversed cymbal and string swell building to a sharp stop' },
  { name: 'whoosh', model: 'sfx', seconds: 5, seed: 13, negative: NEG_SFX,
    text: 'Fast deep cinematic whoosh swipe transition' },
  { name: 'drone', model: 'sfx', seconds: 10, seed: 17, negative: NEG_SFX,
    text: 'Dark underwater ambience, deep ominous drone, muffled bubbles rising, distant creature groan' },
  { name: 'roar', model: 'sfx', seconds: 5, seed: 19, negative: NEG_SFX,
    text: 'Enormous deep sea monster roar, wet guttural bellow with gurgling water and deep growl, cinematic' },
  { name: 'eruption', model: 'sfx', seconds: 5, seed: 23, negative: NEG_SFX,
    text: 'Massive water eruption, huge splash of a giant creature bursting out of a lake, heavy water spray falling back' },
  { name: 'slam', model: 'sfx', seconds: 5, seed: 29, negative: NEG_SFX,
    text: 'Giant wet tentacle slamming onto muddy ground, heavy thud with splatter and debris' },
];

for (let i = 0; i < 120; i++) { try { await fetch(BASE + '/system_stats'); break; } catch { await new Promise(r => setTimeout(r, 2000)); } }
const only = process.argv.slice(2);
for (const job of jobs) {
  if (only.length && !only.includes(job.name)) continue;
  const out = `${DIR}/${job.name}.flac`;
  if (existsSync(out) && !only.length) continue;
  const wf = JSON.parse(readFileSync(WF + `stable-audio-3-${job.model === 'sfx' ? 'small-sfx' : 'medium'}.api.json`, 'utf8'));
  wf['3'].inputs.text = job.text; wf['4'].inputs.text = job.negative;
  wf['5'].inputs.seconds_total = job.seconds; wf['6'].inputs.seconds = job.seconds; wf['7'].inputs.seed = job.seed;
  wf['9'].inputs.filename_prefix = `audio/${job.name}`;
  const res = await (await fetch(BASE + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'cine-trailer' }) })).json();
  if (!res.prompt_id) throw Error(job.name + ' ' + JSON.stringify(res));
  for (;;) {
    await new Promise(r => setTimeout(r, 2000));
    const entry = (await (await fetch(BASE + '/history/' + res.prompt_id)).json())[res.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') throw Error(job.name + ' ' + JSON.stringify(entry.status).slice(0, 600));
    const audio = Object.values(entry.outputs ?? {}).flatMap(o => o.audio ?? [])[0];
    if (!audio) continue;
    const bytes = Buffer.from(await (await fetch(`${BASE}/view?filename=${encodeURIComponent(audio.filename)}&subfolder=${encodeURIComponent(audio.subfolder)}&type=${audio.type}`)).arrayBuffer());
    writeFileSync(out, bytes); console.log('done', job.name, bytes.length); break;
  }
}
