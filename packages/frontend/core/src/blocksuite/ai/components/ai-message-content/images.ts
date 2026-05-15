import { WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVar } from '@blocksuite/affine/shared/theme';
import { ShadowlessElement } from '@blocksuite/affine/std';
import { css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { renderPreviewPanel } from '../ai-tools/artifacts-preview-panel';

export class ChatContentImages extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .chat-content-images-row {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 8px;
      margin-bottom: 8px;
      max-width: 100%;
      overflow-x: auto;
      padding: 4px;
      scrollbar-width: auto;
    }

    .chat-content-images-row::-webkit-scrollbar {
      height: 4px;
    }

    .chat-content-images-row::-webkit-scrollbar-thumb {
      background-color: ${unsafeCSSVar('borderColor')};
      border-radius: 4px;
    }

    .chat-content-images-row::-webkit-scrollbar-track {
      background: transparent;
    }

    .chat-content-images-row img {
      max-width: 180px;
      max-height: 264px;
      object-fit: cover;
      border-radius: 8px;
      flex-shrink: 0;
      image-rendering: pixelated;
    }

    .chat-content-images-column {
      display: flex;
      gap: 12px;
      flex-direction: column;
      margin-bottom: 8px;
    }

    .chat-content-images-column .image-container {
      border-radius: 4px;
      overflow: hidden;
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 70%;
      max-width: 320px;
    }

    .chat-content-images-column .image-container img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      image-rendering: pixelated;
    }

    .image-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .image-container {
      position: relative;
      overflow: hidden;
      border-radius: 8px;
    }

    .image-container.interactive {
      cursor: zoom-in;
    }

    .image-actions {
      display: flex;
      justify-content: flex-end;
    }

    .image-action-button {
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      line-height: 18px;
      color: var(--affine-v2-text-primary);
      background: var(--affine-v2-layer-background-secondary);
      cursor: pointer;
    }

    .image-action-button:hover {
      background: var(--affine-v2-layer-background-hoverOverlay);
    }

    .image-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 120px);
      padding: 16px;
      background: rgba(0, 0, 0, 0.04);
    }

    .image-preview img {
      display: block;
      max-width: 100%;
      max-height: calc(100vh - 180px);
      object-fit: contain;
      border-radius: 12px;
    }
  `;

  @property({ attribute: false })
  accessor images: Array<string | { src: string; key?: string }> = [];

  @property({ attribute: false })
  accessor layout: 'row' | 'column' = 'row';

  @property({ attribute: false })
  accessor enablePreview = false;

  @property({ attribute: false })
  accessor onInsertImage: ((image: string) => void | Promise<void>) | null =
    null;

  private resolveImageSrc(image: unknown) {
    if (image && typeof image === 'object' && 'src' in image) {
      const src = (image as { src?: unknown }).src;
      return typeof src === 'string' ? src : null;
    }

    if (typeof image === 'string') {
      if (!image.startsWith('{')) {
        console.log('[ai-image-render] using string image src', {
          preview: image.slice(0, 200),
        });
        return image;
      }
      try {
        const parsed = JSON.parse(image) as { url?: unknown };
        const url = typeof parsed.url === 'string' ? parsed.url : null;
        console.log('[ai-image-render] parsed json string image src', {
          preview: url?.slice(0, 200) ?? null,
        });
        return url;
      } catch {
        console.warn('[ai-image-render] failed to parse json image string', {
          preview: image.slice(0, 200),
        });
        return image;
      }
    }
    if (image && typeof image === 'object' && 'url' in image) {
      const url = (image as { url?: unknown }).url;
      console.log('[ai-image-render] using object image src', {
        preview: typeof url === 'string' ? url.slice(0, 200) : null,
      });
      return typeof url === 'string' ? url : null;
    }
    console.warn('[ai-image-render] unsupported image payload', image);
    return null;
  }

  private readonly openImagePreview = (image: string) => {
    if (!this.enablePreview) {
      return;
    }

    renderPreviewPanel(
      this,
      html`<div class="image-preview"><img src=${image} /></div>`
    );
  };

  private renderImage(image: string) {
    return html`<div class="image-item">
      <div
        class="image-container ${this.enablePreview ? 'interactive' : ''}"
        @dblclick=${() => this.openImagePreview(image)}
        title=${this.enablePreview ? '双击放大预览' : ''}
      >
        <img
          src="${image}"
          @load=${() =>
            console.log('[ai-image-render] image loaded', {
              preview: image.slice(0, 200),
            })}
          @error=${(event: Event) =>
            console.error('[ai-image-render] image failed', {
              preview: image.slice(0, 200),
              currentSrc:
                event.target instanceof HTMLImageElement
                  ? event.target.currentSrc
                  : null,
            })}
        />
      </div>
      ${this.onInsertImage
        ? html`<div class="image-actions">
            <button
              class="image-action-button"
              @click=${() => this.onInsertImage?.(image)}
            >
              插入到文档
            </button>
          </div>`
        : nothing}
    </div>`;
  }

  protected override render() {
    const images = this.images
      .map((image, index) => {
        const src = this.resolveImageSrc(image);
        if (!src) {
          return null;
        }

        const key =
          image && typeof image === 'object' && 'key' in image
            ? (image as { key?: unknown }).key
            : undefined;

        return {
          src,
          key: typeof key === 'string' ? key : `${index}:${src.slice(0, 64)}`,
        };
      })
      .filter(
        (image): image is { src: string; key: string } => image !== null
      );

    if (images.length === 0) {
      return nothing;
    }

    if (this.layout === 'row') {
      return html`<div class="chat-content-images-row">
        ${repeat(images, image => image.key, image => this.renderImage(image.src))}
      </div>`;
    } else {
      return html`<div class="chat-content-images-column">
        ${repeat(
          images,
          image => image.key,
          image => this.renderImage(image.src)
        )}
      </div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chat-content-images': ChatContentImages;
  }
}
