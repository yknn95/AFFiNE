import path from 'node:path';

import { DocStorage as NativeDocStorage } from '@affine/native';
import { AutoReconnectConnection, type SpaceType } from '@affine/nbstore';
import fs from 'fs-extra';

import { logger } from '../logger';
import { getSpaceDBPath } from '../workspace/meta';

export class NativeDBConnection extends AutoReconnectConnection<NativeDocStorage> {
  constructor(
    private readonly peer: string,
    private readonly type: SpaceType,
    private readonly id: string
  ) {
    super();
  }

  async getDBPath() {
    return await getSpaceDBPath(this.peer, this.type, this.id);
  }

  override get shareId(): string {
    return `sqlite:${this.peer}:${this.type}:${this.id}`;
  }

  override async doConnect() {
    const dbPath = await this.getDBPath();
    await fs.ensureDir(path.dirname(dbPath));
    const conn = new NativeDocStorage(dbPath);
    await conn.connect();
    logger.info('[nbstore] connection established', this.shareId);
    return conn;
  }

  override doDisconnect(conn: NativeDocStorage) {
    conn
      .close()
      .then(() => {
        logger.info('[nbstore] connection closed', this.shareId);
      })
      .catch(err => {
        logger.error('[nbstore] connection close failed', this.shareId, err);
      });
  }
}
