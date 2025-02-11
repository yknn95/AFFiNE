import EventEmitter2 from 'eventemitter2';

import type { AwarenessStorage } from './awareness';
import type { BlobStorage } from './blob';
import type { DocStorage } from './doc';
import type { Storage, StorageType } from './storage';
import type { SyncStorage } from './sync';

type Storages = DocStorage | BlobStorage | SyncStorage | AwarenessStorage;

export class SpaceStorage {
  protected readonly storages: Map<StorageType, Storage> = new Map();
  private readonly event = new EventEmitter2();
  private readonly disposables: Set<() => void> = new Set();

  constructor(storages: Storage[] = []) {
    this.storages = new Map(
      storages.map(storage => [storage.storageType, storage])
    );
  }

  tryGet<T extends StorageType>(
    type: T
  ): Extract<Storages, { storageType: T }> | undefined {
    return this.storages.get(type) as unknown as Extract<
      Storages,
      { storageType: T }
    >;
  }

  get<T extends StorageType>(type: T): Extract<Storages, { storageType: T }> {
    const storage = this.tryGet(type);

    if (!storage) {
      throw new Error(`Storage ${type} not registered.`);
    }

    return storage as Extract<Storages, { storageType: T }>;
  }

  connect() {
    Array.from(this.storages.values()).forEach(storage => {
      storage.connection.connect();
    });
  }

  disconnect() {
    Array.from(this.storages.values()).forEach(storage => {
      storage.connection.disconnect();
    });
  }

  async waitForConnected(signal?: AbortSignal) {
    await Promise.all(
      Array.from(this.storages.values()).map(storage =>
        storage.connection.waitForConnected(signal)
      )
    );
  }

  async destroy() {
    this.disposables.forEach(disposable => disposable());
    this.event.removeAllListeners();
    this.storages.clear();
  }
}

export * from './awareness';
export * from './blob';
export * from './doc';
export * from './history';
export * from './storage';
export * from './sync';
