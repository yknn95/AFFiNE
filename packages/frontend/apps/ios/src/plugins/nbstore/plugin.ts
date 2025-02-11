import {
  base64ToUint8Array,
  uint8ArrayToBase64,
} from '@affine/core/modules/workspace-engine';
import {
  type Blob,
  type DocClock,
  type DocRecord,
  type DocStorage,
  type DocUpdate,
  type ListedBlob,
} from '@affine/native';
import { registerPlugin } from '@capacitor/core';

import type { NbStorePlugin } from './definitions';

export const NbStoreDocStorage =
  registerPlugin<NbStorePlugin>('NbStoreDocStorage');

export interface SetBlob {
  key: string;
  data: Uint8Array;
  mime: string;
}

export class NativeDocStorage implements DocStorage {
  constructor(private readonly universalId: string) {}

  /** Initialize the database and run migrations. */
  connect(): Promise<void> {
    return NbStoreDocStorage.connect({
      id: this.universalId,
    });
  }

  close(): Promise<void> {
    return NbStoreDocStorage.close({
      id: this.universalId,
    });
  }

  get isClosed(): Promise<boolean> {
    return NbStoreDocStorage.isClosed({
      id: this.universalId,
    }).then(result => result.isClosed);
  }
  /**
   * Flush the WAL file to the database file.
   * See https://www.sqlite.org/pragma.html#pragma_wal_checkpoint:~:text=PRAGMA%20schema.wal_checkpoint%3B
   */
  checkpoint(): Promise<void> {
    return NbStoreDocStorage.checkpoint({
      id: this.universalId,
    });
  }

  validate(): Promise<boolean> {
    return NbStoreDocStorage.validate({
      id: this.universalId,
    }).then(result => result.isValidate);
  }

  setSpaceId(spaceId: string): Promise<void> {
    return NbStoreDocStorage.setSpaceId({
      id: this.universalId,
      spaceId,
    });
  }

  async pushUpdate(docId: string, update: Uint8Array): Promise<Date> {
    return NbStoreDocStorage.pushUpdate({
      id: this.universalId,
      docId,
      data: await uint8ArrayToBase64(update),
    }).then(result => new Date(result.timestamp));
  }

  getDocSnapshot(docId: string): Promise<DocRecord | null> {
    return NbStoreDocStorage.getDocSnapshot({
      id: this.universalId,
      docId,
    }).then(result => {
      if (result) {
        return {
          ...result,
          data: base64ToUint8Array(result.data),
          timestamp: new Date(result.timestamp),
        };
      }
      return null;
    });
  }

  async setDocSnapshot(snapshot: DocRecord): Promise<boolean> {
    return NbStoreDocStorage.setDocSnapshot({
      id: this.universalId,
      docId: snapshot.docId,
      data: await uint8ArrayToBase64(snapshot.data),
    }).then(result => result.success);
  }

  getDocUpdates(docId: string): Promise<Array<DocUpdate>> {
    return NbStoreDocStorage.getDocUpdates({
      id: this.universalId,
      docId,
    }).then(result =>
      result.map(update => ({
        ...update,
        data: base64ToUint8Array(update.data),
        createdAt: new Date(update.createdAt),
      }))
    );
  }

  markUpdatesMerged(docId: string, updates: Array<Date>): Promise<number> {
    return NbStoreDocStorage.markUpdatesMerged({
      id: this.universalId,
      docId,
      timestamps: updates.map(date => date.getTime()),
    }).then(result => result.count);
  }

  deleteDoc(docId: string): Promise<void> {
    return NbStoreDocStorage.deleteDoc({
      id: this.universalId,
      docId,
    });
  }

  getDocClocks(after: Date): Promise<Array<DocClock>> {
    return NbStoreDocStorage.getDocClocks({
      id: this.universalId,
      after: after.getTime(),
    }).then(result =>
      result.map(clock => ({
        ...clock,
        timestamp: new Date(clock.timestamp),
      }))
    );
  }

  getDocClock(docId: string): Promise<DocClock | null> {
    return NbStoreDocStorage.getDocClock({
      id: this.universalId,
      docId,
    }).then(result => {
      if (result) {
        return {
          ...result,
          timestamp: new Date(result.timestamp),
        };
      }
      return null;
    });
  }

