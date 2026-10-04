import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionProgress, explainError, TEST_IDS } from '../frontend/workflow.ts';
import { isOwnAudioOutput } from '../generator.mjs';

test('production guidance requires consent, reference and all current accepted tests', () => {
  const voice = { consentGenerate: true, reference: 'ref.wav', transcript: 'Text', referenceRevision: 2, testedRevision: 1 };
  assert.equal(productionProgress(undefined, []).canTest, false);
  assert.match(productionProgress({ ...voice, consentGenerate: false }, []).reason, /Zustimmung/);
  assert.match(productionProgress({ ...voice, reference: null }, []).reason, /auf/);
  const jobs = TEST_IDS.map(sentenceId => ({ sentenceId, voiceId: 'v', test: true, status: 'review', decision: 'accepted' }));
  assert.equal(productionProgress(voice, jobs).testsAccepted, 3);
  assert.equal(productionProgress(voice, jobs).canProduce, false);
  assert.equal(productionProgress({ ...voice, testedRevision: 2 }, jobs).canProduce, true);
  assert.equal(productionProgress(voice, jobs.map(j => ({ ...j, stale: true }))).testsAccepted, 0);
  assert.equal(productionProgress(voice, [{ ...jobs[0], decision: 'rejected' }]).testsAvailable, 0);
});
test('LAN guidance needs one combined consent but no accepted tests', () => {
  const voice = { consentGenerate: true, consentLan: true, reference: 'ref.wav', transcript: 'Text', referenceRevision: 2, testedRevision: 0 };
  assert.equal(productionProgress(voice, [], true).canProduce, true);
  assert.equal(productionProgress({ ...voice, consentLan: false }, [], true).canProduce, false);
  assert.equal(productionProgress({ ...voice, archived: true }, [], true).canProduce, false);
  assert.equal(productionProgress({ ...voice, reference: undefined }, [], true).canProduce, false);
});

test('microphone and service failures explain the next action', () => {
  assert.match(explainError({ name: 'NotAllowedError' }), /Browser-Einstellungen/);
  assert.match(explainError(new TypeError('Failed to fetch')), /Werkstatt-Dienst/);
  assert.match(explainError(new Error('VOICE_COMFY_INPUT fehlt')), /Ein-\/Ausgabeordner/);
  assert.match(explainError({ name: 'EncodingError' }), /WAV/);
});
test('ComfyUI Windows separators are accepted only for the exact owned output folder', () => {
  const output = { type: 'output', subfolder: 'voice-workshop\\job', filename: 'take_00001.flac' };
  assert.equal(isOwnAudioOutput(output, 'voice-workshop/job'), true);
  assert.equal(isOwnAudioOutput({ ...output, subfolder: 'voice-workshop/job/../other' }, 'voice-workshop/job'), false);
  assert.equal(isOwnAudioOutput({ ...output, filename: '../take_00001.flac' }, 'voice-workshop/job'), false);
  assert.equal(isOwnAudioOutput({ ...output, type: 'input' }, 'voice-workshop/job'), false);
});
