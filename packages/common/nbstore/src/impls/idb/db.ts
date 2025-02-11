import { type IDBPDatabase, openDB } from 'idb';

import { AutoReconnectConnection } from '../../connection';
import type { StorageOptions } from '../../storage';
import { type DocStorageSchema, migrator } from './schema';

export class IDBConnection extends AutoReconnectConnection<{
  db: IDBPDatabase<DocStorageSchema>;
  channel: BroadcastChannel;
}> {
  readonly dbName = `${this.opts.peer}:${this.opts.type}:${this.opts.id}`;

  override get shareId() {
    return `idb(${migrator.version}):${this.dbName}`;
  }

  constructor(private readonly opts: StorageOptions) {
    super();
  }

  override async doConnect() {
    return {
      db: await openDB<DocStorageSchema>(this.dbName, migrator.version, {
        upgrade: migrator.migrate,
        blocking: () => {
          // if, for example, an tab with newer version is opened, this function will be called.
          // we should close current connection to allow the new version to upgrade the db.
          this.setStatus(
            'closed',
            new Error('Blocking a new version. Closing the connection.')
          );
        },
        blocked: () => {
          // fallback to retry auto retry
          this.setStatus('error', new Error('Blocked by other tabs.'));
        },
      }),
      channel: new BroadcastChannel('idb:' + this.dbName),
    };
  }

  override doDisconnect(db: {
    db: IDBPDatabase<DocStorageSchema>;
    channel: BroadcastChannel;
  }) {
    db.channel.close();
    db.db.close();
  }
}
