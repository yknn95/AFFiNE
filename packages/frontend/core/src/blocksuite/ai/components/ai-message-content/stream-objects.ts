import type { FeatureFlagService } from '@affine/core/modules/feature-flag';
import type { PeekViewService } from '@affine/core/modules/peek-view';
import { addSiblingImageBlocks, addImages } from '@blocksuite/affine/blocks/image';
import { WithDisposable } from '@blocksuite/affine/global/lit';
import type { ColorScheme } from '@blocksuite/affine/model';
import { isInsidePageEditor } from '@blocksuite/affine/shared/utils';
import {
  type BlockStdScope,
  type EditorHost,
  ShadowlessElement,
  TextSelection,
} from '@blocksuite/affine/std';
import { GfxControllerIdentifier } from '@blocksuite/affine/std/gfx';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { NotificationService } from '@blocksuite/affine-shared/services';
import type { Signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';

import type { AffineAIPanelState } from '../../widgets/ai-panel/type';
import { getEdgelessCopilotWidget } from '../../utils/edgeless';
import { fetchImageToFile } from '../../utils/image';
import { getSelections } from '../../utils/selection-utils';
import type { DocDisplayConfig } from '../ai-chat-chips';
import type { StreamObject } from '../ai-chat-messages';

export class ChatContentStreamObjects extends WithDisposable(
  ShadowlessElement
) {
  static override styles = css`
    .reasoning-wrapper {
      padding: 16px 20px;
      margin: 8px 0;
      border-radius: 8px;
      background-color: rgba(0, 0, 0, 0.05);
    }

    .image-tool-result {
      margin: 8px 0;
      padding: 12px;
      border-radius: 8px;
      border: 0.5px solid var(--affine-v2-layer-insideBorder-border);
      background: var(--affine-v2-layer-background-primary);
    }

    .image-tool-result-title {
      font-size: 14px;
      font-weight: 500;
      line-height: 20px;
      color: var(--affine-v2-text-primary);
      margin-bottom: 8px;
    }

    .image-tool-result-content {
      font-size: 12px;
      line-height: 18px;
      color: var(--affine-v2-text-secondary);
      margin-bottom: 8px;
      white-space: pre-wrap;
    }

    .image-tool-result-hint {
      font-size: 12px;
      line-height: 18px;
      color: var(--affine-v2-text-tertiary);
      margin-bottom: 8px;
    }
  `;

  @property({ attribute: false })
  accessor answer!: StreamObject[];

  @property({ attribute: false })
  accessor host: EditorHost | null | undefined;

  @property({ attribute: false })
  accessor std: BlockStdScope | null | undefined;

  @property({ attribute: false })
  accessor state: AffineAIPanelState = 'finished';

  @property({ attribute: false })
  accessor width: Signal<number | undefined> | undefined;

  @property({ attribute: false })
  accessor extensions!: ExtensionType[];

  @property({ attribute: false })
  accessor affineFeatureFlagService!: FeatureFlagService;

  @property({ attribute: false })
  accessor theme!: Signal<ColorScheme>;

  @property({ attribute: false })
  accessor independentMode: boolean | undefined;

  @property({ attribute: false })
  accessor notificationService!: NotificationService;

  @property({ attribute: false })
  accessor docDisplayService!: DocDisplayConfig;

  @property({ attribute: false })
  accessor peekViewService!: PeekViewService;

  @property({ attribute: false })
  accessor onOpenDoc!: (docId: string, sessionId?: string) => void;

  private getPageInsertionTarget() {
    const host = this.host;
    if (!host) {
      return null;
    }

    const textSelection = host.selection.find(TextSelection);
    const mode = textSelection ? 'flat' : 'highest';
    const { selectedBlocks } = getSelections(host, mode);
    if (selectedBlocks?.length) {
      return selectedBlocks[selectedBlocks.length - 1]?.model ?? null;
    }

    const rootChildren = host.store.root?.children ?? [];
    const blockChildren = rootChildren.filter(
      child => child.flavour !== 'affine:surface'
    );
    return blockChildren[blockChildren.length - 1] ?? null;
  }

  private readonly insertImageIntoDocument = async (image: string) => {
    const host = this.host;
    if (!host) {
      this.notificationService.toast('当前没有可插入的编辑器');
      return;
    }

    const imageProxy = host.std.clipboard.configs.get('imageProxy');
    const file = await fetchImageToFile(image, 'ai-generated-image', imageProxy);
    if (!file) {
      this.notificationService.toast('图片获取失败，无法插入');
      return;
    }

    try {
      if (isInsidePageEditor(host)) {
        const targetModel = this.getPageInsertionTarget();
        if (!targetModel) {
          this.notificationService.toast('未找到可插入的位置');
          return;
        }
        await addSiblingImageBlocks(host.std, [file], targetModel, 'after');
      } else {
        const edgelessCopilot = getEdgelessCopilotWidget(host);
        const bounds = edgelessCopilot.determineInsertionBounds();
        const gfx = host.std.get(GfxControllerIdentifier);
        const [x, y] = gfx.viewport.toViewCoord(bounds.minX, bounds.minY);
        await addImages(host.std, [file], { point: [x, y] });
      }

      this.notificationService.toast('已插入到当前文档');
    } catch (error) {
      console.error('[ai-stream-object] failed to insert generated image', error);
      this.notificationService.toast('插入图片失败');
    }
  };

  private renderToolCall(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-call') {
      return nothing;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .doc=${this.host?.store}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
        ></doc-read-result>`;
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      default: {
        const name = streamObject.toolName + ' tool calling';
        return html`
          <tool-call-card .name=${name} .width=${this.width}></tool-call-card>
        `;
      }
    }
  }

  private renderToolResult(streamObject: StreamObject) {
    if (streamObject.type !== 'tool-result') {
      return nothing;
    }

    console.log('[ai-stream-object] renderToolResult', {
      toolName: streamObject.toolName,
      toolCallId: streamObject.toolCallId,
      args: streamObject.args,
      result: streamObject.result,
    });

    const imageItems = extractImageItems(streamObject.result);
    console.log('[ai-stream-object] extracted image items', {
      toolName: streamObject.toolName,
      toolCallId: streamObject.toolCallId,
      count: imageItems.length,
      items: imageItems.map(item => ({
        key: item.key,
        preview: item.src.slice(0, 120),
      })),
    });
    if (imageItems.length) {
      const content = summarizeToolResult(streamObject.result);
      return html`
        <div class="image-tool-result">
          <div class="image-tool-result-title">${streamObject.toolName}</div>
          ${content
            ? html`<div class="image-tool-result-content">${content}</div>`
            : nothing}
          <div class="image-tool-result-hint">双击图片可放大预览</div>
          <chat-content-images
            .images=${imageItems}
            .enablePreview=${true}
            .onInsertImage=${this.insertImageIntoDocument}
          ></chat-content-images>
        </div>
      `;
    }

    switch (streamObject.toolName) {
      case 'web_crawl_exa':
        return html`
          <web-crawl-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-crawl-tool>
        `;
      case 'web_search_exa':
        return html`
          <web-search-tool
            .data=${streamObject}
            .width=${this.width}
          ></web-search-tool>
        `;
      case 'doc_compose':
        return html`
          <doc-compose-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></doc-compose-tool>
        `;
      case 'code_artifact':
        return html`
          <code-artifact-tool
            .std=${this.std || this.host?.std}
            .data=${streamObject}
            .width=${this.width}
            .theme=${this.theme}
            .notificationService=${this.notificationService}
          ></code-artifact-tool>
        `;
      case 'doc_edit':
        return html`
          <doc-edit-tool
            .data=${streamObject}
            .host=${this.host}
            .renderRichText=${this.renderRichText.bind(this)}
            .notificationService=${this.notificationService}
          ></doc-edit-tool>
        `;
      case 'doc_semantic_search':
        return html`<doc-semantic-search-result
          .data=${streamObject}
          .width=${this.width}
          .docDisplayService=${this.docDisplayService}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-semantic-search-result>`;
      case 'doc_keyword_search':
        return html`<doc-keyword-search-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-keyword-search-result>`;
      case 'doc_read':
        return html`<doc-read-result
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-read-result>`;
      case 'doc_create':
      case 'doc_update':
      case 'doc_update_meta':
        return html`<doc-write-tool
          .data=${streamObject}
          .width=${this.width}
          .peekViewService=${this.peekViewService}
          .docDisplayService=${this.docDisplayService}
          .onOpenDoc=${this.onOpenDoc}
        ></doc-write-tool>`;
      case 'section_edit':
        return html`
          <section-edit-tool
            .data=${streamObject}
            .extensions=${this.extensions}
            .affineFeatureFlagService=${this.affineFeatureFlagService}
            .notificationService=${this.notificationService}
            .theme=${this.theme}
            .host=${this.host}
            .independentMode=${this.independentMode}
          ></section-edit-tool>
        `;
      default: {
        const name = streamObject.toolName + ' tool result';
        return html`
          <tool-result-card
            .name=${name}
            .width=${this.width}
          ></tool-result-card>
        `;
      }
    }
  }

  private renderRichText(text: string) {
    return html`<chat-content-rich-text
      .text=${text}
      .state=${this.state}
      .extensions=${this.extensions}
      .affineFeatureFlagService=${this.affineFeatureFlagService}
      .theme=${this.theme}
    ></chat-content-rich-text>`;
  }

  protected override render() {
    console.log('[ai-stream-object] render', {
      count: this.answer.length,
      types: this.answer.map(item =>
        item.type === 'tool-call' || item.type === 'tool-result'
          ? `${item.type}:${item.toolName}`
          : item.type
      ),
    });
    return html`<div>
      ${this.answer.map(data => {
        switch (data.type) {
          case 'text-delta':
            return this.renderRichText(data.textDelta);
          case 'reasoning':
            return html`
              <div class="reasoning-wrapper">
                ${this.renderRichText(data.textDelta)}
              </div>
            `;
          case 'tool-call':
            return this.renderToolCall(data);
          case 'tool-result':
            return this.renderToolResult(data);
          default:
            return nothing;
        }
      })}
    </div>`;
  }
}

type ExtractedImageItem = {
  key: string;
  src: string;
};

function extractImageItems(
  value: unknown,
  options: {
    depth?: number;
    seen?: WeakSet<object>;
    path?: string;
  } = {}
): ExtractedImageItem[] {
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new WeakSet<object>();
  const path = options.path ?? 'root';
  if (depth > 4 || value == null) {
    return [];
  }

  if (typeof value === 'string') {
    return isImageLikeString(value)
      ? [{ key: `${path}:string`, src: value }]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      extractImageItems(item, {
        depth: depth + 1,
        seen,
        path: `${path}[${index}]`,
      })
    );
  }

  if (typeof value !== 'object') {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  const directUrl =
    typeof record.url === 'string'
      ? record.url
      : typeof record.image_url === 'string'
        ? record.image_url
        : undefined;
  const directBase64 =
    typeof record.b64_json === 'string'
      ? record.b64_json
      : typeof record.data_base64 === 'string'
        ? record.data_base64
        : undefined;

  if (directUrl && isImageLikeString(directUrl)) {
    return [{ key: `${path}:url`, src: directUrl }];
  }
  if (directBase64) {
    return [
      {
        key: `${path}:base64`,
        src: `data:${resolveImageMimeType(record)};base64,${directBase64}`,
      },
    ];
  }

  const nestedKeys = [
    'images',
    'artifacts',
    'attachments',
    'data',
    'result',
    'output',
    'content',
  ] as const;
  const sources: ExtractedImageItem[] = [];
  for (const key of nestedKeys) {
    if (key in record) {
      sources.push(
        ...extractImageItems(record[key], {
          depth: depth + 1,
          seen,
          path: `${path}.${key}`,
        })
      );
    }
  }

  return dedupeImageItems(sources);
}

function resolveImageMimeType(record: Record<string, unknown>) {
  if (typeof record.media_type === 'string') {
    return record.media_type;
  }
  if (typeof record.mimeType === 'string') {
    return record.mimeType;
  }
  if (typeof record.type === 'string' && record.type.startsWith('image/')) {
    return record.type;
  }
  if (typeof record.output_format === 'string') {
    return outputFormatToMimeType(record.output_format);
  }
  return 'image/png';
}

function outputFormatToMimeType(format: string) {
  const normalized = format.toLowerCase();
  if (normalized === 'jpg') {
    return 'image/jpeg';
  }
  return `image/${normalized}`;
}

function isImageLikeString(value: string) {
  return (
    value.startsWith('data:image/') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('blob:')
  );
}

function summarizeToolResult(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const candidate = [
    record.revised_prompt,
    record.prompt,
    record.description,
    record.text,
    record.content,
    record.result,
  ].find(item => typeof item === 'string');

  if (typeof candidate !== 'string') {
    return '';
  }

  return candidate.length > 240 ? `${candidate.slice(0, 240)}...` : candidate;
}

function dedupeImageItems(values: ExtractedImageItem[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const identity = `${value.key}:${value.src}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}
