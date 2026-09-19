import { open } from 'node:fs/promises';

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
export async function preserveFailedChromeTrace(session, path, timeoutMs = 30_000) {
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
  let onComplete, handle, stream;
  const finished = new Promise(resolve => { onComplete = resolve; session.once('Tracing.tracingComplete', onComplete); });
  try {
    await wait(() => session.send('Tracing.end'));
    const result = await wait(() => finished);
    stream = result.stream;
    if (!stream) throw new Error('No partial Chrome trace stream');
    handle = await open(path, 'wx');
    for (;;) {
      const chunk = await wait(() => session.send('IO.read', { handle: stream, size: 1024 * 1024 }));
      await handle.writeFile(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
      if (chunk.eof) break;
    }
    return { dataLossOccurred: result.dataLossOccurred === true };
  } finally {
    session.off('Tracing.tracingComplete', onComplete);
    await handle?.close();
    if (stream) await wait(() => session.send('IO.close', { handle: stream })).catch(() => {});
  }
}
