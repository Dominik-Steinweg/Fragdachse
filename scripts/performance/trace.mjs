import { createReadStream } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { compose } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { resolve, basename, dirname, sep } from 'node:path';
import { parserStream } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';

const isMetaFrame = name => ['(root)', '(idle)', '(program)', '(garbage collector)'].includes(name);

export async function archiveDependencySources(buildDirectory) {
  const root = resolve(buildDirectory, 'source/dependencies');
  const assets = resolve(buildDirectory, 'site/assets');
  const written = new Set();
  for (const file of (await readdir(assets)).filter(name => name.endsWith('.map'))) {
    const map = JSON.parse(await readFile(resolve(assets, file), 'utf8'));
    for (let i = 0; i < map.sources.length; i++) {
      const dependency = map.sources[i].replaceAll('\\', '/').match(/(?:^|\/)(node_modules\/.*)$/)?.[1];
      const content = map.sourcesContent?.[i];
      if (!dependency || typeof content !== 'string' || written.has(dependency)) continue;
      const target = resolve(root, dependency);
      if (!target.startsWith(root + sep)) throw new Error('Dependency source path escapes archive');
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
      written.add(dependency);
    }
  }
}

export async function* traceEvents(path, signal) {
  const stages = [createReadStream(path, { signal })];
  if (path.endsWith('.gz')) stages.push(createGunzip());
  stages.push(parserStream(), pick.asStream({ filter: 'traceEvents' }), streamArray.asStream());
  const stream = compose(...stages);
  for await (const entry of stream) yield entry.value;
}

export async function createSourceResolver(buildDirectory) {
  const maps = new Map(), cache = new Map();
  return async callFrame => {
    const key = JSON.stringify(callFrame);
    if (cache.has(key)) return cache.get(key);
    const result = { name: callFrame.functionName || '(anonymous)', url: callFrame.url || '',
      line: (callFrame.lineNumber ?? -1) + 1, column: (callFrame.columnNumber ?? -1) + 1, mapped: false };
    if (callFrame.url && callFrame.lineNumber >= 0 && callFrame.columnNumber >= 0) {
      const file = basename(new URL(callFrame.url, 'http://local/').pathname);
      if (!maps.has(file)) {
        try { maps.set(file, new TraceMap(JSON.parse(await readFile(resolve(buildDirectory, 'site/assets', `${file}.map`), 'utf8')))); }
        catch { maps.set(file, null); }
      }
      const map = maps.get(file);
      if (map) {
        const original = originalPositionFor(map, { line: result.line, column: result.column - 1 });
        if (original.source && original.line != null) {
          const source = original.source.replaceAll('\\', '/');
          const src = source.match(/(?:^|\/)src\/(.*)$/);
          const dependency = source.match(/(?:^|\/)(node_modules\/.*)$/)?.[1];
          Object.assign(result, { name: original.name || result.name, source, line: original.line,
            column: original.column + 1, mapped: true,
            snapshot: dependency ? `source/dependencies/${dependency}` : src ? `source/src/${src[1]}` : null });
        }
      }
    }
    cache.set(key, result);
    return result;
  };
}

