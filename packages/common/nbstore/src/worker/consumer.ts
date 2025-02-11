import type { OpConsumer } from '@toeverything/infra/op';
import { Observable } from 'rxjs';

import { getAvailableStorageImplementations } from '../impls';
import { SpaceStorage, type StorageOptions } from '../storage';
import type { AwarenessRecord } from '../storage/awareness';
import { Sync } from '../sync';
import type { WorkerOps } from './ops';

export class WorkerConsumer {
  private remotes: SpaceStorage[] = [];
  private local: SpaceStorage | null = null;
  private sync: Sync | null = null;

  get ensureLocal() {
    if (!this.local) {
      throw new Error('Not initialized');
    }
    return this.local;
  }

  get ensureSync() {
    if (!this.sync) {
      throw new Error('Not initialized');
    }
    return this.sync;
  }

  get docStorage() {
    return this.ensureLocal.get('doc');
  }

  get docSync() {
    const docSync = this.ensureSync.doc;
    if (!docSync) {
      throw new Error('Doc sync not initialized');
    }
    return docSync;
  }

  get blobStorage() {
    return this.ensureLocal.get('blob');
  }

  get blobSync() {
    const blobSync = this.ensureSync.blob;
    if (!blobSync) {
      throw new Error('Blob sync not initialized');
    }
    return blobSync;
  }

  get syncStorage() {
    return this.ensureLocal.get('sync');
  }

  get awarenessStorage() {
    return this.ensureLocal.get('awareness');
  }

  get awarenessSync() {
    const awarenessSync = this.ensureSync.awareness;
    if (!awarenessSync) {
      throw new Error('Awareness sync not initialized');
    }
    return awarenessSync;
  }

  constructor(private readonly consumer: OpConsumer<WorkerOps>) {}

  listen() {
    this.registerHandlers();
    this.consumer.listen();
  }

  async init(init: {
    local: { name: string; opts: StorageOptions }[];
    remotes: { name: string; opts: StorageOptions }[][];
  }) {
    this.local = new SpaceStorage(
      init.local.map(opt => {
        const Storage = getAvailableStorageImplementations(opt.name);
        return new Storage(opt.opts);
      })
    );
    this.remotes = init.remotes.map(opts => {
      return new SpaceStorage(
        opts.map(opt => {
          const Storage = getAvailableStorageImplementations(opt.name);
          return new Storage(opt.opts);
        })
      );
    });
    this.sync = new Sync(this.local, this.remotes);
    this.local.connect();
    for (const remote of this.remotes) {
      remote.connect();
    }
    this.sync.start();
  }

  async destroy() {
    this.sync?.stop();
    this.local?.disconnect();
    await this.local?.destroy();
    for (const remote of this.remotes) {
      remote.disconnect();
      await remote.destroy();
    }
  }

