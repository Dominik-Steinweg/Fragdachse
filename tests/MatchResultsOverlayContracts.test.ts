import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OVERLAY_PATH = 'src/ui/MatchResultsOverlay.ts';

describe('MatchResultsOverlay visual ownership', () => {
  it('restores the translucent backdrop without fading the root container', () => {
    const source = readFileSync(OVERLAY_PATH, 'utf8');
    const buildStart = source.indexOf('  build(): void {');
    const presentStart = source.indexOf('  private present(');
    const sequenceStart = source.indexOf('  private startSequence(');
    const sequenceEnd = source.indexOf('\n  /** Aufschlag des Ergebnisses', sequenceStart);

    expect(buildStart).toBeGreaterThanOrEqual(0);
    expect(presentStart).toBeGreaterThan(buildStart);
    expect(sequenceStart).toBeGreaterThan(presentStart);
    expect(sequenceEnd).toBeGreaterThan(sequenceStart);
    expect(source.slice(buildStart, presentStart)).toContain(
      'GAME_HEIGHT, COLORS.GREY_10, 0.88)',
    );
    expect(source.slice(presentStart, sequenceStart)).toContain(
      'this.container!.setVisible(true).setAlpha(1);',
    );
    expect(source.slice(sequenceStart, sequenceEnd)).not.toContain(
      'targets: this.container',
    );
    expect(source.slice(sequenceStart, sequenceEnd)).toContain('targets: this.panel');
  });
});

describe('MatchResultsOverlay replay close contract', () => {
  it('closes a replay without invoking onContinue', () => {
    const source = readFileSync(OVERLAY_PATH, 'utf8');
    const replayStart = source.indexOf('  showReplay(');
    const replayEnd = source.indexOf('\n  private present(', replayStart);
    const closeStart = source.indexOf('  private continueToLobby(): void {');
    const closeEnd = source.indexOf('\n  // ── Effekte', closeStart);

    expect(replayStart).toBeGreaterThanOrEqual(0);
    expect(replayEnd).toBeGreaterThan(replayStart);
    expect(closeStart).toBeGreaterThan(replayEnd);
    expect(closeEnd).toBeGreaterThan(closeStart);
    expect(source.slice(replayStart, replayEnd)).toContain('this.replayOnly = true;');
    expect(source.slice(closeStart, closeEnd)).toContain('const wasReplay = this.replayOnly;');
    expect(source.slice(closeStart, closeEnd)).toContain('this.hide();');
    expect(source.slice(closeStart, closeEnd)).toContain('if (!wasReplay) this.onContinue();');
  });
});

describe('MatchResultsOverlay persistent-base reward contract', () => {
  it('renders the area expansion through the existing reward-chip path', () => {
    const source = readFileSync(OVERLAY_PATH, 'utf8');
    expect(source).toContain('const MAX_REWARD_CHIPS = 8;');
    expect(source).toContain('if (progress.persistentBaseAreaStageUnlocked)');
    expect(source).toContain("t('ui.reward.persistentBaseAreaExpanded')");
    expect(source).toContain("t('ui.reward.persistentBaseAreaExpandedHint')");
  });
});
