import { share } from '../../connection';
import { BasicSyncStorage, type DocClock } from '../../storage';
import { NativeDBConnection } from './db';

export class SqliteSyncStorage extends BasicSyncStorage {
  override connection = share(
    new NativeDBConnection(this.peer, this.spaceType, this.spaceId)
  );

  get db() {
    return this.connection.apis;
  }

  override async getPeerRemoteClocks(peer: string) {
    return this.db.getPeerRemoteClocks(peer);
  }

  override async getPeerRemoteClock(peer: string, docId: string) {
    return this.db.getPeerRemoteClock(peer, docId);
  }

  override async setPeerRemoteClock(peer: string, clock: DocClock) {
    await this.db.setPeerRemoteClock(peer, clock);
  }

  override async getPeerPulledRemoteClocks(peer: string) {
    return this.db.getPeerPulledRemoteClocks(peer);
  }

  override async getPeerPulledRemoteClock(peer: string, docId: string) {
    return this.db.getPeerPulledRemoteClock(peer, docId);
  }

  override async setPeerPulledRemoteClock(peer: string, clock: DocClock) {
    await this.db.setPeerPulledRemoteClock(peer, clock);
  }

  override async getPeerPushedClocks(peer: string) {
    return this.db.getPeerPushedClocks(peer);
  }

  override async getPeerPushedClock(peer: string, docId: string) {
    return this.db.getPeerPushedClock(peer, docId);
  }

  override async setPeerPushedClock(peer: string, clock: DocClock) {
    await this.db.setPeerPushedClock(peer, clock);
  }

  override async clearClocks() {
    await this.db.clearClocks();
  }
}
