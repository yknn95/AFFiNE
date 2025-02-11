import { polyfillDispose } from './dispose';
import { polyfillIteratorHelpers } from './iterator-helpers';
import { polyfillPromise } from './promise-with-resolvers';
import { polyfillEventLoop } from './request-idle-callback';
import { polyfillResizeObserver } from './resize-observer';

polyfillResizeObserver();
polyfillEventLoop();
await polyfillPromise();
await polyfillDispose();
await polyfillIteratorHelpers();
