/**
 * Re-exports the public API of file-system-event-debouncer.
 *
 * Keeping a barrel file so consumers can `import { Debouncer } from 'file-system-event-debouncer'`
 * regardless of how the package is bundled.
 */
export { Debouncer } from './core.js';
