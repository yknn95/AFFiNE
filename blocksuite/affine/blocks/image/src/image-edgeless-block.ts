import type { BlockCaptionEditor } from '@blocksuite/affine-components/caption';
import { LoadingIcon } from '@blocksuite/affine-components/icons';
import { Peekable } from '@blocksuite/affine-components/peek';
import { ResourceController } from '@blocksuite/affine-components/resource';
import {
  type ImageBlockModel,
  ImageBlockSchema,
} from '@blocksuite/affine-model';
import { cssVarV2, unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import { formatSize } from '@blocksuite/affine-shared/utils';
import { BrokenImageIcon, ImageIcon } from '@blocksuite/icons/lit';
import { GfxBlockComponent } from '@blocksuite/std';
import { GfxViewInteractionExtension } from '@blocksuite/std/gfx';
import { computed } from '@preact/signals-core';
import { css, html } from 'lit';
import { query } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';

import {
  copyImageBlob,
  downloadImageBlob,
  refreshData,
  turnImageIntoCardView,
} from './utils';
import debounce from 'lodash-es/debounce';

function isInViewport(element: GfxBlockComponent):boolean {
  if (element.transformState$.value === 'idle') return false;

  const { viewport } = element.gfx;
  const isInViewport = viewport.isInViewport(element.model.elementBound)
  
  return isInViewport
}

@Peekable()
export class ImageEdgelessBlockComponent extends GfxBlockComponent<ImageBlockModel> {
  static override styles = css`
    affine-edgeless-image {
      position: relative;
    }

    affine-edgeless-image .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      top: 4px;
      right: 4px;
      width: 36px;
      height: 36px;
      padding: 5px;
      border-radius: 8px;
      background: ${unsafeCSSVarV2(
        'loading/imageLoadingBackground',
        '#92929238'
      )};

      & > svg {
        font-size: 25.71px;
      }
    }

    affine-edgeless-image .affine-image-status {
      position: absolute;
      left: 18px;
      bottom: 18px;
    }

    affine-edgeless-image .resizable-img {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    affine-edgeless-image .resizable-img canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  resourceController = new ResourceController(
    computed(() => this.model.props.sourceId$.value),
    'Image'
  );

  get blobUrl() {
    return this.resourceController.blobUrl$.value;
  }

  convertToCardView = () => {
    turnImageIntoCardView(this).catch(console.error);
  };

  copy = () => {
    copyImageBlob(this).catch(console.error);
  };

  download = () => {
    downloadImageBlob(this).catch(console.error);
  };

  refreshData = () => {
    refreshData(this).catch(console.error);
  };

  private _handleError() {
    this.resourceController.updateState({
      errorMessage: 'Failed to download image!',
    });
  }

  override connectedCallback() {
    super.connectedCallback();

    this.contentEditable = 'false';

    this.resourceController.setEngine(this.std.store.blobSync);

    this.disposables.add(this.resourceController.subscribe());
    this.disposables.add(this.resourceController);

    this.disposables.add(
      this.model.props.sourceId$.subscribe(() => {
        this.refreshData();
      })
    );
    
    // Update isInViewport when viewport changes
    this.disposables.add(
      this.gfx.viewport.viewportUpdated.subscribe(() => {
        this._renderImageToCanvas();
      })
    );

    // Subscribe to blobUrl changes and update canvas
    this.disposables.add(
      this.resourceController.blobUrl$.subscribe(() => {
        this._renderImageToCanvas();
      })
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    
    // Clear image cache and pending promises
    this._imageCache.clear();
    this._loadingPromises.clear();
  }

  override renderGfxBlock() {
    const blobUrl = this.blobUrl;
    const { rotate = 0, size = 0, caption = 'Image' } = this.model.props;

    // Trigger canvas rendering when component renders
    if (blobUrl) {
      this.updateComplete.then(() => {
        this._renderImageToCanvas();
      });
    }

    const containerStyleMap = styleMap({
      display: 'flex',
      position: 'relative',
      width: '100%',
      height: '100%',
      transform: `rotate(${rotate}deg)`,
      transformOrigin: 'center',
    });

    const resovledState = this.resourceController.resolveStateWith({
      loadingIcon: LoadingIcon({
        strokeColor: cssVarV2('button/pureWhiteText'),
        ringColor: cssVarV2('loading/imageLoadingLayer', '#ffffff8f'),
      }),
      errorIcon: BrokenImageIcon(),
      icon: ImageIcon(),
      title: 'Image',
      description: formatSize(size),
    });

    const { loading, icon, description, error, needUpload } = resovledState;

    return html`
      <div class="affine-image-container" style=${containerStyleMap}>
        ${when(
          blobUrl,
          () => html`
            <div class="resizable-img">
              <canvas
                class="drag-target"
                draggable="false"
              ></canvas>
            </div>
            ${when(loading, () => html`<div class="loading">${icon}</div>`)}
            ${when(
              Boolean(error && description),
              () =>
                html`<affine-resource-status
                  class="affine-image-status"
                  .message=${description}
                  .needUpload=${needUpload}
                  .action=${() =>
                    needUpload
                      ? this.resourceController.upload()
                      : this.refreshData()}
                ></affine-resource-status>`
            )}
          `,
          () =>
            html`<affine-image-fallback-card
              .state=${resovledState}
            ></affine-image-fallback-card>`
        )}
        <affine-block-selection .block=${this}></affine-block-selection>
      </div>
      <block-caption-editor></block-caption-editor>

      ${Object.values(this.widgets)}
    `;
  }

  @query('block-caption-editor')
  accessor captionEditor!: BlockCaptionEditor | null;

  @query('.resizable-img')
  accessor resizableImg!: HTMLDivElement;

  @query('canvas')
  accessor canvas!: HTMLCanvasElement | null;

  private _imageCache = new Map<string, HTMLImageElement>();
  private _loadingPromises = new Map<string, Promise<HTMLImageElement>>();

  private _loadImageWithCache(url: string): Promise<HTMLImageElement> {
    // Return cached image if available
    if (this._imageCache.has(url)) {
      return Promise.resolve(this._imageCache.get(url)!);
    }

    // Return existing loading promise if already loading
    if (this._loadingPromises.has(url)) {
      return this._loadingPromises.get(url)!;
    }

    // Create new loading promise
    const loadingPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this._imageCache.set(url, img);
        this._loadingPromises.delete(url);
        resolve(img);
      };
      img.onerror = () => {
        this._loadingPromises.delete(url);
        reject(new Error(`Failed to load image: ${url}`));
      };
      img.src = url;
    });

    this._loadingPromises.set(url, loadingPromise);
    return loadingPromise;
  }

  private _renderImageToCanvas = debounce(async () => {
    if (!this.canvas || !this.blobUrl) return;
    const newIsInViewport = isInViewport(this);
    if(!newIsInViewport) return

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    try {
      const img = await this._loadImageWithCache(this.blobUrl);
      const container = this.resizableImg;
      if (!container) return;
      
      // Set canvas dimensions to match container size
      const rect = container.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
      
      // Calculate scaling to maintain aspect ratio
      const scale = Math.min(
        rect.width / img.naturalWidth,
        rect.height / img.naturalHeight
      );
      
      const scaledWidth = img.naturalWidth * scale;
      const scaledHeight = img.naturalHeight * scale;
      
      // Center the image in the canvas
      const x = (rect.width - scaledWidth) / 2;
      const y = (rect.height - scaledHeight) / 2;
      
      // Clear canvas and draw image at centered position
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
      
      // Reset any transform
      this.canvas.style.transform = '';
      this.canvas.style.transformOrigin = '';
    } catch (error) {
      console.error('Error rendering image to canvas:', error);
      this._handleError();
    }
  }, 200);
}

export const ImageEdgelessBlockInteraction = GfxViewInteractionExtension(
  ImageBlockSchema.model.flavour,
  {
    resizeConstraint: {
      lockRatio: true,
    },
  }
);

declare global {
  interface HTMLElementTagNameMap {
    'affine-edgeless-image': ImageEdgelessBlockComponent;
  }
}
