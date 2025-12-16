import { notify } from '@affine/component';
import { isMindmapChild, isMindMapRoot } from '@affine/core/blocksuite/ai';
import { EditorService } from '@affine/core/modules/editor';
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
  /* 确保连接器（思维导图线条）在截图时可见 */
  .affine-edgeless-connector, 
  .affine-connector,
  [data-type="connector"],
  [data-connector-id] {
    opacity: 1 !important;
    visibility: visible !important;
    display: block !important;
  }
`;

// 已不再依赖 DOM 选区截图
// 移除 DOM 选区依赖

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
      element.descendantElements.forEach((descendant: GfxModel) =>
        set.add(descendant)
      );
    }
  });
  return [...set];
}

const MARGIN = 20;

export function copyAsImage(std: BlockStdScope) {
  // 兼容 Web：不再依赖 Electron apis

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

  // 不再调整视口，避免影响用户当前视图

  // hide unselected overlap elements
  // 但保留连接器元素（思维导图线条）
  const overlapElements = gfx.gfxElements.filter((ele: GfxModel) => {
    const eleBound = Bound.deserialize(ele.xywh);
    const exEleBound = expandBound(eleBound, MARGIN * zoom);
    const isSelected = elements.includes(ele);
    
    // 如果是连接器元素（思维导图线条），不隐藏它
    if (ele.type === 'connector' || ele.flavour === 'affine:connector') {
      return false;
    }
    
    return !isSelected && isOverlap(exBound, exEleBound);
  });
  hideEdgelessElements(overlapElements, std);

  // add css style
  const styleEle = document.createElement('style');
  styleEle.innerHTML = snapshotStyle;
  document.head.append(styleEle);

  // 生成 PNG 并下载
  setTimeout(async () => {
    try {
      const SCALE = 1;
      
      // 改进分类逻辑：明确区分块元素、画布元素和连接器
      const blocks = elements.filter(
        e => !(e instanceof GfxPrimitiveElementModel) && 
             e.type !== 'connector' && e.flavour !== 'affine:connector'
      ) as GfxModel[] as GfxBlockElementModel[];
      
      const canvasElements = elements.filter(
        e => e instanceof GfxPrimitiveElementModel
      ) as GfxPrimitiveElementModel[];
      
      // 获取所有连接器元素（思维导图线条）
      const connectorElements = elements.filter(
        e => e.type === 'connector' || e.flavour === 'affine:connector'
      ) as GfxModel[];

      // 输出画布
      const outCanvas = document.createElement('canvas');
      const dpr = (window.devicePixelRatio || 1) * SCALE;
      outCanvas.width = Math.max(1, Math.floor(bound.w * dpr));
      outCanvas.height = Math.max(1, Math.floor(bound.h * dpr));
      outCanvas.style.width = `${bound.w}px`;
      outCanvas.style.height = `${bound.h}px`;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) throw new Error('Canvas context not available');
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';

      // 根据当前背景（黑/白）填充基础画布
      const getRgb = (color: string): { r: number; g: number; b: number } | null => {
        if (!color) return null;
        const c = color.trim();
        // rgb/rgba
        const rgbMatch = c.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\)$/i);
        if (rgbMatch) {
          return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
        }
        // hex #rgb or #rrggbb
        const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
          let hex = hexMatch[1];
          if (hex.length === 3) {
            hex = hex.split('').map(ch => ch + ch).join('');
          }
          const num = parseInt(hex, 16);
          return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
        }
        return null;
      };
      const getLuminance = (rgb: { r: number; g: number; b: number }) => {
        // perceived luminance
        return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
      };
      let bgColor = '';
      const bgElm = document.querySelector('.edgeless-background') as HTMLElement | null;
      if (bgElm) {
        bgColor = getComputedStyle(bgElm).backgroundColor || '';
      }
      if (!bgColor) {
        const rootStyle = getComputedStyle(document.documentElement);
        bgColor = rootStyle.getPropertyValue('--affine-background-primary-color').trim();
      }
      const rgb = getRgb(bgColor);
      const isDark = rgb ? getLuminance(rgb) < 0.5 : false;
      outCtx.fillStyle = isDark ? '#000' : '#fff';
      outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

      // 绘制画布元素（shape、线条等）
      const surfaceComponent = (gfx as any).surfaceComponent;
      const renderer = surfaceComponent?.renderer;
      if (renderer?.getCanvasByBound) {
        // 绘制基础画布元素
        const canvasLayer = renderer.getCanvasByBound(
          bound,
          canvasElements,
          undefined,
          false,
          false,
          SCALE
        );
        outCtx.drawImage(canvasLayer, 0, 0);
        
        // 单独绘制连接器元素，确保它们显示在正确的层级
        if (connectorElements.length > 0) {
          try {
            const connectorLayer = renderer.getCanvasByBound(
              bound,
              connectorElements as any,
              undefined,
              false,
              false,
              SCALE
            );
            if (connectorLayer) {
              outCtx.drawImage(connectorLayer, 0, 0);
            }
          } catch (e) {
            console.warn('Failed to render connector elements:', e);
          }
        }
      }

      // 绘制块（文本、卡片等 DOM 渲染内容）
      const html2canvas = (await import('html2canvas')).default;
      
      // 先绘制标准块元素
      for (const block of blocks) {
        const blockComponent = std.view.getBlock(block.id) as HTMLElement | null;
        if (!blockComponent) continue;
        const blockBound = Bound.deserialize((block as any).xywh);
        const blockCanvas = await html2canvas(blockComponent, {
          backgroundColor: 'transparent',
          scale: SCALE,
          onclone: async (documentClone: Document, element: HTMLElement) => {
            // 移除 transform/阴影，避免 html2canvas 错位
            element.style.setProperty('transform', 'none');
            const layer = documentClone.querySelector('.affine-edgeless-layer');
            if (layer && layer instanceof HTMLElement) {
              layer.style.setProperty('transform', 'none');
            }
            const boxShadowEles = documentClone.querySelectorAll("[style*='box-shadow']");
            boxShadowEles.forEach(ele => {
              if (ele instanceof HTMLElement) {
                ele.style.setProperty('box-shadow', 'none');
              }
            });
          },
          useCORS: true,
        });
        const dx = (blockBound.x - bound.x) * dpr;
        const dy = (blockBound.y - bound.y) * dpr;
        const dw = blockBound.w * dpr;
        const dh = blockBound.h * dpr;
        outCtx.drawImage(blockCanvas, dx, dy, dw, dh);
      }
      
      // 备用方案：如果连接器是DOM元素，尝试单独渲染它们
      if (connectorElements.length > 0) {
        console.log('尝试作为DOM元素渲染连接器...');
        for (const connector of connectorElements) {
          const connectorComponent = std.view.getBlock(connector.id) as HTMLElement | null;
          if (connectorComponent) {
            try {
              const connectorBound = Bound.deserialize((connector as any).xywh);
              const connectorCanvas = await html2canvas(connectorComponent, {
                backgroundColor: 'transparent',
                scale: SCALE,
                onclone: (documentClone, element) => {
                  element.style.setProperty('transform', 'none');
                },
                useCORS: true,
              });
              const dx = (connectorBound.x - bound.x) * dpr;
              const dy = (connectorBound.y - bound.y) * dpr;
              const dw = connectorBound.w * dpr;
              const dh = connectorBound.h * dpr;
              outCtx.drawImage(connectorCanvas, dx, dy, dw, dh);
            } catch (e) {
              console.warn('Failed to render connector as DOM element:', e);
            }
          }
        }
      }

      // 清理选择与样式，并导出 PNG
      gfx.selection.clear();

      const blob: Blob | null = await new Promise(resolve =>
        outCanvas.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error('Failed to export PNG');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'affine-export.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      notify.success({
        title: I18n.t('com.affine.copy.asImage.success'),
      });
    } catch (e) {
      notify.error({
        title: I18n.t('com.affine.copy.asImage.failed'),
        message: String(e),
      });
    } finally {
      styleEle.remove();
      showEdgelessElements(overlapElements, std);
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

