import { parseUniversalId, SpaceStorage } from '@affine/nbstore';
import { applyUpdate, Doc as YDoc } from 'yjs';

import { SqliteBlobStorage } from './blob';
import { NativeDBConnection } from './db';
import { SqliteDocStorage } from './doc';
import { SqliteSyncStorage } from './sync';

export class SqliteSpaceStorage extends SpaceStorage {
  get connection() {
    const docStore = this.get('doc');

    if (!docStore) {
      throw new Error('doc store not found');
    }

    const connection = docStore.connection;

    if (!(connection instanceof NativeDBConnection)) {
      throw new Error('doc store connection is not a Sqlite connection');
    }

    return connection;
  }

  async getDBPath() {
    return this.connection.getDBPath();
  }

  async getWorkspaceName() {
    const docStore = this.tryGet('doc');

    if (!docStore) {
      return null;
    }

    const doc = await docStore.getDoc(docStore.spaceId);
    if (!doc) {
      return null;
    }

    const ydoc = new YDoc();
    applyUpdate(ydoc, doc.bin);
    return ydoc.getMap('meta').get('name') as string;
  }

  async checkpoint() {
    await this.connection.inner.checkpoint();
  }
}

const STORE_CACHE = new Map<string, SqliteSpaceStorage>();

export function getStorage(universalId: string) {
  return STORE_CACHE.get(universalId);
}

export async function ensureStorage(universalId: string) {
  const { peer, type, id } = parseUniversalId(universalId);
  let store = STORE_CACHE.get(universalId);

  if (!store) {
    const opts = {
      peer,
      type,
      id,
    };

    store = new SqliteSpaceStorage([
      new SqliteDocStorage(opts),
      new SqliteBlobStorage(opts),
      new SqliteSyncStorage(opts),
    ]);

    store.connect();

    await store.waitForConnected();

    STORE_CACHE.set(universalId, store);
  }

  return store;
}
