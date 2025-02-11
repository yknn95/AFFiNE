import { createIdentifier } from '@toeverything/infra';

import type { FetchInit } from '../services/fetch';

export interface RawFetchProvider {
  /**
   * standard fetch, in ios&android, we can use native fetch to implement this
   */
  fetch: (input: string | URL, init?: FetchInit) => Promise<Response>;
}

export const RawFetchProvider =
  createIdentifier<RawFetchProvider>('FetchProvider');

export const DefaultRawFetchProvider = {
  fetch: globalThis.fetch.bind(globalThis),
};
