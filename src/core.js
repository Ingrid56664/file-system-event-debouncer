/**
 * @typedef {(path: string) => void} Listener
 */

/**
 * Collapses rapid duplicate file change events from fs.watch into single
 * notifications per path within a configurable window.
 *
 * fs.watch emits multiple events for a single logical change on most platforms
 * (a save in an editor can produce 'rename' followed by 'change', or several
 * 'change' events in quick succession). This class coalesces them so a listener
 * sees one callback per path per quiet window.
 *
 * Design decisions (stated plainly so there is no ambiguity):
 *
 * 1. The debounce window is fixed at construction time. Per-path overrides are
 *    NOT supported. If you need different windows, use separate instances.
 *
 * 2. The clock is injectable. In production pass nothing and Date.now is used;
 *    in tests pass a function so behaviour is deterministic and never depends
 *    on wall-clock time.
 *
 * 3. setTimeout is injectable for the same reason. The default uses the global
 *    setTimeout, which on Node returns a Timeout object; on browsers it returns
 *    a number. We store it opaquely and only pass it back to clearTimeout.
 *
 * 4. Only the path string is used as the key. This means two different paths
 *    that resolve to the same file (e.g. 'a.txt' and './a.txt') are debounced
 *    separately. Normalise before calling .push() if you need that.
 *
 * 5. The listener receives the path string. We do not preserve the fs.watch
 *    event type ('change' vs 'rename') because, after coalescing, a single
 *    notification may represent several different event types and choosing one
 *    would be misleading. If you need the type, don't use this debouncer.
 */
export class Debouncer {
  /**
   * @param {object} [opts]
   * @param {number} opts.windowMs - Quiet period in milliseconds after which a
   *   pending notification fires. Must be a non-negative finite number.
   * @param {Listener} [opts.onFlush] - Called exactly once per coalesced group,
   *   with the path string.
   * @param {() => number} [opts.now] - Clock function, defaults to Date.now.
   * @param {(fn: () => void, ms: number) => unknown} [opts.setTimeout_] - Timer
   *   scheduler, defaults to the global setTimeout.
   * @param {(id: unknown) => void} [opts.clearTimeout_] - Timer clearer,
   *   defaults to the global clearTimeout.
   */
  constructor(opts = {}) {
    const {
      windowMs,
      onFlush,
      now,
      setTimeout_,
      clearTimeout_,
    } = opts;

    if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs < 0) {
      throw new TypeError('windowMs must be a non-negative finite number');
    }
    if (onFlush !== undefined && typeof onFlush !== 'function') {
      throw new TypeError('onFlush must be a function when provided');
    }
    if (now !== undefined && typeof now !== 'function') {
      throw new TypeError('now must be a function when provided');
    }
    if (setTimeout_ !== undefined && typeof setTimeout_ !== 'function') {
      throw new TypeError('setTimeout_ must be a function when provided');
    }
    if (clearTimeout_ !== undefined && typeof clearTimeout_ !== 'function') {
      throw new TypeError('clearTimeout_ must be a function when provided');
    }

    this._windowMs = windowMs;
    this._onFlush = onFlush;
    this._now = now ?? Date.now;
    this._setTimeout = setTimeout_ ?? setTimeout;
    this._clearTimeout = clearTimeout_ ?? clearTimeout;

    /** @type {Map<string, unknown>} */
    this._timers = new Map();
  }

  /**
   * Register a change event for `path`.
   *
   * If a timer is already pending for this path it is cleared first, so the
   * notification is pushed to `windowMs` after THIS call. This is the core
   * debounce behaviour: as long as events keep arriving, the notification is
   * delayed; once a full quiet window elapses, it fires.
   *
   * @param {string} path
   * @returns {void}
   */
  push(path) {
    if (typeof path !== 'string') {
      throw new TypeError('path must be a string');
    }

    const existing = this._timers.get(path);
    if (existing !== undefined) {
      this._clearTimeout(existing);
    }

    const start = this._now();
    const id = this._setTimeout(() => {
      this._timers.delete(path);
      if (this._onFlush) {
        this._onFlush(path);
      }
    }, this._windowMs);

    this._timers.set(path, id);
    void start; // retained for debugging / future lag accounting
  }

  /**
   * If a notification is pending for `path`, fire it immediately. Otherwise
   * do nothing.
   *
   * @param {string} path
   * @returns {void}
   */
  flush(path) {
    if (typeof path !== 'string') {
      throw new TypeError('path must be a string');
    }
    const id = this._timers.get(path);
    if (id === undefined) return;
    this._clearTimeout(id);
    this._timers.delete(path);
    if (this._onFlush) {
      this._onFlush(path);
    }
  }

  /**
   * If a notification is pending for `path`, cancel it silently. The listener
   * will not be called for this path unless a new event arrives.
   *
   * @param {string} path
   * @returns {void}
   */
  cancel(path) {
    if (typeof path !== 'string') {
      throw new TypeError('path must be a string');
    }
    const id = this._timers.get(path);
    if (id === undefined) return;
    this._clearTimeout(id);
    this._timers.delete(path);
  }

  /**
   * Cancel all pending notifications. The listener will not be called for any
   * currently-pending path.
   *
   * @returns {void}
   */
  cancelAll() {
    for (const id of this._timers.values()) {
      this._clearTimeout(id);
    }
    this._timers.clear();
  }

  /**
   * Number of paths with a pending notification.
   *
   * @returns {number}
   */
  get pendingCount() {
    return this._timers.size;
  }
}
