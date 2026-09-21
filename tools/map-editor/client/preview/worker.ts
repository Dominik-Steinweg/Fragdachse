import { generatePreview } from './generate';
import type { JsonObject } from '../../shared/json';

globalThis.onmessage = (event: MessageEvent<{ draft: JsonObject; seed: number }>) => {
  try { globalThis.postMessage({ result: generatePreview(event.data.draft, event.data.seed) }); }
  catch (cause) { globalThis.postMessage({ error: cause instanceof Error ? cause.message : String(cause) }); }
};
