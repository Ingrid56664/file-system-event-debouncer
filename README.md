# file-system-event-debouncer

Collapses rapid duplicate file change events from `fs.watch` into single notifications per path within a configurable window.

```js
import { Debouncer } from 'file-system-event-debouncer';

const d = new Debouncer({
  windowMs: 100,
  onFlush: (path) => console.log('changed:', path),
});

// In your fs.watch callback:
d.push('changedPath');
```

## Why

`fs.watch` on most platforms emits several events for a single logical change — an editor save can produce `rename` then `change`, or a burst of `change` events within a few milliseconds. Wiring that directly to a rebuild or reload handler causes redundant work.

This library keeps a per-path timer: each call to `push(path)` resets that path's countdown. When a full quiet window elapses with no new events for that path, `onFlush(path)` fires once. `flush(path)` fires immediately if something is pending; `cancel(path)` and `cancelAll()` discard pending notifications.

The trade-off: notifications are delayed by `windowMs` at minimum. If you need sub-millisecond responsiveness, this is the wrong tool.

## Edge cases

- Only the raw path string is used as the key. `'a.txt'` and `'./a.txt'` are debounced separately even if they refer to the same file. Normalise before calling `push()` if that matters to you.
- The fs.watch event type (`'change'` vs `'rename'`) is not preserved. After coalescing, a single notification may represent several event types, so the listener receives only the path.
- The window is fixed at construction time. Per-path overrides are not supported; use separate instances.

## Testing

The clock and timers are injectable (`now`, `setTimeout_`, `clearTimeout_`), so tests are deterministic and never depend on wall-clock time.

```bash
node --test
```
