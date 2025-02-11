import type { OpClient } from '@toeverything/infra/op';

import { DummyConnection } from '../connection';
import { DocFrontend } from '../frontend/doc';
import {
  type AwarenessRecord,
  type AwarenessStorage,
  type BlobRecord,
  type BlobStorage,
  type DocRecord,
  type DocStorage,
  type DocUpdate,
  type ListedBlobRecord,
  type StorageOptions,
  universalId,
} from '../storage';
import type { AwarenessSync } from '../sync/awareness';
import type { BlobSync } from '../sync/blob';
import type { DocSync } from '../sync/doc';
import type { WorkerOps } from './ops';

export class WorkerClient {
  constructor(
    private readonly client: OpClient<WorkerOps>,
    private readonly options: StorageOptions
  ) {}

  readonly docStorage = new WorkerDocStorage(this.client, this.options);
  readonly blobStorage = new WorkerBlobStorage(this.client, this.options);
  readonly awarenessStorage = new WorkerAwarenessStorage(
    this.client,
    this.options
  );
  readonly docSync = new WorkerDocSync(this.client);
  readonly blobSync = new WorkerBlobSync(this.client);
  readonly awarenessSync = new WorkerAwarenessSync(this.client);

  readonly docFrontend = new DocFrontend(this.docStorage, this.docSync);
}

class WorkerDocStorage implements DocStorage {
  constructor(
    private readonly client: OpClient<WorkerOps>,
    private readonly options: StorageOptions
  ) {}

  readonly peer = this.options.peer;
  readonly spaceType = this.options.type;
  readonly spaceId = this.options.id;
  readonly universalId = universalId(this.options);
  readonly storageType = 'doc';

  async getDoc(docId: string) {
    return this.client.call('docStorage.getDoc', docId);
  }

  async getDocDiff(docId: string, state?: Uint8Array) {
    return this.client.call('docStorage.getDocDiff', { docId, state });
  }

  async pushDocUpdate(update: DocUpdate, origin?: string) {
    return this.client.call('docStorage.pushDocUpdate', { update, origin });
  }

  async getDocTimestamp(docId: string) {
    return this.client.call('docStorage.getDocTimestamp', docId);
  }

  async getDocTimestamps(after?: Date) {
    return this.client.call('docStorage.getDocTimestamps', after ?? null);
  }

  async deleteDoc(docId: string) {
    return this.client.call('docStorage.deleteDoc', docId);
  }

  subscribeDocUpdate(callback: (update: DocRecord, origin?: string) => void) {
    const subscription = this.client
      .ob$('docStorage.subscribeDocUpdate')
      .subscribe(value => {
        callback(value.update, value.origin);
      });
    return () => {
      subscription.unsubscribe();
    };
  }

  connection = new WorkerDocConnection(this.client);
}

class WorkerDocConnection extends DummyConnection {
  constructor(private readonly client: OpClient<WorkerOps>) {
    super();
  }

  override waitForConnected(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortListener = () => {
        reject(signal?.reason);
        subscription.unsubscribe();
      };

      signal?.addEventListener('abort', abortListener);

      const subscription = this.client
        .ob$('docStorage.waitForConnected')
        .subscribe({
          next() {
            signal?.removeEventListener('abort', abortListener);
            resolve();
          },
          error(err) {
            signal?.removeEventListener('abort', abortListener);
            reject(err);
          },
        });
    });
  }
}

class WorkerBlobStorage implements BlobStorage {
  constructor(
    private readonly client: OpClient<WorkerOps>,
    private readonly options: StorageOptions
  ) {}

  readonly storageType = 'blob';
  readonly peer = this.options.peer;
  readonly spaceType = this.options.type;
  readonly spaceId = this.options.id;
  readonly universalId = universalId(this.options);

  get(key: string, _signal?: AbortSignal): Promise<BlobRecord | null> {
    return this.client.call('blobStorage.getBlob', key);
  }
  set(blob: BlobRecord, _signal?: AbortSignal): Promise<void> {
    return this.client.call('blobStorage.setBlob', blob);
  }

