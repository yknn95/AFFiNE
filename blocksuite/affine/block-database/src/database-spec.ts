import {
  BlockViewExtension,
  CommandExtension,
  type ExtensionType,
  FlavourExtension,
} from '@blocksuite/block-std';
import { DatabaseSelectionExtension } from '@blocksuite/data-view';
import { literal } from 'lit/static-html.js';

import { DatabaseBlockAdapterExtensions } from './adapters/extension.js';
import { commands } from './commands.js';
import { DatabaseBlockService } from './database-service.js';

export const DatabaseBlockSpec: ExtensionType[] = [
  FlavourExtension('affine:database'),
  DatabaseBlockService,
  CommandExtension(commands),
  BlockViewExtension('affine:database', literal`affine-database`),
  DatabaseSelectionExtension,
  DatabaseBlockAdapterExtensions,
].flat();
