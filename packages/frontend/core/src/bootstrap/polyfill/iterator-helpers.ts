export async function polyfillIteratorHelpers() {
  if (typeof globalThis['Iterator'] !== 'function') {
    // @ts-expect-error ignore
    // https://github.com/zloirock/core-js/blob/master/packages/core-js/proposals/iterator-helpers-stage-3.js
    await import('core-js/proposals/iterator-helpers-stage-3');
  }
}