  private registerHandlers() {
    const collectJobs = new Map<
      string,
      (awareness: AwarenessRecord | null) => void
    >();
    let collectId = 0;
    this.consumer.registerAll({
      'worker.init': this.init.bind(this),
      'worker.destroy': this.destroy.bind(this),
      'docStorage.getDoc': (docId: string) => this.docStorage.getDoc(docId),
      'docStorage.getDocDiff': ({ docId, state }) =>
        this.docStorage.getDocDiff(docId, state),
      'docStorage.pushDocUpdate': ({ update, origin }) =>
        this.docStorage.pushDocUpdate(update, origin),
      'docStorage.getDocTimestamps': after =>
        this.docStorage.getDocTimestamps(after ?? undefined),
      'docStorage.getDocTimestamp': docId =>
        this.docStorage.getDocTimestamp(docId),
      'docStorage.deleteDoc': (docId: string) =>
        this.docStorage.deleteDoc(docId),
      'docStorage.subscribeDocUpdate': () =>
        new Observable(subscriber => {
          return this.docStorage.subscribeDocUpdate((update, origin) => {
            subscriber.next({ update, origin });
          });
        }),
      'docStorage.waitForConnected': () =>
        new Observable(subscriber => {
          const abortController = new AbortController();
          this.docStorage.connection
            .waitForConnected(abortController.signal)
            .then(() => {
              subscriber.next(true);
              subscriber.complete();
            })
            .catch(error => {
              subscriber.error(error);
            });
          return () => abortController.abort();
        }),
      'blobStorage.getBlob': key => this.blobStorage.get(key),
      'blobStorage.setBlob': blob => this.blobStorage.set(blob),
      'blobStorage.deleteBlob': ({ key, permanently }) =>
        this.blobStorage.delete(key, permanently),
      'blobStorage.releaseBlobs': () => this.blobStorage.release(),
      'blobStorage.listBlobs': () => this.blobStorage.list(),
      'syncStorage.clearClocks': () => this.syncStorage.clearClocks(),
      'syncStorage.getPeerPulledRemoteClock': ({ peer, docId }) =>
        this.syncStorage.getPeerPulledRemoteClock(peer, docId),
      'syncStorage.getPeerPulledRemoteClocks': ({ peer }) =>
        this.syncStorage.getPeerPulledRemoteClocks(peer),
      'syncStorage.setPeerPulledRemoteClock': ({ peer, clock }) =>
        this.syncStorage.setPeerPulledRemoteClock(peer, clock),
      'syncStorage.getPeerRemoteClock': ({ peer, docId }) =>
        this.syncStorage.getPeerRemoteClock(peer, docId),
      'syncStorage.getPeerRemoteClocks': ({ peer }) =>
        this.syncStorage.getPeerRemoteClocks(peer),
      'syncStorage.setPeerRemoteClock': ({ peer, clock }) =>
        this.syncStorage.setPeerRemoteClock(peer, clock),
      'syncStorage.getPeerPushedClock': ({ peer, docId }) =>
        this.syncStorage.getPeerPushedClock(peer, docId),
      'syncStorage.getPeerPushedClocks': ({ peer }) =>
        this.syncStorage.getPeerPushedClocks(peer),
      'syncStorage.setPeerPushedClock': ({ peer, clock }) =>
        this.syncStorage.setPeerPushedClock(peer, clock),
      'awarenessStorage.update': ({ awareness, origin }) =>
        this.awarenessStorage.update(awareness, origin),
      'awarenessStorage.subscribeUpdate': docId =>
        new Observable(subscriber => {
          return this.awarenessStorage.subscribeUpdate(
            docId,
            (update, origin) => {
              subscriber.next({
                type: 'awareness-update',
                awareness: update,
                origin,
              });
            },
            () => {
              const currentCollectId = collectId++;
              const promise = new Promise<AwarenessRecord | null>(resolve => {
                collectJobs.set(currentCollectId.toString(), awareness => {
                  resolve(awareness);
                  collectJobs.delete(currentCollectId.toString());
                });
              });
              return promise;
            }
          );
        }),
      'awarenessStorage.collect': ({ collectId, awareness }) =>
        collectJobs.get(collectId)?.(awareness),
      'docSync.state': () =>
        new Observable(subscriber => {
          const subscription = this.docSync.state$.subscribe(state => {
            subscriber.next(state);
          });
          return () => subscription.unsubscribe();
        }),
      'docSync.docState': docId =>
        new Observable(subscriber => {
          const subscription = this.docSync
            .docState$(docId)
            .subscribe(state => {
              subscriber.next(state);
            });
          return () => subscription.unsubscribe();
        }),
      'docSync.addPriority': ({ docId, priority }) =>
        new Observable(() => {
          const undo = this.docSync.addPriority(docId, priority);
          return () => undo();
        }),
      'blobSync.downloadBlob': key => this.blobSync.downloadBlob(key),
      'blobSync.uploadBlob': blob => this.blobSync.uploadBlob(blob),
      'awarenessSync.update': ({ awareness, origin }) =>
        this.awarenessSync.update(awareness, origin),
      'awarenessSync.subscribeUpdate': docId =>
        new Observable(subscriber => {
          return this.awarenessStorage.subscribeUpdate(
            docId,
            (update, origin) => {
              subscriber.next({
                type: 'awareness-update',
                awareness: update,
                origin,
              });
            },
            () => {
              const currentCollectId = collectId++;
              const promise = new Promise<AwarenessRecord | null>(resolve => {
                collectJobs.set(currentCollectId.toString(), awareness => {
                  resolve(awareness);
                  collectJobs.delete(currentCollectId.toString());
                });
              });
              return promise;
            }
          );
        }),
      'awarenessSync.collect': ({ collectId, awareness }) =>
        collectJobs.get(collectId)?.(awareness),
    });
  }
}
