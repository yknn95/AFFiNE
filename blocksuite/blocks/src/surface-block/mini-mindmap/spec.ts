import {
  MindMapView,
  SurfaceBlockSchema,
} from '@blocksuite/affine-block-surface';
import { RootBlockSchema } from '@blocksuite/affine-model';
import {
  DocModeService,
  ThemeService,
} from '@blocksuite/affine-shared/services';
import {
  BlockViewExtension,
  type ExtensionType,
  FlavourExtension,
} from '@blocksuite/block-std';
import type { BlockSchema } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';
import type { z } from 'zod';

import { MindmapService } from './minmap-service.js';
import { MindmapSurfaceBlockService } from './surface-service.js';

export const MiniMindmapSpecs: ExtensionType[] = [
  DocModeService,
  ThemeService,
  FlavourExtension('affine:page'),
  MindmapService,
  BlockViewExtension('affine:page', literal`mini-mindmap-root-block`),
  FlavourExtension('affine:surface'),
  MindMapView,
  MindmapSurfaceBlockService,
  BlockViewExtension('affine:surface', literal`mini-mindmap-surface-block`),
];

export const MiniMindmapSchema: z.infer<typeof BlockSchema>[] = [
  RootBlockSchema,
  SurfaceBlockSchema,
];
