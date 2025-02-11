import { AutoReconnectConnection } from '../../connection';
import type { StorageOptions } from '../../storage';

export class BroadcastChannelConnection extends AutoReconnectConnection<BroadcastChannel> {
  readonly channelName = `channel:${this.opts.peer}:${this.opts.type}:${this.opts.id}`;

  constructor(private readonly opts: StorageOptions) {
    super();
  }

  override async doConnect() {
    return new BroadcastChannel(this.channelName);
  }

  override doDisconnect() {
    this.close();
  }

  private close(error?: Error) {
    this.maybeConnection?.close();
    this.setStatus('closed', error);
  }
}
