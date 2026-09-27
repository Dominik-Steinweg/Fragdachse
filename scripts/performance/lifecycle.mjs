import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/** The producer returns { json: string }, keeping the large text in a remote object handle. */
export async function readBrowserJson(page, producer, { signal, chunkChars = 512 * 1024 } = {}) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(chunkChars) || chunkChars < 1) throw new Error('Invalid browser JSON chunk size');
  const handle = await page.evaluateHandle(producer);
  try {
    // A primitive string handle is still sent by value by CDP (and again as an
    // argument on each evaluate). Only an object keeps the full recording remote.
    const length = await handle.evaluate(value => {
      if (!value || typeof value !== 'object' || typeof value.json !== 'string') throw new Error('Missing serialized browser recording');
      return value.json.length;
    });
    const chunks = [];
    for (let offset = 0; offset < length;) {
      signal?.throwIfAborted();
      const chunk = await handle.evaluate(({ json: value }, { offset, size }) => {
        let end = Math.min(value.length, offset + size);
        // Keep UTF-16 surrogate pairs together across protocol/chunk boundaries.
        const last = value.charCodeAt(end - 1);
        if (end < value.length && last >= 0xd800 && last <= 0xdbff) end++;
        return value.slice(offset, end);
      }, { offset, size: chunkChars });
      if (!chunk.length) throw new Error('Empty browser recording chunk');
      chunks.push(chunk); offset += chunk.length;
    }
    return chunks.join('');
  } finally { await handle.dispose(); }
}

/** Backpressure bounds memory; compressed traces never need an uncompressed disk copy. */
export async function transferChromeTrace(session, stream, path, { signal, checkSpace = async () => {}, send = (method, args) => session.send(method, args) } = {}) {
  async function* chunks() {
    for (;;) {
      signal?.throwIfAborted();
      const chunk = await send('IO.read', { handle: stream, size: 1024 * 1024 });
      const data = chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data);
      await checkSpace(data.length + 1024 * 1024);
      yield data;
      if (chunk.eof) break;
    }
  }
  try {
    const stages = [chunks()];
    if (path.endsWith('.gz')) stages.push(createGzip());
    stages.push(createWriteStream(path, { flags: 'wx' }));
    await pipeline(stages, { signal });
  } finally { await send('IO.close', { handle: stream }).catch(() => {}); }
}

/** A resource that arrives after cancellation still belongs to this runner and must be closed. */
export async function acquireOwned(create, close, signal) {
  signal.throwIfAborted();
  const resource = await create();
  if (signal.aborted) {
    try { await close(resource); }
    finally { signal.throwIfAborted(); }
  }
  return resource;
}

/** A failed run stays failed, but the browser's surviving trace can explain the crash. */
export async function preserveFailedChromeTrace(session, path, timeoutMs = 30_000, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const wait = async operation => {
    if (Date.now() >= deadline) throw new Error('Partial Chrome trace timeout');
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Partial Chrome trace timeout')), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  let onComplete;
  const finished = new Promise(resolve => { onComplete = resolve; session.once('Tracing.tracingComplete', onComplete); });
  try {
    await wait(() => session.send('Tracing.end'));
    const result = await wait(() => finished);
    const stream = result.stream;
    if (!stream) throw new Error('No partial Chrome trace stream');
    await transferChromeTrace(session, stream, path, { ...options, send: (method, args) => wait(() => session.send(method, args)) });
    return { dataLossOccurred: result.dataLossOccurred === true };
  } finally {
    session.off('Tracing.tracingComplete', onComplete);
  }
}
