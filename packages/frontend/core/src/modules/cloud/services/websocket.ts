import { OnEvent, Service } from '@toeverything/infra';
import { Manager } from 'socket.io-client';

import { ApplicationStarted } from '../../lifecycle';
import { AccountChanged } from '../events/account-changed';
import type { WebSocketAuthProvider } from '../provider/websocket-auth';
import type { AuthService } from './auth';
import type { ServerService } from './server';

@OnEvent(AccountChanged, e => e.update)
@OnEvent(ApplicationStarted, e => e.update)
export class WebSocketService extends Service {
  ioManager: Manager = new Manager(`${this.serverService.server.baseUrl}/`, {
    autoConnect: false,
    transports: ['websocket'],
    secure: location.protocol === 'https:',
  });
  socket = this.ioManager.socket('/', {
    auth: this.webSocketAuthProvider
      ? cb => {
          this.webSocketAuthProvider
            ?.getAuthToken(`${this.serverService.server.baseUrl}/`)
            .then(v => {
              cb(v ?? {});
            })
            .catch(e => {
              console.error('Failed to get auth token for websocket', e);
            });
        }
      : undefined,
  });
  refCount = 0;

  constructor(
    private readonly serverService: ServerService,
    private readonly authService: AuthService,
    private readonly webSocketAuthProvider?: WebSocketAuthProvider
  ) {
    super();
  }

  /**
   * Connect socket, with automatic connect and reconnect logic.
   * External code should not call `socket.connect()` or `socket.disconnect()` manually.
   * When socket is no longer needed, call `dispose()` to clean up resources.
   */
  connect() {
    this.refCount++;
    this.update();
    return {
      socket: this.socket,
      dispose: () => {
        this.refCount--;
        this.update();
      },
    };
  }

  update(): void {
    if (this.authService.session.account$.value && this.refCount > 0) {
      this.socket.connect();
    } else {
      this.socket.disconnect();
    }
  }
}
