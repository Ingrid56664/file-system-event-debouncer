import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Debouncer } from '../src/index.js';

/**
 * Minimal fake timer. Tracks scheduled callbacks and the delay each was given,
 * so tests can advance time deterministically.
 */
class FakeTimers {
  constructor() {
    this.scheduled = [];
    this._seq = 0;
  }
  setTimeout(fn, ms) {
    const id = ++this._seq;
    this.scheduled.push({ id, fn, ms, fired: false });
    return id;
  }
  clearTimeout(id) {
    const entry = this.scheduled.find(s => s.id === id);
    if (entry) entry.fired = true;
  }
  // Fire all scheduled callbacks whose ms <= elapsed, in insertion order.
  fire(elapsed) {
    for (const entry of this.scheduled) {
      if (!entry.fired && entry.ms <= elapsed) {
        entry.fired = true;
        entry.fn();
      }
    }
  }
  pending() {
    return this.scheduled.filter(s => !s.fired);
  }
}

test('constructs with valid windowMs and onFlush', () => {
  const d = new Debouncer({ windowMs: 100, onFlush: () => {} });
  assert.equal(d.pendingCount, 0);
});


test('push schedules a flush after the window', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 100,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('a.txt');
  assert.equal(d.pendingCount, 1);
  assert.equal(calls.length, 0);
  t.fire(99);
  assert.equal(calls.length, 0);
  t.fire(100);
  assert.deepEqual(calls, ['a.txt']);
  assert.equal(d.pendingCount, 0);
});

test('rapid duplicate pushes coalesce to a single flush', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 50,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('b.txt');
  d.push('b.txt');
  d.push('b.txt');
  assert.equal(d.pendingCount, 1);
  assert.equal(t.pending().length, 1); // earlier timers were cleared
  t.fire(50);
  assert.deepEqual(calls, ['b.txt']);
});

test('different paths are debounced independently', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 50,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('x.txt');
  d.push('y.txt');
  assert.equal(d.pendingCount, 2);
  t.fire(50);
  assert.deepEqual(calls.sort(), ['x.txt', 'y.txt']);
});

test('flush fires a pending notification immediately', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 100,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('c.txt');
  d.flush('c.txt');
  assert.deepEqual(calls, ['c.txt']);
  assert.equal(d.pendingCount, 0);
  t.fire(100); // must NOT fire again
  assert.deepEqual(calls, ['c.txt']);
});

test('flush on a path with no pending notification is a no-op', () => {
  const calls = [];
  const d = new Debouncer({
    windowMs: 100,
    onFlush: p => calls.push(p),
    now: () => 0,
  });
  d.flush('never.txt');
  assert.deepEqual(calls, []);
});

test('cancel suppresses the notification', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 100,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('d.txt');
  d.cancel('d.txt');
  assert.equal(d.pendingCount, 0);
  t.fire(100);
  assert.deepEqual(calls, []);
});

test('cancel on a path with no pending notification is a no-op', () => {
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 100,
    onFlush: () => {},
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  assert.doesNotThrow(() => d.cancel('nothing'));
  assert.equal(d.pendingCount, 0);
});

test('cancelAll clears every pending path', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 100,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('p1');
  d.push('p2');
  d.push('p3');
  assert.equal(d.pendingCount, 3);
  d.cancelAll();
  assert.equal(d.pendingCount, 0);
  t.fire(100);
  assert.deepEqual(calls, []);
});

test('windowMs of 0 fires on next tick of the timer', () => {
  const calls = [];
  const t = new FakeTimers();
  const d = new Debouncer({
    windowMs: 0,
    onFlush: p => calls.push(p),
    now: () => 0,
    setTimeout_: (fn, ms) => t.setTimeout(fn, ms),
    clearTimeout_: id => t.clearTimeout(id),
  });
  d.push('zero.txt');
  assert.equal(calls.length, 0);
  t.fire(0);
  assert.deepEqual(calls, ['zero.txt']);
});

test('construction rejects invalid windowMs', () => {
  assert.throws(() => new Debouncer({ windowMs: -1 }), TypeError);
  assert.throws(() => new Debouncer({ windowMs: NaN }), TypeError);
  assert.throws(() => new Debouncer({ windowMs: '100' }), TypeError);
  assert.throws(() => new Debouncer({}), TypeError);
});

test('construction rejects invalid onFlush', () => {
  assert.throws(() => new Debouncer({ windowMs: 100, onFlush: 'notafunc' }), TypeError);
});

test('push rejects non-string path', () => {
  const d = new Debouncer({ windowMs: 100, onFlush: () => {} });
  assert.throws(() => d.push(42), TypeError);
  assert.throws(() => d.push(null), TypeError);
});