/** Narrow parser for the versioned capture profile; no inference of causes. */
export async function analyzeTrace(events, result, windows, resolveSource = async f => f, signal) {
  const profiles = new Map(), threadNames = new Map(), gc = [], markerTimes = new Map();
  let samples = 0, reorderedDeltas = 0, gameThread = null;
  for await (const e of events) {
    signal?.throwIfAborted();
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? 'unknown');
    if (e.name?.startsWith(`FD:lab:${result.request.runId}:`) && Number.isFinite(e.ts)) markerTimes.set(e.name, e.ts / 1000);
    if (e.name === `FD:lab:${result.request.runId}:boot-start`) gameThread = { pid: e.pid, tid: e.tid };
    if (e.name === 'Profile' || e.name === 'ProfileChunk') {
      const key = `${e.pid}:${e.id ?? JSON.stringify(e.id2)}`;
      let p = profiles.get(key);
      if (!p) { p = { pid: e.pid, tid: e.tid, start: null, nodes: new Map(), chunks: [] }; profiles.set(key, p); }
      const data = e.args?.data ?? {};
      if (e.name === 'Profile') { p.start = data.startTime; p.tid = e.tid; }
      for (const node of data.cpuProfile?.nodes ?? []) p.nodes.set(node.id, node);
      if (data.cpuProfile?.samples?.length) {
        samples += data.cpuProfile.samples.length;
        if (samples > 5_000_000) throw new Error('CPU sample limit exceeded; recording is not silently truncated');
        p.chunks.push({ ts: e.ts, ids: data.cpuProfile.samples, deltas: data.timeDeltas ?? [] });
      }
    }
    // Top-level GC spans only. Nested V8 sweeping tasks are not separate collections.
    if (/^(MajorGC|MinorGC)$/.test(e.name ?? '') && e.ph === 'X' && e.dur >= 0) {
      if (gc.length >= 100_000) throw new Error('GC event capacity exceeded');
      gc.push({ name: e.name, pid: e.pid, tid: e.tid, from: e.ts / 1000, to: (e.ts + e.dur) / 1000 });
    }
  }
  const anchor = result.markers.find(m => m.name === 'boot-start');
  const anchorTrace = markerTimes.get(`FD:lab:${result.request.runId}:boot-start`);
  const end = result.markers.find(m => m.name === 'run-end');
  const endTrace = markerTimes.get(`FD:lab:${result.request.runId}:run-end`);
  if (!anchor || anchorTrace === undefined || !end || endTrace === undefined) throw new Error('Missing Chrome/run synchronization markers');
  const offset = anchorTrace - anchor.atMs;
  if (Math.abs(endTrace - end.atMs - offset) > 2) throw new Error('Trace/game clock alignment drift');
  if (!samples && result.request.captureProfile === 'standard') throw new Error('Chrome trace contains no CPU samples');

  const output = windows.map(w => ({ id: w.id, threads: [], gc: [], spikes: w.spikes.map(s => ({ ...s, gc: [] })),
    recurringSpikes: (w.recurringSpikes ?? []).map(s => ({ ...s, threads: [] })) }));
  for (const p of profiles.values()) {
    if (gameThread?.pid !== undefined && p.pid !== gameThread.pid) continue;
    if (!Number.isFinite(p.start)) throw new Error('CPU profile has no start timestamp');
    const parents = new Map();
    for (const node of p.nodes.values()) {
      if (node.parent !== undefined) parents.set(node.id, node.parent);
      for (const child of node.children ?? []) parents.set(child, node.id);
    }
    const mapped = new Map(), functions = new Map(), functionIds = new Map();
    for (const [id, node] of p.nodes) {
      signal?.throwIfAborted();
      const frame = await resolveSource(node.callFrame);
      mapped.set(id, frame);
      const key = JSON.stringify([frame.source ?? frame.url, frame.line ?? node.callFrame.lineNumber, frame.column ?? node.callFrame.columnNumber, frame.name ?? frame.functionName]);
      if (!functionIds.has(key)) { functionIds.set(key, functionIds.size); functions.set(functionIds.get(key), frame); }
      functionIds.set(`node:${id}`, functionIds.get(key));
    }
    const aggregateWindows = windows.flatMap((w, index) => [
      { ...w, index }, ...w.spikes.slice(0, 3).map((s, spikeIndex) => ({ fromMs: s.atMs - s.durationMs, toMs: s.atMs, index, spikeIndex })),
      ...(w.recurringSpikes ?? []).map((s, recurringIndex) => ({ ...s, index, recurringIndex })),
    ]);
    const aggregates = aggregateWindows.map(() => ({ self: new Map(), inclusive: new Map(), stacks: new Map(), total: 0, unknown: 0, unresolved: 0, states: {} }));
    let at = p.start / 1000 - offset;
    const timeline = [];
    for (const chunk of p.chunks.sort((a, b) => a.ts - b.ts)) {
      if (chunk.ids.length !== chunk.deltas.length) throw new Error('Mismatched CPU samples/timeDeltas');
      for (let i = 0; i < chunk.ids.length; i++) {
        const duration = chunk.deltas[i] / 1000;
        if (!Number.isFinite(duration)) throw new Error('Invalid CPU sample delta');
        if (duration < 0) reorderedDeltas++;
        at += duration;
        timeline.push({ at, id: chunk.ids[i] });
      }
    }
    // V8 can emit out-of-order timestamps. Reconstruct before sorting, as DevTools does.
    // Attribute the observed interval until the next sample; do not invent profile edge times.
    timeline.sort((a, b) => a.at - b.at);
    for (let i = 0; i + 1 < timeline.length; i++) {
        if (i % 10_000 === 0) { await yieldEventLoop(); signal?.throwIfAborted(); }
        const from = timeline[i].at, at = timeline[i + 1].at, leaf = timeline[i].id;
        const chain = [], seen = new Set();
        for (let id = leaf; id !== undefined && !seen.has(id); id = parents.get(id)) {
          seen.add(id); if (mapped.has(id)) chain.push(id);
        }
        for (let j = 0; j < aggregateWindows.length; j++) {
          const w = aggregateWindows[j], weight = Math.max(0, Math.min(at, w.toMs) - Math.max(from, w.fromMs));
          if (!weight) continue;
          const a = aggregates[j]; a.total += weight;
          if (!chain.length || !mapped.has(leaf)) { a.unknown += weight; continue; }
          const name = mapped.get(leaf)?.name ?? mapped.get(leaf)?.functionName ?? '';
          if (isMetaFrame(name)) { a.states[name] = (a.states[name] ?? 0) + weight; continue; }
          if (!mapped.get(leaf)?.mapped) a.unresolved += weight;
          const functionChain = chain.filter(id => !isMetaFrame(mapped.get(id)?.name ?? mapped.get(id)?.functionName)).map(id => functionIds.get(`node:${id}`));
          const selfId = functionIds.get(`node:${leaf}`);
          a.self.set(selfId, (a.self.get(selfId) ?? 0) + weight);
          for (const id of new Set(functionChain)) a.inclusive.set(id, (a.inclusive.get(id) ?? 0) + weight);
          const key = functionChain.join('/');
          a.stacks.set(key, (a.stacks.get(key) ?? 0) + weight);
        }
    }
    for (let j = 0; j < aggregateWindows.length; j++) {
      const a = aggregates[j];
      if (!a.total) continue;
      const top = (map, projectOnly = false) => [...map]
        .filter(([id]) => !projectOnly || functions.get(id).snapshot?.startsWith('source/src/'))
        .sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([id, ms]) => ({ ...functions.get(id), ms, percent: ms / a.total * 100 }));
      const target = aggregateWindows[j];
      const section = target.recurringIndex !== undefined ? output[target.index].recurringSpikes[target.recurringIndex]
        : target.spikeIndex === undefined ? output[target.index] : output[target.index].spikes[target.spikeIndex];
      (section.threads ??= []).push({ pid: p.pid, tid: p.tid, name: threadNames.get(`${p.pid}:${p.tid}`) ?? 'unknown',
        role: p.tid === gameThread?.tid ? 'main' : 'worker',
        sampledMs: a.total, unknownMs: a.unknown, unresolvedJsMs: a.unresolved, states: a.states, self: top(a.self), inclusive: top(a.inclusive),
        projectSelf: top(a.self, true), projectInclusive: top(a.inclusive, true),
        stacks: [...a.stacks].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, ms]) => ({ ms, frames: key.split('/').map(id => functions.get(Number(id))) })) });
    }
  }
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    output[i].gc = gc.filter(g => (gameThread?.pid === undefined || g.pid === gameThread.pid)
      && g.to - offset > w.fromMs && g.from - offset < w.toMs).map(g => ({
      ...g, fromMs: g.from - offset, toMs: g.to - offset, durationMs: g.to - g.from }));
    for (const s of output[i].spikes) {
      s.gc = gc.filter(g => (gameThread?.pid === undefined || g.pid === gameThread.pid)
        && g.to - offset > s.atMs - s.durationMs && g.from - offset < s.atMs)
        .map(g => ({ ...g, fromMs: g.from - offset, toMs: g.to - offset }));
      s.events = (result.game?.events ?? []).filter(e => {
        const at = e.atMs + result.game.frameCapture.startedAtPerformanceMs;
        return at > s.atMs - s.durationMs && at <= s.atMs;
      });
    }
  }
  if (result.request.captureProfile === 'standard' && gameThread?.pid !== undefined
    && !output.some(w => w.threads.some(t => t.role === 'main' && t.self.length))) {
    throw new Error('No attributable CPU samples from the game main thread');
  }
  return { version: 3, clockOffsetMs: offset, cpuSamples: samples, reorderedDeltas, windows: output,
    notes: [...(result.request.captureProfile === 'reduced' ? ['In diesem reduzierten Profil wurde kein JS-Sampling aufgenommen; Funktions- und Aufrufkettenanteile sind nicht verfügbar.'] : []),
      'CPU-Zeiten aus Sampling sind Schätzungen. Inklusive Zeiten sind verschachtelt und nicht addierbar.',
      'Sample-Zeitstempel werden vor der Intervallbildung sortiert; ungemessene Profilränder erhalten keine künstliche Dauer.',
      'GC zählt MajorGC/MinorGC-Spannen, keine verschachtelten V8-Unteraufgaben. Überlappung beweist weder Ursache noch Speicherleck.',
      'CPU-Berichte umfassen den durch Boot-Marker identifizierten Spielprozess; andere Browserprozesse bleiben im Originaltrace.',
      'GPU-Zeiten stammen ausschließlich aus dem Spielprofiler.'] };
}