  getBlob(key: string): Promise<Blob | null> {
    return NbStoreDocStorage.getBlob({
      id: this.universalId,
      key,
    }).then(result => {
      if (result) {
        return {
          ...result,
          data: base64ToUint8Array(result.data),
          createdAt: new Date(result.createdAt),
        };
      }
      return null;
    });
  }

  async setBlob(blob: SetBlob): Promise<void> {
    return NbStoreDocStorage.setBlob({
      id: this.universalId,
      key: blob.key,
      data: await uint8ArrayToBase64(blob.data),
      mime: blob.mime,
    });
  }

  deleteBlob(key: string, permanently: boolean): Promise<void> {
    return NbStoreDocStorage.deleteBlob({
      id: this.universalId,
      key,
      permanently,
    });
  }

  releaseBlobs(): Promise<void> {
    return NbStoreDocStorage.releaseBlobs({
      id: this.universalId,
    });
  }

  async listBlobs(): Promise<Array<ListedBlob>> {
    return (
      await NbStoreDocStorage.listBlobs({
        id: this.universalId,
      })
    ).map(blob => ({
      ...blob,
      createdAt: new Date(blob.createdAt),
    }));
  }

  getPeerRemoteClocks(peer: string): Promise<Array<DocClock>> {
    return NbStoreDocStorage.getPeerRemoteClocks({
      id: this.universalId,
      peer,
    }).then(result =>
      result.map(clock => ({
        ...clock,
        timestamp: new Date(clock.timestamp),
      }))
    );
  }

  getPeerRemoteClock(peer: string, docId: string): Promise<DocClock> {
    return NbStoreDocStorage.getPeerRemoteClock({
      id: this.universalId,
      peer,
      docId,
    }).then(result => ({
      ...result,
      timestamp: new Date(result.timestamp),
    }));
  }

  setPeerRemoteClock(peer: string, docId: string, clock: Date): Promise<void> {
    return NbStoreDocStorage.setPeerRemoteClock({
      id: this.universalId,
      peer,
      docId,
      clock: clock.getTime(),
    });
  }

  getPeerPulledRemoteClocks(peer: string): Promise<Array<DocClock>> {
    return NbStoreDocStorage.getPeerPulledRemoteClocks({
      id: this.universalId,
      peer,
    }).then(result =>
      result.map(clock => ({
        ...clock,
        timestamp: new Date(clock.timestamp),
      }))
    );
  }

  getPeerPulledRemoteClock(peer: string, docId: string): Promise<DocClock> {
    return NbStoreDocStorage.getPeerPulledRemoteClock({
      id: this.universalId,
      peer,
      docId,
    }).then(result => ({
      ...result,
      timestamp: new Date(result.timestamp),
    }));
  }

  setPeerPulledRemoteClock(
    peer: string,
    docId: string,
    clock: Date
  ): Promise<void> {
    return NbStoreDocStorage.setPeerPulledRemoteClock({
      id: this.universalId,
      peer,
      docId,
      clock: clock.getTime(),
    });
  }

  getPeerPushedClocks(peer: string): Promise<Array<DocClock>> {
    return NbStoreDocStorage.getPeerPushedClocks({
      id: this.universalId,
      peer,
    }).then(result =>
      result.map(clock => ({
        ...clock,
        timestamp: new Date(clock.timestamp),
      }))
    );
  }

  getPeerPushedClock(peer: string, docId: string): Promise<DocClock> {
    return NbStoreDocStorage.getPeerPushedClock({
      id: this.universalId,
      peer,
      docId,
    }).then(result => ({
      ...result,
      timestamp: new Date(result.timestamp),
    }));
  }

  setPeerPushedClock(peer: string, docId: string, clock: Date): Promise<void> {
    return NbStoreDocStorage.setPeerPushedClock({
      id: this.universalId,
      peer,
      docId,
      clock: clock.getTime(),
    });
  }

  clearClocks(): Promise<void> {
    return NbStoreDocStorage.clearClocks({
      id: this.universalId,
    });
  }
}
