import type {
  AwarenessRecord,
  AwarenessStorage,
} from '../../storage/awareness';

export interface AwarenessSync {
  update(record: AwarenessRecord, origin?: string): Promise<void>;
  subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void;
}

export class AwarenessSyncImpl implements AwarenessSync {
  constructor(
    readonly local: AwarenessStorage,
    readonly remotes: AwarenessStorage[]
  ) {}

  async update(record: AwarenessRecord, origin?: string) {
    await Promise.all(
      [this.local, ...this.remotes].map(peer => peer.update(record, origin))
    );
  }

  subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void {
    const unsubscribes = [this.local, ...this.remotes].map(peer =>
      peer.subscribeUpdate(id, onUpdate, onCollect)
    );
    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }
}
