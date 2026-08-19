import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { BootScreen } from '../src/ui/BootScreen';

class MockElement {
  id: string = '';
  className: string = '';
  textContent: string = '';
  style: Record<string, string> = {};
  classList = {
    contains: (cls: string) => this.className.split(/\s+/).includes(cls),
    add: (cls: string) => {
      if (!this.classList.contains(cls)) {
        this.className = this.className ? `${this.className} ${cls}` : cls;
      }
    },
    remove: (cls: string) => {
      this.className = this.className.split(/\s+/).filter((c) => c !== cls).join(' ');
    },
  };
  children: MockElement[] = [];
  eventListeners: Record<string, Array<{ handler: (ev?: unknown) => void; once?: boolean }>> = {};

  addEventListener(event: string, handler: (ev?: unknown) => void, options?: { once?: boolean }) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push({ handler, once: options?.once });
  }

  dispatchEvent(event: { type: string }) {
    const list = this.eventListeners[event.type] ?? [];
    for (const item of [...list]) {
      item.handler(event);
      if (item.once) {
        this.eventListeners[event.type] = this.eventListeners[event.type].filter((l) => l !== item);
      }
    }
  }

  appendChild(child: MockElement) {
    this.children.push(child);
  }

  remove() {
    mockElements.delete(this.id);
  }
}

const mockElements = new Map<string, MockElement>();

function createMockElement(id: string, className = ''): MockElement {
  const el = new MockElement();
  el.id = id;
  el.className = className;
  mockElements.set(id, el);
  return el;
}

describe('BootScreen DOM controller', () => {
  let bootScreen: MockElement;
  let bootBarFill: MockElement;
  let bootStatus: MockElement;

  beforeEach(() => {
    mockElements.clear();

    bootScreen = createMockElement('boot-screen', 'boot-screen');
    bootBarFill = createMockElement('boot-bar-fill', 'boot-bar-fill boot-bar-indeterminate');
    bootStatus = createMockElement('boot-status', 'boot-status');

    vi.stubGlobal('document', {
      getElementById: (id: string) => mockElements.get(id) ?? null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('updates the status text', () => {
    BootScreen.setStatus('Verbindung wird aufgebaut …');
    expect(bootStatus.textContent).toBe('Verbindung wird aufgebaut …');
  });

  it('sets determinate progress and removes indeterminate class', () => {
    expect(bootBarFill.classList.contains('boot-bar-indeterminate')).toBe(true);

    BootScreen.setProgress(0.45, 'Spieldaten werden geladen …');
    expect(bootBarFill.classList.contains('boot-bar-indeterminate')).toBe(false);
    expect(bootBarFill.style.width).toBe('45.0%');
    expect(bootStatus.textContent).toBe('Spieldaten werden geladen …');
  });

  it('clamps progress ratio between 0 and 1', () => {
    BootScreen.setProgress(-0.5);
    expect(bootBarFill.style.width).toBe('0.0%');

    BootScreen.setProgress(1.5);
    expect(bootBarFill.style.width).toBe('100.0%');
  });

  it('switches indeterminate state on and off', () => {
    BootScreen.setProgress(0.5);
    expect(bootBarFill.classList.contains('boot-bar-indeterminate')).toBe(false);

    BootScreen.setIndeterminate(true);
    expect(bootBarFill.classList.contains('boot-bar-indeterminate')).toBe(true);
    expect(bootBarFill.style.width).toBe('');

    BootScreen.setIndeterminate(false);
    expect(bootBarFill.classList.contains('boot-bar-indeterminate')).toBe(false);
  });

  it('dismisses immediately and removes element from DOM', () => {
    expect(mockElements.has('boot-screen')).toBe(true);
    BootScreen.dismissImmediate();
    expect(mockElements.has('boot-screen')).toBe(false);
  });

  it('fades out and removes element on transitionend', async () => {
    const fadePromise = BootScreen.fadeOut(50);
    expect(bootScreen.classList.contains('boot-screen-fade-out')).toBe(true);

    bootScreen.dispatchEvent({ type: 'transitionend' });
    await fadePromise;

    expect(mockElements.has('boot-screen')).toBe(false);
  });
});
