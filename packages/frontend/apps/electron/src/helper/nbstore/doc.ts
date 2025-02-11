import {
  type DocClocks,
  type DocRecord,
  DocStorageBase,
  type DocUpdate,
  share,
} from '@affine/nbstore';

import { NativeDBConnection } from './db';

export class SqliteDocStorage extends DocStorageBase {
  override connection = share(
    new NativeDBConnection(this.peer, this.spaceType, this.spaceId)
  );

  get db() {
    return this.connection.inner;
  }

  override async pushDocUpdate(update: DocUpdate) {
    const timestamp = await this.db.pushUpdate(update.docId, update.bin);

    return { docId: update.docId, timestamp };
  }

  override async deleteDoc(docId: string) {
    await this.db.deleteDoc(docId);
  }

  override async getDocTimestamps(after?: Date) {
    const clocks = await this.db.getDocClocks(after);

    return clocks.reduce((ret, cur) => {
      ret[cur.docId] = cur.timestamp;
      return ret;
    }, {} as DocClocks);
  }

  override async getDocTimestamp(docId: string) {
    return this.db.getDocClock(docId);
  }

  protected override async getDocSnapshot(docId: string) {
    const snapshot = await this.db.getDocSnapshot(docId);

    if (!snapshot) {
      return null;
    }

    return {
      docId,
      bin: snapshot.data,
      timestamp: snapshot.timestamp,
    };
  }

  protected override async setDocSnapshot(
    snapshot: DocRecord
  ): Promise<boolean> {
    return this.db.setDocSnapshot({
      docId: snapshot.docId,
      data: Buffer.from(snapshot.bin),
      timestamp: new Date(snapshot.timestamp),
    });
  }

  protected override async getDocUpdates(docId: string) {
    return this.db.getDocUpdates(docId).then(updates =>
      updates.map(update => ({
        docId,
        bin: update.data,
        timestamp: update.createdAt,
      }))
    );
  }

  protected override markUpdatesMerged(docId: string, updates: DocRecord[]) {
    return this.db.markUpdatesMerged(
      docId,
      updates.map(update => update.timestamp)
    );
  }
}
