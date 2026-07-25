'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { UsbStreamRegistry } = require('./usbStreamRegistry.cjs');

function delayedDestroyStream(delayMs = 5) {
  const stream = new PassThrough();
  const originalDestroy = stream.destroy.bind(stream);
  stream.destroy = (...args) => {
    setTimeout(() => originalDestroy(...args), delayMs);
    return stream;
  };
  return stream;
}

test('disconnect/release with zero streams succeeds', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 50 });
  const result = await registry.release();
  assert.equal(result.allStreamsClosed, true);
  assert.equal(result.remainingStreamCount, 0);
});

test('release destroys one active stream', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 100 });
  registry.track(delayedDestroyStream());
  const result = await registry.release();
  assert.equal(result.allStreamsClosed, true);
  assert.equal(result.destroyedStreamCount, 1);
  assert.equal(registry.snapshot().activeStreamCount, 0);
});

test('release destroys several active streams', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 100 });
  registry.track(delayedDestroyStream());
  registry.track(delayedDestroyStream());
  registry.track(delayedDestroyStream());
  const result = await registry.release();
  assert.equal(result.allStreamsClosed, true);
  assert.equal(result.destroyedStreamCount, 3);
});

test('stream ending while release iterates remains safe', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 100 });
  const ending = new PassThrough();
  registry.track(ending);
  registry.track(delayedDestroyStream());
  ending.end();
  const result = await registry.release();
  assert.equal(result.allStreamsClosed, true);
});

test('one stream throwing during destruction does not block the others', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 20, pollIntervalMs: 1 });
  const throwing = new PassThrough();
  throwing.destroy = () => { throw new Error('destroy failed'); };
  registry.track(throwing);
  const closing = delayedDestroyStream();
  registry.track(closing);
  const result = await registry.release();
  assert.equal(result.allStreamsClosed, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.remainingStreamCount, 1);
  assert.equal(closing.destroyed, true);
  assert.match(registry.snapshot().lastError, /destroy failed/);
  PassThrough.prototype.destroy.call(throwing);
});

test('new media requests are rejected while released', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 50 });
  await registry.release();
  assert.throws(() => registry.beginRequest(), { code: 'USB_RELEASING' });
});

test('release waits for an in-flight media request and rejects new ones', async () => {
  const registry = new UsbStreamRegistry({ closeTimeoutMs: 100, pollIntervalMs: 1 });
  const finish = registry.beginRequest();
  setTimeout(finish, 10);
  const releasePromise = registry.release();
  assert.throws(() => registry.beginRequest(), { code: 'USB_RELEASING' });
  const result = await releasePromise;
  assert.equal(result.allStreamsClosed, true);
  assert.equal(result.pendingRequestCount, 0);
});
