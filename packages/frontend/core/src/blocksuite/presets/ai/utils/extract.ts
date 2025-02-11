import type { EditorHost } from '@blocksuite/affine/block-std';
import {
  DocModeProvider,
  isInsideEdgelessEditor,
} from '@blocksuite/affine/blocks';

import type { ChatContextValue } from '../chat-panel/chat-context';
import {
  getSelectedImagesAsBlobs,
  getSelectedTextContent,
  selectedToCanvas,
} from './selection-utils';

export async function extractContext(
  host: EditorHost
): Promise<Partial<ChatContextValue> | null> {
  const docModeService = host.std.get(DocModeProvider);
  const mode = docModeService.getEditorMode() || 'page';
  if (mode === 'edgeless') {
    return await extractOnEdgeless(host);
  } else {
    return await extractOnPage(host);
  }
}

export async function extractOnEdgeless(
  host: EditorHost
): Promise<Partial<ChatContextValue> | null> {
  if (!isInsideEdgelessEditor(host)) return null;

  const canvas = await selectedToCanvas(host);
  if (!canvas) return null;

  const blob: Blob | null = await new Promise(resolve =>
    canvas.toBlob(resolve)
  );
  if (!blob) return null;

  return {
    images: [new File([blob], 'selected.png')],
  };
}

export async function extractOnPage(
  host: EditorHost
): Promise<Partial<ChatContextValue> | null> {
  const text = await getSelectedTextContent(host, 'plain-text');
  const images = await getSelectedImagesAsBlobs(host);
  const hasText = text.length > 0;
  const hasImages = images.length > 0;

  if (hasText && !hasImages) {
    const markdown = await getSelectedTextContent(host, 'markdown');
    return {
      quote: text,
      markdown: markdown,
    };
  } else if (!hasText && hasImages && images.length === 1) {
    host.command
      .chain()
      .tryAll(chain => [chain.getImageSelections()])
      .getSelectedBlocks({
        types: ['image'],
      })
      .run();
    return {
      images,
    };
  } else {
    const markdown =
      (await getSelectedTextContent(host, 'markdown')).trim() || '';
    return {
      quote: text,
      markdown,
      images,
    };
  }
}
