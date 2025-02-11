import '@sentry/electron/preload';

import { contextBridge } from 'electron';

import { apis, appInfo, events, requestWebWorkerPort } from './electron-api';
import { sharedStorage } from './shared-storage';

contextBridge.exposeInMainWorld('__appInfo', appInfo);
contextBridge.exposeInMainWorld('__apis', apis);
contextBridge.exposeInMainWorld('__events', events);
contextBridge.exposeInMainWorld('__sharedStorage', sharedStorage);
contextBridge.exposeInMainWorld('__requestWebWorkerPort', requestWebWorkerPort);
