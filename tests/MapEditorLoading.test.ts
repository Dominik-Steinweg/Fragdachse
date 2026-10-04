import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEnvironment } from '../tools/map-editor/client/ui';

const boundary = vi.hoisted(() => ({ environments: [] as EditorEnvironment[], destroy: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/i18n/contentPresentation', () => ({ getMapName: (id: string) => id }));
vi.mock('../tools/map-editor/shared/validation', () => ({ validateDocument: () => ({ issues: [], normalized: {} }) }));
vi.mock('../tools/map-editor/client/ui', async importOriginal => ({
  ...await importOriginal<typeof import('../tools/map-editor/client/ui')>(), confirmEdit: boundary.confirm,
}));
vi.mock('../tools/map-editor/client/encounters/EncounterView', () => ({ EncounterView: class { render() { return document.createElement('div'); } } }));
vi.mock('../tools/map-editor/client/map/MapView', () => ({ MapView: class {
  root = document.createElement('main'); canvas = { paint() {} };
  constructor(env: EditorEnvironment) { boundary.environments.push(env); }
  render() {} destroy() { boundary.destroy(); }
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
class Element {
  className = ''; textContent = ''; value = ''; hidden = false; scrollTop = 0;
  children: Element[] = []; onchange?: () => void;
  classList = { toggle() {} };
  setAttribute() {} append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const response = (key: string, ok = true) => ({ ok, json: async () => ok
  ? { sourceKey: key, mapId: key, text: '{}', revision: 'r', document: { mapId: key, objective: 'survive' } }
  : { error: `Failed ${key}` } });
async function setup() {
  const nodes: Element[] = [], pending = new Map<string, ReturnType<typeof deferred<ReturnType<typeof response>>>>();
  const app = new Element();
  vi.stubGlobal('document', { querySelector: () => app, createElement: () => { const node = new Element(); nodes.push(node); return node; } });
  vi.stubGlobal('window', { addEventListener() {} });
  const fetch = vi.fn((url: string) => {
    if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ token: 'token' }) });
    if (url === '/api/maps') return Promise.resolve({ ok: true, json: async () => [{ file: 'initial.json', mapId: '1' }] });
    if (url === '/api/maps/initial.json') return Promise.resolve(response('initial.json'));
    const request = deferred<ReturnType<typeof response>>(); pending.set(url, request); return request.promise;
  });
  vi.stubGlobal('fetch', fetch);
  await import('../tools/map-editor/client/main'); await flush();
  const select = nodes.find(node => node.className === 'map-select')!;
  const message = nodes.find(node => node.className === 'message')!;
  const current = () => boundary.environments.at(-1)!;
  return { select, message, current, fetch,
    choose(key: string) { select.value = key; select.onchange!(); },
    async complete(key: string, ok = true) { pending.get(`/api/maps/${key}`)!.resolve(response(key, ok)); await flush(); },
  };
}
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); boundary.environments.length = 0; boundary.confirm.mockResolvedValue(true); });
afterEach(() => vi.unstubAllGlobals());

describe('map editor document loading', () => {
  it.each([true, false])('ignores a superseded response (success=%s) after the newest map loads', async ok => {
    const h = await setup(); h.choose('old.json'); h.choose('latest.json');
    await h.complete('latest.json');
    const latest = h.current(); latest.session.change(['treeCount'], 3);
    await h.complete('old.json', ok);
    expect(h.current()).toBe(latest);
    expect(h.select.value).toBe('latest.json');
    expect(h.message.hidden).toBe(true);
    expect(boundary.destroy).toHaveBeenCalledTimes(1);
    expect(latest.session.dirty).toBe(true);
  });
  it('keeps the current map until the latest response arrives and then loads it', async () => {
    const h = await setup(); const initial = h.current(); h.choose('old.json'); h.choose('latest.json');
    await h.complete('old.json'); expect(h.current()).toBe(initial);
    await h.complete('latest.json'); expect(h.current().session.sourceKey).toBe('latest.json');
    expect(h.select.value).toBe('latest.json'); expect(boundary.destroy).toHaveBeenCalledTimes(1);
  });
  it('reports a current failure without discarding the open document', async () => {
    const h = await setup(); const initial = h.current(); h.choose('latest.json'); await h.complete('latest.json', false);
    expect(h.current()).toBe(initial); expect(h.select.value).toBe('initial.json');
    expect(h.message.textContent).toBe('Failed latest.json'); expect(h.message.hidden).toBe(false);
  });
  it.each([true, false])('ignores an obsolete confirmation (accepted=%s) after a newer load', async accepted => {
    const h = await setup(); h.current().session.change(['treeCount'], 3);
    const oldConfirmation = deferred<boolean>(); boundary.confirm.mockReturnValueOnce(oldConfirmation.promise);
    h.choose('old.json'); h.choose('latest.json'); await flush(); await h.complete('latest.json');
    oldConfirmation.resolve(accepted); await flush();
    expect(h.select.value).toBe('latest.json'); expect(h.current().session.sourceKey).toBe('latest.json');
    expect(h.fetch).not.toHaveBeenCalledWith('/api/maps/old.json', undefined);
  });
  it('keeps unsaved edits when the current confirmation is cancelled and supersedes older requests', async () => {
    const h = await setup(); const initial = h.current(); h.choose('old.json');
    initial.session.change(['treeCount'], 3); boundary.confirm.mockResolvedValueOnce(false);
    h.choose('cancelled.json'); await flush(); await h.complete('old.json');
    expect(h.current()).toBe(initial); expect(h.select.value).toBe('initial.json'); expect(initial.session.dirty).toBe(true);
    expect(h.fetch).not.toHaveBeenCalledWith('/api/maps/cancelled.json', undefined);
  });
  it('does not reset the newest pending selection when an older confirmation is cancelled', async () => {
    const h = await setup(); h.current().session.change(['treeCount'], 3);
    const oldConfirmation = deferred<boolean>(); boundary.confirm.mockReturnValueOnce(oldConfirmation.promise);
    h.choose('old.json'); h.choose('latest.json'); await flush();
    oldConfirmation.resolve(false); await flush(); expect(h.select.value).toBe('latest.json');
    await h.complete('latest.json'); expect(h.current().session.sourceKey).toBe('latest.json');
  });
});
