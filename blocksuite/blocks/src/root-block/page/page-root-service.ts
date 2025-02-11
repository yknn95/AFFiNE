import { RootBlockSchema } from '@blocksuite/affine-model';
import type { Viewport } from '@blocksuite/affine-shared/types';
import { Slot } from '@blocksuite/store';

import { RootService } from '../root-service.js';

export class PageRootService extends RootService {
  static override readonly flavour = RootBlockSchema.model.flavour;

  slots = {
    viewportUpdated: new Slot<Viewport>(),
  };
}
