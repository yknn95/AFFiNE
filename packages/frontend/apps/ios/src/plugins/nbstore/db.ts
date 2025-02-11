import type { DocStorage } from '@affine/native';
import {
  AutoReconnectConnection,
  isValidSpaceType,
  type SpaceType,
  universalId,
} from '@affine/nbstore';

import { NativeDocStorage, NbStoreDocStorage } from './plugin';

export class NativeDBConnection extends AutoReconnectConnection<DocStorage> {
  private readonly universalId: string;

  constructor(
    private readonly peer: string,
    private readonly type: SpaceType,
    private readonly id: string
  ) {
    super();
    if (!isValidSpaceType(type)) {
      throw new TypeError(`Invalid space type: ${type}`);
    }
    this.universalId = universalId({
      peer: peer,
      type: type,
      id: id,
    });
  }

  async getDBPath() {
    const { path } = await NbStoreDocStorage.getSpaceDBPath({
      peer: this.peer,
      spaceType: this.type,
      id: this.id,
    });
    return path;
  }

  override get shareId(): string {
    return `sqlite:${this.peer}:${this.type}:${this.id}`;
  }

  override async doConnect() {
    const conn = new NativeDocStorage(this.universalId);
    await conn.connect();
    console.info('[nbstore] connection established', this.shareId);
    return conn;
  }

  override doDisconnect(conn: NativeDocStorage) {
    conn
      .close()
      .then(() => {
        console.info('[nbstore] connection closed', this.shareId);
      })
      .catch(err => {
        console.error('[nbstore] connection close failed', this.shareId, err);
      });
  }
}
