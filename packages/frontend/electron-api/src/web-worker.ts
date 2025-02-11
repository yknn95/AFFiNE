import { AsyncCall, type EventBasedChannel } from 'async-call-rpc';

import type { ClientHandler } from '.';

const WORKER_PORT_MESSAGE_TYPE = 'electron-api-port';

// connect web worker to preload, so that the web worker can use the electron APIs
export function connectWebWorker(worker: Worker) {
  const { portId, cleanup } = (globalThis as any).__requestWebWorkerPort();

  const portMessageListener = (event: MessageEvent) => {
    if (
      event.data.type === 'electron:request-api-port' &&
      event.data.portId === portId
    ) {
      const [port] = event.data.ports as MessagePort[];

      // worker should be ready to receive message
      worker.postMessage(
        {
          type: WORKER_PORT_MESSAGE_TYPE,
          ports: [port],
        },
        [port]
      );
    }
  };

  window.addEventListener('message', portMessageListener);

  return () => {
    window.removeEventListener('message', portMessageListener);
    cleanup();
  };
}

const createMessagePortChannel = (port: MessagePort): EventBasedChannel => {
  return {
    on(listener) {
      port.onmessage = e => {
        listener(e.data);
      };
      port.start();
      return () => {
        port.onmessage = null;
        try {
          port.close();
        } catch (err) {
          console.error('[worker] close port error', err);
        }
      };
    },
    send(data) {
      port.postMessage(data);
    },
  };
};

// get the electron APIs for the web worker (should be called in the web worker)
export function getElectronAPIs(): ClientHandler {
  const { promise, resolve } = Promise.withResolvers<MessagePort>();
  globalThis.addEventListener('message', event => {
    if (event.data.type === WORKER_PORT_MESSAGE_TYPE) {
      const [port] = event.ports;
      resolve(port);
    }
  });

  const rpc = AsyncCall<Record<string, any>>(null, {
    channel: promise.then(p => createMessagePortChannel(p)),
    log: false,
  });

  return new Proxy<ClientHandler>(rpc as any, {
    get(_, namespace: string) {
      return new Proxy(rpc as any, {
        get(_, method: string) {
          return rpc[`${namespace}:${method}`];
        },
      });
    },
  });
}
