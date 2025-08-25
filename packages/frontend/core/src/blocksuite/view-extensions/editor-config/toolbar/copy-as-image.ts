import { notify } from '@affine/component';
import { isMindmapChild, isMindMapRoot } from '@affine/core/blocksuite/ai';
import { EditorService } from '@affine/core/modules/editor';
import { apis } from '@affine/electron-api';
import { I18n } from '@affine/i18n';
import type { MenuContext } from '@blocksuite/affine/components/toolbar';
import { Bound, getCommonBound } from '@blocksuite/affine/global/gfx';
import type { BlockStdScope } from '@blocksuite/affine/std';
import {
  type GfxBlockElementModel,
  GfxControllerIdentifier,
  type GfxModel,
  GfxPrimitiveElementModel,
  isGfxGroupCompatibleModel,
} from '@blocksuite/affine/std/gfx';
import { CopyAsImgaeIcon } from '@blocksuite/icons/lit';
import type { FrameworkProvider } from '@toeverything/infra';

const snapshotStyle = `
  affine-edgeless-root .widgets-container,
  .copy-as-image-transparent {
    opacity: 0;
  }
  .edgeless-background {
    background-image: none;
  }
`;

function getSelectedRect() {
  const selected = document
    .querySelector('edgeless-selected-rect')
    ?.shadowRoot?.querySelector('.affine-edgeless-selected-rect');
  if (!selected) {
    throw new Error('Missing edgeless selected rect');
  }
  return selected.getBoundingClientRect();
}

function expandBound(bound: Bound, margin: number) {
  const x = bound.x - margin;
  const y = bound.y - margin;
  const w = bound.w + margin * 2;
  const h = bound.h + margin * 2;
  return new Bound(x, y, w, h);
}

function isOverlap(target: Bound, source: Bound) {
  const { x, y, w, h } = source;
  const left = target.x;
  const top = target.y;
  const right = target.x + target.w;
  const bottom = target.y + target.h;

  return x < right && y < bottom && x + w > left && y + h > top;
}

function isInside(target: Bound, source: Bound) {
  const { x, y, w, h } = source;
  const left = target.x;
  const top = target.y;
  const right = target.x + target.w;
  const bottom = target.y + target.h;

  return x >= left && y >= top && x + w <= right && y + h <= bottom;
}

function hideEdgelessElements(elements: GfxModel[], std: BlockStdScope) {
  elements.forEach(ele => {
    if (ele instanceof GfxPrimitiveElementModel) {
      (ele as any).lastOpacity = ele.opacity;
      ele.opacity = 0;
    } else {
      const block = std.view.getBlock(ele.id);
      if (!block) return;
      block.classList.add('copy-as-image-transparent');
    }
  });
}

function showEdgelessElements(elements: GfxModel[], std: BlockStdScope) {
  elements.forEach(ele => {
    if (ele instanceof GfxPrimitiveElementModel) {
      ele.opacity = (ele as any).lastOpacity;
      delete (ele as any).lastOpacity;
    } else {
      const block = std.view.getBlock(ele.id);
      if (!block) return;
      block.classList.remove('copy-as-image-transparent');
    }
  });
}

function withDescendantElements(elements: GfxModel[]) {
  const set = new Set<GfxModel>();
  elements.forEach(element => {
    if (set.has(element)) return;
    set.add(element);
    if (isGfxGroupCompatibleModel(element)) {
      element.descendantElements.forEach((descendant: GfxModel) => set.add(descendant));
    }
  });
  return [...set];
}

const MARGIN = 20;

