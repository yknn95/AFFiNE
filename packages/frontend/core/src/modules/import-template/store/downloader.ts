import { Store } from '@toeverything/infra';

import type { RawFetchProvider } from '../../cloud';

export class TemplateDownloaderStore extends Store {
  constructor(private readonly fetchProvider: RawFetchProvider) {
    super();
  }

  async download(snapshotUrl: string) {
    const response = await this.fetchProvider.fetch(snapshotUrl, {
      priority: 'high',
    } as any);
    const arrayBuffer = await response.arrayBuffer();

    return { data: new Uint8Array(arrayBuffer) };
  }
}
