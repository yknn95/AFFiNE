export {
  GlobalCache,
  GlobalSessionState,
  GlobalState,
} from './providers/global';
export {
  GlobalCacheService,
  GlobalSessionStateService,
  GlobalStateService,
} from './services/global';

import { type Framework } from '@toeverything/infra';

import { DesktopApiService } from '../desktop-api';
import { ElectronGlobalCache, ElectronGlobalState } from './impls/electron';
import {
  LocalStorageGlobalCache,
  LocalStorageGlobalState,
  SessionStorageGlobalSessionState,
} from './impls/storage';
import {
  GlobalCache,
  GlobalSessionState,
  GlobalState,
} from './providers/global';
import {
  GlobalCacheService,
  GlobalSessionStateService,
  GlobalStateService,
} from './services/global';

export const configureGlobalStorageModule = (framework: Framework) => {
  framework.service(GlobalStateService, [GlobalState]);
  framework.service(GlobalCacheService, [GlobalCache]);
  framework.service(GlobalSessionStateService, [GlobalSessionState]);
};

export function configureLocalStorageStateStorageImpls(framework: Framework) {
  framework.impl(GlobalCache, LocalStorageGlobalCache);
  framework.impl(GlobalState, LocalStorageGlobalState);
}

export function configureElectronStateStorageImpls(framework: Framework) {
  framework.impl(GlobalCache, ElectronGlobalCache, [DesktopApiService]);
  framework.impl(GlobalState, ElectronGlobalState, [DesktopApiService]);
}

export function configureCommonGlobalStorageImpls(framework: Framework) {
  framework.impl(GlobalSessionState, SessionStorageGlobalSessionState);
}
