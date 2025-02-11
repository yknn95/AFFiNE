import { share } from '../../connection';
import { type DocClock, DocStorageBase, type DocUpdate } from '../../storage';
import { NativeDBConnection } from './db';

export class SqliteDocStorage extends DocStorageBase {
  override connection = share(
    new NativeDBConnection(this.peer, this.spaceType, this.spaceId)
  );

  get db() {
    return this.connection.apis;
  }

  override async getDoc(docId: string) {
    return this.db.getDoc(docId);
  }

  override async pushDocUpdate(update: DocUpdate) {
    return this.db.pushDocUpdate(update);
  }

  override async deleteDoc(docId: string) {
    return this.db.deleteDoc(docId);
  }

  override async getDocTimestamps(after?: Date) {
    return this.db.getDocTimestamps(after ? new Date(after) : undefined);
  }

  override getDocTimestamp(docId: string): Promise<DocClock | null> {
    return this.db.getDocTimestamp(docId);
  }

  protected override async getDocSnapshot() {
    // handled in db
    // see electron/src/helper/nbstore/doc.ts
    return null;
  }

  protected override async setDocSnapshot(): Promise<boolean> {
    // handled in db
    return true;
  }

  protected override async getDocUpdates() {
    // handled in db
    return [];
  }

  protected override markUpdatesMerged() {
    // handled in db
    return Promise.resolve(0);
  }
}
