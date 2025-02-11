export interface Blob {
  key: string;
  // base64 encoded data
  data: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface SetBlob {
  key: string;
  // base64 encoded data
  data: string;
  mime: string;
}

export interface ListedBlob {
  key: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface DocClock {
  docId: string;
  timestamp: number;
}

export interface NbStorePlugin {
  getSpaceDBPath: (options: {
    peer: string;
    spaceType: string;
    id: string;
  }) => Promise<{ path: string }>;
  create: (options: { id: string; path: string }) => Promise<void>;
  connect: (options: { id: string }) => Promise<void>;
  close: (options: { id: string }) => Promise<void>;
  isClosed: (options: { id: string }) => Promise<{ isClosed: boolean }>;
  checkpoint: (options: { id: string }) => Promise<void>;
  validate: (options: { id: string }) => Promise<{ isValidate: boolean }>;

  setSpaceId: (options: { id: string; spaceId: string }) => Promise<void>;
  pushUpdate: (options: {
    id: string;
    docId: string;
    data: string;
  }) => Promise<{ timestamp: number }>;
  getDocSnapshot: (options: { id: string; docId: string }) => Promise<
    | {
        docId: string;
        // base64 encoded data
        data: string;
        timestamp: number;
      }
    | undefined
  >;
  setDocSnapshot: (options: {
    id: string;
    docId: string;
    data: string;
  }) => Promise<{ success: boolean }>;
  getDocUpdates: (options: { id: string; docId: string }) => Promise<
    {
      docId: string;
      createdAt: number;
      // base64 encoded data
      data: string;
    }[]
  >;
  markUpdatesMerged: (options: {
    id: string;
    docId: string;
    timestamps: number[];
  }) => Promise<{ count: number }>;
  deleteDoc: (options: { id: string; docId: string }) => Promise<void>;
  getDocClocks: (options: { id: string; after: number }) => Promise<
    {
      docId: string;
      timestamp: number;
    }[]
  >;
  getDocClock: (options: { id: string; docId: string }) => Promise<
    | {
        docId: string;
        timestamp: number;
      }
    | undefined
  >;
  getBlob: (options: { id: string; key: string }) => Promise<Blob | null>;
  setBlob: (options: { id: string } & SetBlob) => Promise<void>;
  deleteBlob: (options: {
    id: string;
    key: string;
    permanently: boolean;
  }) => Promise<void>;
  releaseBlobs: (options: { id: string }) => Promise<void>;
  listBlobs: (options: { id: string }) => Promise<Array<ListedBlob>>;
  getPeerRemoteClocks: (options: {
    id: string;
    peer: string;
  }) => Promise<Array<DocClock>>;
  getPeerRemoteClock: (options: {
    id: string;
    peer: string;
    docId: string;
  }) => Promise<DocClock>;
  setPeerRemoteClock: (options: {
    id: string;
    peer: string;
    docId: string;
    clock: number;
  }) => Promise<void>;
  getPeerPushedClocks: (options: {
    id: string;
    peer: string;
  }) => Promise<Array<DocClock>>;
  getPeerPushedClock: (options: {
    id: string;
    peer: string;
    docId: string;
  }) => Promise<DocClock>;
  setPeerPushedClock: (options: {
    id: string;
    peer: string;
    docId: string;
    clock: number;
  }) => Promise<void>;
  getPeerPulledRemoteClocks: (options: {
    id: string;
    peer: string;
  }) => Promise<Array<DocClock>>;
  getPeerPulledRemoteClock: (options: {
    id: string;
    peer: string;
    docId: string;
  }) => Promise<DocClock>;
  setPeerPulledRemoteClock: (options: {
    id: string;
    peer: string;
    docId: string;
    clock: number;
  }) => Promise<void>;
  clearClocks: (options: { id: string }) => Promise<void>;
}
