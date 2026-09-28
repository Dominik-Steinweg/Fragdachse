// node comfy.mjs <name> <seconds> <seed> "<prompt>" ["<negative>"]
import { readFileSync, writeFileSync } from 'node:fs';
const [name, seconds, seed, prompt, negative = 'vocals, singing, speech, drums, electronic, distortion, low quality'] = process.argv.slice(2);
const wf = JSON.parse(readFileSync('C:/Fragdachse/tools/audio-studio/workflows/stable-audio-3-medium.api.json', 'utf8'));
wf['3'].inputs.text = prompt; wf['4'].inputs.text = negative;
wf['5'].inputs.seconds_total = Number(seconds); wf['6'].inputs.seconds = Number(seconds);
wf['7'].inputs.seed = Number(seed);
wf['9'].inputs.filename_prefix = `audio/trailer2_${name}`;
const base = 'http://127.0.0.1:8188';
const r = await fetch(base + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'trailer2' }) });
const { prompt_id, error, node_errors } = await r.json();
if (!prompt_id) { console.log('error', JSON.stringify(error), JSON.stringify(node_errors)); process.exit(1); }
const t0 = Date.now();
for (;;) {
  await new Promise(res => setTimeout(res, 2000));
  const h = await (await fetch(`${base}/history/${prompt_id}`)).json();
  const entry = h[prompt_id];
  if (!entry) continue;
  if (entry.status?.status_str === 'error') { console.log('failed', JSON.stringify(entry.status).slice(0, 600)); process.exit(1); }
  const out = Object.values(entry.outputs ?? {}).flatMap(o => o.audio ?? []);
  if (out.length) {
    const a = out[0];
    const buf = Buffer.from(await (await fetch(`${base}/view?filename=${encodeURIComponent(a.filename)}&subfolder=${encodeURIComponent(a.subfolder)}&type=${a.type}`)).arrayBuffer());
    writeFileSync(`music/${name}.flac`, buf);
    console.log(name, 'done in', ((Date.now() - t0) / 1000).toFixed(0), 's', buf.length, 'bytes');
    break;
  }
}
