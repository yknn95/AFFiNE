import type { EditorHost } from '@blocksuite/block-std';
import { GfxControllerIdentifier } from '@blocksuite/block-std/gfx';
import {
  type EdgelessRootBlockComponent,
  type MindmapElementModel,
  type MindmapSurfaceBlock,
  MiniMindmapPreview,
} from '@blocksuite/blocks';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { getDocRootBlock } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';

describe('mini mindmap preview', () => {
  let edgeless!: EdgelessRootBlockComponent;

  const createPreview = (host: EditorHost, answer: string) => {
    const mindmapPreview = new MiniMindmapPreview();

    mindmapPreview.answer = answer;
    mindmapPreview.host = host;
    mindmapPreview.ctx = {
      get() {
        return {};
      },
      set() {},
    };

    document.body.append(mindmapPreview);

    return mindmapPreview;
  };

  beforeEach(async () => {
    const cleanup = await setupEditor('edgeless');

    edgeless = getDocRootBlock(doc, editor, 'edgeless');

    edgeless.gfx.tool.setTool('default');

    return cleanup;
  });

  test('mini mindmap basic', async () => {
    const mindmapAnswer = `
  - Mindmap
    - Node 1
      - Node 1.1
      - Node 1.2
    - Node 2
      - Node 2.1
      - Node 2.2
  `;

    const miniMindMapPreview = createPreview(
      window.editor.host!,
      mindmapAnswer
    );
    await wait(50);
    const miniMindMapSurface = miniMindMapPreview.renderRoot.querySelector(
      'mini-mindmap-surface-block'
    ) as MindmapSurfaceBlock;

    // model-related properties
    expect(miniMindMapPreview.mindmapId).toBeDefined();
    expect(miniMindMapPreview.portalHost).toBeDefined();
    expect(miniMindMapPreview.doc).toBeDefined();
    expect(miniMindMapPreview.surface).toBeDefined();
    expect(miniMindMapPreview.surface!.elementModels.length).toBe(8);

    // renderer
    expect(miniMindMapSurface.renderer).toBeDefined();
    expect(miniMindMapSurface.renderer?.canvas.isConnected).toBe(true);
    expect(miniMindMapSurface.renderer?.canvas.width).toBeGreaterThan(0);
    expect(miniMindMapSurface.renderer?.canvas.height).toBeGreaterThan(0);

    return () => {
      miniMindMapPreview.remove();
    };
  });

  test('mini mindmap should layout automatically', async () => {
    const mindmapAnswer = `
  - Main node
    - Child node
    - Second child node
    - Third child node
  `;

    const miniMindMapPreview = createPreview(
      window.editor.host!,
      mindmapAnswer
    );

    await wait(50);
    const gfx = miniMindMapPreview.portalHost.std.get(GfxControllerIdentifier);
    const mindmap = gfx.surface!.elementModels.filter(
      model => model.type === 'mindmap'
    )[0] as MindmapElementModel;
    const [child1, child2, child3] = mindmap.tree.children;
    const root = mindmap.tree;

    expect(mindmap).not.toBeUndefined();

    expect(root.children.length).toBe(3);
    expect(root.element.x).toBeLessThan(child1.element.x);

    // children should be aligned horizontally
    expect(child1.element.x).toBe(child2.element.x);
    expect(child2.element.x).toBe(child3.element.x);

    // children
    expect(child1.element.y + child1.element.h).toBeLessThan(child2.element.y);
    expect(child2.element.y + child2.element.h).toBeLessThan(child3.element.y);
  });
});
