'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function desktopBridge() {
  let api; const calls = [], listeners = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, webUtils: {},
    ipcRenderer: {
      invoke: async (...args) => { calls.push(args); return { ok: true }; },
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), { require: (name) => { assert.equal(name, 'electron'); return electron; } });
  return { api, calls, listeners };
}
test('copy commands pass approved drive tokens and review IDs through the intended IPC channels', async () => {
  const { api, calls } = desktopBridge();
  const expected = { deviceId: 'a', deviceKey: 'uuid:a', label: 'USB A' };
  const request = { sourceToken: 'a-token', destinationToken: 'b-token', segments: ['Contents', 'Track.mp3'] };
  await api.chooseAudioCopyUsb(expected); await api.prepareAudioCopy(request); await api.startAudioCopy('review-id'); await api.cancelAudioCopy('review-id');
  assert.deepEqual(calls, [
    ['dropdex:choose-audio-copy-usb', expected], ['dropdex:prepare-audio-copy', request],
    ['dropdex:start-audio-copy', 'review-id'], ['dropdex:cancel-audio-copy', 'review-id'],
  ]);
});
test('progress subscriptions forward their payload and remove only their own listener', () => {
  const { api, listeners } = desktopBridge(); let received;
  const unsubscribe = api.onAudioCopyProgress((value) => { received = value; });
  const payload = { planId: 'review-id', percent: 45 };
  listeners.get('dropdex:audio-copy-progress')({}, payload); assert.equal(received, payload);
  unsubscribe(); assert.equal(listeners.has('dropdex:audio-copy-progress'), false);
});
