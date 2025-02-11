import type { ExtensionType } from '@blocksuite/block-std';
import { createIdentifier } from '@blocksuite/global/di';
import { Slot } from '@blocksuite/store';

import type { Viewport } from '../types';

export const PageViewportService = createIdentifier<Slot<Viewport>>(
  'PageViewportService'
);

export const PageViewportServiceExtension: ExtensionType = {
  setup: di => {
    di.addImpl(PageViewportService, () => new Slot<Viewport>());
  },
};
