import { type Storage, StorageBase, type StorageOptions } from './storage';

export interface AwarenessStorageOptions extends StorageOptions {}

export type AwarenessRecord = {
  docId: string;
  bin: Uint8Array;
};

export interface AwarenessStorage extends Storage {
  readonly storageType: 'awareness';

  /**
   * Update the awareness record.
   *
   * @param origin - Internal identifier to recognize the source in the "update" event. Will not be stored or transferred.
   */
  update(record: AwarenessRecord, origin?: string): Promise<void>;
  subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void;
}

export abstract class AwarenessStorageBase<
    Options extends AwarenessStorageOptions = AwarenessStorageOptions,
  >
  extends StorageBase<Options>
  implements AwarenessStorage
{
  override readonly storageType = 'awareness';

  abstract update(record: AwarenessRecord, origin?: string): Promise<void>;

  abstract subscribeUpdate(
    id: string,
    onUpdate: (update: AwarenessRecord, origin?: string) => void,
    onCollect: () => Promise<AwarenessRecord | null>
  ): () => void;
}
