import {
  type BlobRecord,
  type DocClock,
  type DocUpdate,
} from '@affine/nbstore';

import { ensureStorage, getStorage } from './storage';

export const nbstoreHandlers = {
  connect: async (id: string) => {
    await ensureStorage(id);
  },

  close: async (id: string) => {
    const store = getStorage(id);

    if (store) {
      store.disconnect();
      // The store may be shared with other tabs, so we don't delete it from cache
      // the underlying connection will handle the close correctly
      // STORE_CACHE.delete(`${spaceType}:${spaceId}`);
    }
  },

  pushDocUpdate: async (id: string, update: DocUpdate) => {
    const store = await ensureStorage(id);
    return store.get('doc').pushDocUpdate(update);
  },

  getDoc: async (id: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('doc').getDoc(docId);
  },

  deleteDoc: async (id: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('doc').deleteDoc(docId);
  },

  getDocTimestamps: async (id: string, after?: Date) => {
    const store = await ensureStorage(id);
    return store.get('doc').getDocTimestamps(after);
  },

  getDocTimestamp: async (id: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('doc').getDocTimestamp(docId);
  },

  setBlob: async (id: string, blob: BlobRecord) => {
    const store = await ensureStorage(id);
    return store.get('blob').set(blob);
  },

  getBlob: async (id: string, key: string) => {
    const store = await ensureStorage(id);
    return store.get('blob').get(key);
  },

  deleteBlob: async (id: string, key: string, permanently: boolean) => {
    const store = await ensureStorage(id);
    return store.get('blob').delete(key, permanently);
  },

  listBlobs: async (id: string) => {
    const store = await ensureStorage(id);
    return store.get('blob').list();
  },

  releaseBlobs: async (id: string) => {
    const store = await ensureStorage(id);
    return store.get('blob').release();
  },

  getPeerRemoteClocks: async (id: string, peer: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerRemoteClocks(peer);
  },

  getPeerRemoteClock: async (id: string, peer: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerRemoteClock(peer, docId);
  },

  setPeerRemoteClock: async (id: string, peer: string, clock: DocClock) => {
    const store = await ensureStorage(id);
    return store.get('sync').setPeerRemoteClock(peer, clock);
  },

  getPeerPulledRemoteClocks: async (id: string, peer: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerPulledRemoteClocks(peer);
  },

  getPeerPulledRemoteClock: async (id: string, peer: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerPulledRemoteClock(peer, docId);
  },

  setPeerPulledRemoteClock: async (
    id: string,
    peer: string,
    clock: DocClock
  ) => {
    const store = await ensureStorage(id);
    return store.get('sync').setPeerPulledRemoteClock(peer, clock);
  },

  getPeerPushedClocks: async (id: string, peer: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerPushedClocks(peer);
  },

  getPeerPushedClock: async (id: string, peer: string, docId: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').getPeerPushedClock(peer, docId);
  },

  setPeerPushedClock: async (id: string, peer: string, clock: DocClock) => {
    const store = await ensureStorage(id);
    return store.get('sync').setPeerPushedClock(peer, clock);
  },

  clearClocks: async (id: string) => {
    const store = await ensureStorage(id);
    return store.get('sync').clearClocks();
  },
};