export function copyAsImage(std: BlockStdScope) {
  const isElectronAvailable = !!apis; // 保留变量，但不再使用 Electron 剪贴板路径

  const gfx = std.get(GfxControllerIdentifier);

  let selected = gfx.selection.selectedElements;
  // select mindmap if root node selected
  const maybeMindmap = selected[0];
  const mindmapId = maybeMindmap.group?.id;
  if (
    selected.length === 1 &&
    mindmapId &&
    (isMindMapRoot(maybeMindmap) || isMindmapChild(maybeMindmap))
  ) {
    gfx.selection.set({ elements: [mindmapId] });
  }

  // select bound
  selected = gfx.selection.selectedElements;
  const elements = withDescendantElements(selected);
  const bounds = elements.map(element => Bound.deserialize(element.xywh));
  const bound = getCommonBound(bounds);
  if (!bound) return;
  const { zoom } = gfx.viewport;
  const exBound = expandBound(bound, MARGIN * zoom);

  // fit to screen
  if (
    !isInside(gfx.viewport.viewportBounds, exBound) ||
    gfx.viewport.zoom < 1
  ) {
    gfx.viewport.setViewportByBound(bound, [20, 20, 20, 20], false);
    if (gfx.viewport.zoom > 1) {
      gfx.viewport.setZoom(1);
    }
  }

  // hide unselected overlap elements
  const overlapElements = gfx.gfxElements.filter((ele: GfxModel) => {
    const eleBound = Bound.deserialize(ele.xywh);
    const exEleBound = expandBound(eleBound, MARGIN * zoom);
    const isSelected = elements.includes(ele);
    return !isSelected && isOverlap(exBound, exEleBound);
  });
  hideEdgelessElements(overlapElements, std);

  // add css style
  const styleEle = document.createElement('style');
  styleEle.innerHTML = snapshotStyle;
  document.head.append(styleEle);

  // capture image
  setTimeout(() => {
    try {
      const domRect = getSelectedRect();
      const { zoom } = gfx.viewport;
      const isFrameSelected =
        selected.length === 1 &&
        (selected[0] as GfxBlockElementModel).flavour === 'affine:frame';
      const margin = isFrameSelected ? -2 : MARGIN * zoom;

      gfx.selection.clear();

      const area = {
        x: domRect.left - margin,
        y: domRect.top - margin,
        width: domRect.width + margin * 2,
        height: domRect.height + margin * 2,
      };

      (async () => {
        // 统一使用 html2canvas 截取并下载 PNG
        // @ts-expect-error html2canvas module is available at runtime in workspace
        const html2canvas = (await import('html2canvas')).default as any;
        const HARD_MAX_SIDE = 16384; // 硬上限，避免浏览器内存溢出 8192 , 12288 , 16384
        const dpr = (window.devicePixelRatio || 1) * 3; // 或 *3 提升清晰度
        const maxDim = Math.max(area.width, area.height);
        let scale = dpr;
        if (maxDim * scale > HARD_MAX_SIDE) {
          scale = Math.max(1, HARD_MAX_SIDE / maxDim);
        }
        const canvas = await html2canvas(document.body as HTMLElement, {
          backgroundColor: null,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          scale,
          useCORS: true,
          onclone: (documentClone: Document, element: HTMLElement) => {
            // 去除 transform 避免失真
            element.style.setProperty('transform', 'none');
            const layer = documentClone.querySelector('.affine-edgeless-layer');
            if (layer && layer instanceof HTMLElement) {
              layer.style.setProperty('transform', 'none');
            }
            // 去除 box-shadow 避免锯齿/阴影 artifacts
            const boxShadowEles = documentClone.querySelectorAll("[style*='box-shadow']");
            boxShadowEles.forEach(el => {
              if (el instanceof HTMLElement) {
                el.style.setProperty('box-shadow', 'none');
              }
            });
          },
        });

        const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Failed to generate image blob');

        const a = document.createElement('a');
        a.download = 'affine-snapshot.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);

        notify.success({
          title: I18n.t('com.affine.copy.asImage.success'),
        });
      })()
        .catch((e: unknown) => {
          notify.error({
            title: I18n.t('com.affine.copy.asImage.failed'),
            message: String(e),
          });
        })
        .finally(() => {
          styleEle.remove();
          showEdgelessElements(overlapElements, std);
        });
    } catch (e: unknown) {
      styleEle.remove();
      showEdgelessElements(overlapElements, std);
      notify.error({
        title: I18n.t('com.affine.copy.asImage.failed'),
        message: String(e),
      });
    }
  }, 100);
}

export function createCopyAsPngMenuItem(framework: FrameworkProvider) {
  return {
    icon: CopyAsImgaeIcon({ width: '20', height: '20' }),
    label: 'Copy as Image',
    type: 'copy-as-image',
    when: (ctx: MenuContext) => {
      if (ctx.isEmpty()) return false;
      const { editor } = framework.get(EditorService);
      const mode = editor.mode$.value;
      return mode === 'edgeless';
    },
    action: (ctx: MenuContext) => {
      const std = ctx.std;
      return copyAsImage(std);
    },
  };
}

