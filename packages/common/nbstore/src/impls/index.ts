import type { Storage } from '../storage';
import { BroadcastChannelAwarenessStorage } from './broadcast-channel/awareness';
import {
  CloudAwarenessStorage,
  CloudBlobStorage,
  CloudDocStorage,
} from './cloud';
import {
  IndexedDBBlobStorage,
  IndexedDBDocStorage,
  IndexedDBSyncStorage,
} from './idb';
import { IndexedDBV1BlobStorage, IndexedDBV1DocStorage } from './idb/v1';

type StorageConstructor = new (...args: any[]) => Storage;

const idb: StorageConstructor[] = [
  IndexedDBDocStorage,
  IndexedDBBlobStorage,
  IndexedDBSyncStorage,
  BroadcastChannelAwarenessStorage,
];

const idbv1: StorageConstructor[] = [
  IndexedDBV1DocStorage,
  IndexedDBV1BlobStorage,
];

const cloud: StorageConstructor[] = [
  CloudDocStorage,
  CloudBlobStorage,
  CloudAwarenessStorage,
];

export const storages: StorageConstructor[] = cloud.concat(idbv1, idb);

const AvailableStorageImplementations = storages.reduce(
  (acc, curr) => {
    acc[curr.name] = curr;
    return acc;
  },
  {} as Record<string, StorageConstructor>
);

export const getAvailableStorageImplementations = (name: string) => {
  return AvailableStorageImplementations[name];
};
