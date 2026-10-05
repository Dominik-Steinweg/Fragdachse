import { isVoiceChecksum } from './VoicePackage';

export interface VoiceDeletions { voiceIds: string[]; checksums: string[] }
const CACHE_KEY = 'fragdachse.voice-deletions.v1';

function parse(value: unknown): VoiceDeletions {
  if (!value || typeof value !== 'object') throw new Error('Invalid deletion registry');
  const data = value as VoiceDeletions;
  if (!Array.isArray(data.voiceIds) || !data.voiceIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id))
    || !Array.isArray(data.checksums) || !data.checksums.every(isVoiceChecksum)) throw new Error('Invalid deletion registry');
  return data;
}

/** Static game content, refreshed independently of cached voice chunks; no workshop connection. */
export async function loadVoiceDeletions(): Promise<VoiceDeletions> {
  let cached: VoiceDeletions = { voiceIds: [], checksums: [] };
  try { cached = parse(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')); } catch { /* First load or unavailable storage. */ }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}voice-deletions.json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return cached;
    const data = parse(await response.json());
    const merged = { voiceIds: [...new Set([...cached.voiceIds, ...data.voiceIds])], checksums: [...new Set([...cached.checksums, ...data.checksums])] };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch { /* Session revocations still apply. */ }
    return merged;
  } catch { return cached; }
}
