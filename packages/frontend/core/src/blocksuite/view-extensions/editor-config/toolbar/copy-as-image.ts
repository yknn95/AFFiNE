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
        // 使用 SVG foreignObject 包裹 DOM，再按高倍率栅格化为 PNG，减少模糊
        const HARD_MAX_SIDE = 16384;
        const dpr = window.devicePixelRatio || 1;
        const maxDim = Math.max(area.width, area.height);
        let scale = dpr * 3;
        if (maxDim * scale > HARD_MAX_SIDE) {
          scale = Math.max(1, HARD_MAX_SIDE / maxDim);
        }

        const collectCssText = () => {
          let cssText = '';
          for (const sheet of Array.from(document.styleSheets)) {
            try {
              const rules = (sheet as CSSStyleSheet).cssRules;
              if (!rules) continue;
              for (const rule of Array.from(rules)) {
                cssText += (rule as CSSRule).cssText + '\n';
              }
            } catch (_e) {
              // ignore cross-origin stylesheets
            }
          }
          return cssText;
        };

        // 仅克隆编辑视口，减少体积；通过 translate 将选区对齐到 (0,0)
        const rootEl = document.querySelector('affine-edgeless-root')?.parentElement || document.body;
        const cloned = rootEl.cloneNode(true) as HTMLElement;
        const wrapper = document.createElement('div');
        wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        wrapper.style.width = `${rootEl.clientWidth}px`;
        wrapper.style.height = `${rootEl.clientHeight}px`;
        wrapper.style.overflow = 'hidden';
        wrapper.style.transform = `translate(${-area.x}px, ${-area.y}px)`;
        wrapper.appendChild(cloned);

        const cssText = collectCssText();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', String(area.width));
        svg.setAttribute('height', String(area.height));
        svg.setAttribute('viewBox', `0 0 ${area.width} ${area.height}`);

        const style = document.createElement('style');
        style.textContent = cssText;
        svg.appendChild(style);

        const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreign.setAttribute('x', '0');
        foreign.setAttribute('y', '0');
        foreign.setAttribute('width', String(area.width));
        foreign.setAttribute('height', String(area.height));
        foreign.appendChild(wrapper);
        svg.appendChild(foreign);

        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(svg);
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = e => reject(e);
          img.src = svgUrl;
        });

        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(area.width * scale));
        out.height = Math.max(1, Math.round(area.height * scale));
        const octx = out.getContext('2d');
        if (!octx) throw new Error('Failed to get canvas context');
        octx.scale(scale, scale);
        octx.drawImage(img, 0, 0);
        URL.revokeObjectURL(svgUrl);

        const blob: Blob | null = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
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

