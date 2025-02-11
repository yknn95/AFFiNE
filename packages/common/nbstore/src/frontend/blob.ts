import type { BlobRecord, BlobStorage } from '../storage';
import type { BlobSync } from '../sync/blob';

export class BlobFrontend {
  constructor(
    readonly storage: BlobStorage,
    readonly sync?: BlobSync
  ) {}

  get(blobId: string) {
    return this.sync
      ? this.sync.downloadBlob(blobId)
      : this.storage.get(blobId);
  }

  set(blob: BlobRecord) {
    return this.sync ? this.sync.uploadBlob(blob) : this.storage.set(blob);
  }

  addPriority(_id: string, _priority: number) {
    // not support yet
  }
}
