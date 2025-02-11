import type { Observable } from 'rxjs';
import { combineLatest, map } from 'rxjs';

import type { DocStorage, SyncStorage } from '../../storage';
import { DocSyncPeer } from './peer';

export interface DocSyncState {
  total: number;
  syncing: number;
  retrying: boolean;
  errorMessage: string | null;
}

export interface DocSyncDocState {
  syncing: boolean;
  retrying: boolean;
  errorMessage: string | null;
}

export interface DocSync {
  readonly state$: Observable<DocSyncState>;
  docState$(docId: string): Observable<DocSyncDocState>;
  addPriority(id: string, priority: number): () => void;
}

export class DocSyncImpl implements DocSync {
  private readonly peers: DocSyncPeer[] = this.remotes.map(
    remote => new DocSyncPeer(this.local, this.sync, remote)
  );
  private abort: AbortController | null = null;

  readonly state$: Observable<DocSyncState> = combineLatest(
    this.peers.map(peer => peer.peerState$)
  ).pipe(
    map(allPeers => ({
      total: allPeers.reduce((acc, peer) => acc + peer.total, 0),
      syncing: allPeers.reduce((acc, peer) => acc + peer.syncing, 0),
      retrying: allPeers.some(peer => peer.retrying),
      errorMessage:
        allPeers.find(peer => peer.errorMessage)?.errorMessage ?? null,
    }))
  );

  constructor(
    readonly local: DocStorage,
    readonly sync: SyncStorage,
    readonly remotes: DocStorage[]
  ) {}

  docState$(docId: string): Observable<DocSyncDocState> {
    return combineLatest(this.peers.map(peer => peer.docState$(docId))).pipe(
      map(allPeers => ({
        errorMessage:
          allPeers.find(peer => peer.errorMessage)?.errorMessage ?? null,
        retrying: allPeers.some(peer => peer.retrying),
        syncing: allPeers.some(peer => peer.syncing),
      }))
    );
  }

  start() {
    if (this.abort) {
      this.abort.abort();
    }
    const abort = new AbortController();
    this.abort = abort;
    Promise.allSettled(
      this.peers.map(peer => peer.mainLoop(abort.signal))
    ).catch(error => {
      console.error(error);
    });
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
  }

  addPriority(id: string, priority: number) {
    const undo = this.peers.map(peer => peer.addPriority(id, priority));
    return () => undo.forEach(fn => fn());
  }
}
