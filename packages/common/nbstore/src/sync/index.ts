import { combineLatest, map, type Observable, of } from 'rxjs';

import type {
  AwarenessStorage,
  BlobStorage,
  DocStorage,
  SpaceStorage,
} from '../storage';
import { AwarenessSyncImpl } from './awareness';
import { BlobSyncImpl } from './blob';
import { DocSyncImpl, type DocSyncState } from './doc';

export interface SyncState {
  doc?: DocSyncState;
}

export class Sync {
  readonly doc: DocSyncImpl | null;
  readonly blob: BlobSyncImpl | null;
  readonly awareness: AwarenessSyncImpl | null;

  readonly state$: Observable<SyncState>;

  constructor(
    readonly local: SpaceStorage,
    readonly peers: SpaceStorage[]
  ) {
    const doc = local.tryGet('doc');
    const blob = local.tryGet('blob');
    const sync = local.tryGet('sync');
    const awareness = local.tryGet('awareness');

    this.doc =
      doc && sync
        ? new DocSyncImpl(
            doc,
            sync,
            peers
              .map(peer => peer.tryGet('doc'))
              .filter((v): v is DocStorage => !!v)
          )
        : null;
    this.blob = blob
      ? new BlobSyncImpl(
          blob,
          peers
            .map(peer => peer.tryGet('blob'))
            .filter((v): v is BlobStorage => !!v)
        )
      : null;
    this.awareness = awareness
      ? new AwarenessSyncImpl(
          awareness,
          peers
            .map(peer => peer.tryGet('awareness'))
            .filter((v): v is AwarenessStorage => !!v)
        )
      : null;

    this.state$ = combineLatest([this.doc?.state$ ?? of(undefined)]).pipe(
      map(([doc]) => ({ doc }))
    );
  }

  start() {
    this.doc?.start();
    this.blob?.start();
  }

  stop() {
    this.doc?.stop();
    this.blob?.stop();
  }
}
