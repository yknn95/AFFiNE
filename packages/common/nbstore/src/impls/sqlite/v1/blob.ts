import { apis } from '@affine/electron-api';

import { DummyConnection } from '../../../connection';
import { BlobStorageBase } from '../../../storage';

/**
 * @deprecated readonly
 */
export class SqliteV1BlobStorage extends BlobStorageBase {
  override connection = new DummyConnection();

  get db() {
    if (!apis) {
      throw new Error('Not in electron context.');
    }

    return apis.db;
  }

  override async get(key: string) {
    const data: Uint8Array | null = await this.db.getBlob(
      this.spaceType,
      this.spaceId,
      key
    );

    if (!data) {
      return null;
    }

    return {
      key,
      data,
      mime: '',
      createdAt: new Date(),
    };
  }

  override async delete(key: string, permanently: boolean) {
    if (permanently) {
      await this.db.deleteBlob(this.spaceType, this.spaceId, key);
    }
  }

  override async list() {
    const keys = await this.db.getBlobKeys(this.spaceType, this.spaceId);

    return keys.map(key => ({
      key,
      mime: '',
      size: 0,
      createdAt: new Date(),
    }));
  }

  override async set() {
    // no more writes
  }
  override async release() {
    // no more writes
  }
}
