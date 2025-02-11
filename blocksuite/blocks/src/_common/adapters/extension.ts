import {
  AttachmentAdapterFactoryExtension,
  HtmlAdapterFactoryExtension,
  ImageAdapterFactoryExtension,
  MarkdownAdapterFactoryExtension,
  NotionHtmlAdapterFactoryExtension,
  NotionTextAdapterFactoryExtension,
  PlainTextAdapterFactoryExtension,
} from '@blocksuite/affine-shared/adapters';
import type { ExtensionType } from '@blocksuite/block-std';

import { htmlInlineToDeltaMatchers } from './html/delta-converter/html-inline.js';
import { inlineDeltaToHtmlAdapterMatchers } from './html/delta-converter/inline-delta.js';
import { inlineDeltaToMarkdownAdapterMatchers } from './markdown/delta-converter/inline-delta.js';
import { markdownInlineToDeltaMatchers } from './markdown/delta-converter/markdown-inline.js';
import { MixTextAdapterFactoryExtension } from './mix-text.js';
import { notionHtmlInlineToDeltaMatchers } from './notion-html/delta-converter/html-inline.js';
import { inlineDeltaToPlainTextAdapterMatchers } from './plain-text/delta-converter/inline-delta.js';

export const AdapterFactoryExtensions: ExtensionType[] = [
  ...htmlInlineToDeltaMatchers,
  ...inlineDeltaToHtmlAdapterMatchers,
  ...notionHtmlInlineToDeltaMatchers,
  ...inlineDeltaToPlainTextAdapterMatchers,
  ...markdownInlineToDeltaMatchers,
  ...inlineDeltaToMarkdownAdapterMatchers,
  AttachmentAdapterFactoryExtension,
  ImageAdapterFactoryExtension,
  MarkdownAdapterFactoryExtension,
  PlainTextAdapterFactoryExtension,
  HtmlAdapterFactoryExtension,
  NotionTextAdapterFactoryExtension,
  NotionHtmlAdapterFactoryExtension,
  MixTextAdapterFactoryExtension,
];
