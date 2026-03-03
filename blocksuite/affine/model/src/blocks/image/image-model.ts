import type {
  GfxCommonBlockProps,
  GfxElementGeometry,
} from '@blocksuite/std/gfx';
import { GfxCompatible } from '@blocksuite/std/gfx';
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

import type { TextAlign } from '../../consts';
import type { BlockMeta } from '../../utils/types.js';
import { ImageBlockTransformer } from './image-transformer.js';

export type ImageBlockProps = {
  caption?: string;
  sourceId?: string;
  /** Original image source ID for high-resolution viewing in fullscreen */
  originalSourceId?: string;
  /** Original image file size in bytes */
  originalSize?: number;
  width?: number;
  height?: number;
  rotate: number;
  size?: number;
  comments?: Record<string, boolean>;
  textAlign?: TextAlign;
} & Omit<GfxCommonBlockProps, 'scale'> &
  BlockMeta;

const defaultImageProps: ImageBlockProps = {
  caption: '',
  sourceId: '',
  originalSourceId: '',
  originalSize: -1,
  width: 0,
  height: 0,
  index: 'a0',
  xywh: '[0,0,0,0]',
  lockedBySelf: false,
  rotate: 0,
  size: -1,
  comments: undefined,
  textAlign: undefined,
  'meta:createdAt': undefined,
  'meta:createdBy': undefined,
  'meta:updatedAt': undefined,
  'meta:updatedBy': undefined,
};

export const ImageBlockSchema = defineBlockSchema({
  flavour: 'affine:image',
  props: () => defaultImageProps,
  metadata: {
    version: 1,
    role: 'content',
  },
  transformer: transformerConfigs =>
    new ImageBlockTransformer(transformerConfigs),
  toModel: () => new ImageBlockModel(),
});

export const ImageBlockSchemaExtension = BlockSchemaExtension(ImageBlockSchema);

export class ImageBlockModel
  extends GfxCompatible<ImageBlockProps>(BlockModel)
  implements GfxElementGeometry {}
