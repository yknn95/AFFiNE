import { share } from '../../../connection';
import {
  type DocRecord,
  DocStorageBase,
  type DocUpdate,
} from '../../../storage';
import { DocIDBConnection } from './db';

/**
 * @deprecated readonly
 */
export class IndexedDBV1DocStorage extends DocStorageBase {
  readonly connection = share(new DocIDBConnection());

  get db() {
    return this.connection.inner;
  }

  get name() {
    return 'idb(old)';
  }

  override async getDoc(docId: string) {
    const trx = this.db.transaction('workspace', 'readonly');
    const record = await trx.store.get(docId);

    if (!record?.updates.length) {
      return null;
    }

    if (record.updates.length === 1) {
      return {
        docId,
        bin: record.updates[0].update,
        timestamp: new Date(record.updates[0].timestamp),
      };
    }

    return {
      docId,
      bin: await this.mergeUpdates(record.updates.map(update => update.update)),
      timestamp: new Date(record.updates.at(-1)?.timestamp ?? Date.now()),
    };
  }

  protected override async getDocSnapshot() {
    return null;
  }

  override async pushDocUpdate(update: DocUpdate) {
    // no more writes to old db
    return { docId: update.docId, timestamp: new Date() };
  }

  override async deleteDoc(docId: string) {
    const trx = this.db.transaction('workspace', 'readwrite');
    await trx.store.delete(docId);
  }

  override async getDocTimestamps() {
    return {};
  }

  override async getDocTimestamp(_docId: string) {
    return null;
  }

  protected override async setDocSnapshot(): Promise<boolean> {
    return false;
  }

  protected override async getDocUpdates(): Promise<DocRecord[]> {
    return [];
  }

  protected override async markUpdatesMerged(): Promise<number> {
    return 0;
  }
}