  delete(
    key: string,
    permanently: boolean,
    _signal?: AbortSignal
  ): Promise<void> {
    return this.client.call('blobStorage.deleteBlob', { key, permanently });
  }

  release(_signal?: AbortSignal): Promise<void> {
    return this.client.call('blobStorage.releaseBlobs');
  }

  list(_signal?: AbortSignal): Promise<ListedBlobRecord[]> {
    return this.client.call('blobStorage.listBlobs');
  }

  connection = new DummyConnection();
}

class WorkerAwarenessStorage implements AwarenessStorage {
  constructor(
    private readonly client: OpClient<WorkerOps>,
    private readonly options: StorageOptions
  ) {}

  readonly storageType = 'awareness';
  readonly peer = this.options.peer;
  readonly spaceType = this.options.type;
  readonly spaceId = this.options.id;
  readonly universalId = universalId(this.options);

  update(record: AwarenessRecord, origin?: string): Promise<void> {
    return this.client.call('awarenessStorage.update', {
      awareness: record,
      origin,
    });
  }
  subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void {
    const subscription = this.client
      .ob$('awarenessStorage.subscribeUpdate', id)
      .subscribe({
        next: update => {
          if (update.type === 'awareness-update') {
            onUpdate(update.awareness, update.origin);
          }
          if (update.type === 'awareness-collect') {
            onCollect()
              .then(record => {
                if (record) {
                  this.client
                    .call('awarenessStorage.collect', {
                      awareness: record,
                      collectId: update.collectId,
                    })
                    .catch(err => {
                      console.error('error feedback collected awareness', err);
                    });
                }
              })
              .catch(err => {
                console.error('error collecting awareness', err);
              });
          }
        },
      });
    return () => {
      subscription.unsubscribe();
    };
  }
  connection = new DummyConnection();
}

class WorkerDocSync implements DocSync {
  constructor(private readonly client: OpClient<WorkerOps>) {}

  readonly state$ = this.client.ob$('docSync.state');

  docState$(docId: string) {
    return this.client.ob$('docSync.docState', docId);
  }

  addPriority(docId: string, priority: number) {
    const subscription = this.client
      .ob$('docSync.addPriority', { docId, priority })
      .subscribe();
    return () => {
      subscription.unsubscribe();
    };
  }
}

class WorkerBlobSync implements BlobSync {
  constructor(private readonly client: OpClient<WorkerOps>) {}
  downloadBlob(
    blobId: string,
    _signal?: AbortSignal
  ): Promise<BlobRecord | null> {
    return this.client.call('blobSync.downloadBlob', blobId);
  }
  uploadBlob(blob: BlobRecord, _signal?: AbortSignal): Promise<void> {
    return this.client.call('blobSync.uploadBlob', blob);
  }
}

class WorkerAwarenessSync implements AwarenessSync {
  constructor(private readonly client: OpClient<WorkerOps>) {}

  update(record: AwarenessRecord, origin?: string): Promise<void> {
    return this.client.call('awarenessSync.update', {
      awareness: record,
      origin,
    });
  }

  subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void {
    const subscription = this.client
      .ob$('awarenessSync.subscribeUpdate', id)
      .subscribe({
        next: update => {
          if (update.type === 'awareness-update') {
            onUpdate(update.awareness, update.origin);
          }
          if (update.type === 'awareness-collect') {
            onCollect()
              .then(record => {
                if (record) {
                  this.client
                    .call('awarenessSync.collect', {
                      awareness: record,
                      collectId: update.collectId,
                    })
                    .catch(err => {
                      console.error('error feedback collected awareness', err);
                    });
                }
              })
              .catch(err => {
                console.error('error collecting awareness', err);
              });
          }
        },
      });
    return () => {
      subscription.unsubscribe();
    };
  }
}
