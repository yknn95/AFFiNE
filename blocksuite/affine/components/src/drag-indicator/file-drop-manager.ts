import {
  calcDropTarget,
  type DropResult,
  getClosestBlockComponentByPoint,
  isInsidePageEditor,
  matchFlavours,
} from '@blocksuite/affine-shared/utils';
import {
  type BlockStdScope,
  type EditorHost,
  type ExtensionType,
  LifeCycleWatcher,
} from '@blocksuite/block-std';
import { createIdentifier } from '@blocksuite/global/di';
import type { IVec } from '@blocksuite/global/utils';
import { Point } from '@blocksuite/global/utils';
import type { BlockModel } from '@blocksuite/store';

import type { DragIndicator } from './index.js';

export type onDropProps = {
  std: BlockStdScope;
  files: File[];
  targetModel: BlockModel | null;
  place: 'before' | 'after';
  point: IVec;
};

export type FileDropOptions = {
  flavour: string;
  onDrop?: (onDropProps: onDropProps) => boolean;
};

export class FileDropExtension extends LifeCycleWatcher {
  static override readonly key = 'FileDropExtension';

  static dropResult: DropResult | null = null;

  static get indicator() {
    let indicator = document.querySelector<DragIndicator>(
      'affine-drag-indicator'
    );

    if (!indicator) {
      indicator = document.createElement(
        'affine-drag-indicator'
      ) as DragIndicator;
      document.body.append(indicator);
    }

    return indicator;
  }

  onDragLeave = () => {
    FileDropExtension.dropResult = null;
    FileDropExtension.indicator.rect = null;
  };

  onDragMove = (event: DragEvent) => {
    event.preventDefault();

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    const effectAllowed = dataTransfer.effectAllowed;
    if (effectAllowed === 'none') return;

    const { clientX, clientY } = event;
    const point = new Point(clientX, clientY);
    const element = getClosestBlockComponentByPoint(point.clone());

    let result: DropResult | null = null;
    if (element) {
      const model = element.model;
      const parent = this.std.doc.getParent(model);
      if (!matchFlavours(parent, ['affine:surface' as BlockSuite.Flavour])) {
        result = calcDropTarget(point, model, element);
      }
    }
    if (result) {
      FileDropExtension.dropResult = result;
      FileDropExtension.indicator.rect = result.rect;
    } else {
      FileDropExtension.dropResult = null;
      FileDropExtension.indicator.rect = null;
    }
  };

  get targetModel(): BlockModel | null {
    let targetModel = FileDropExtension.dropResult?.modelState.model || null;

    if (!targetModel && isInsidePageEditor(this.editorHost)) {
      const rootModel = this.doc.root;
      if (!rootModel) return null;

      let lastNote = rootModel.children[rootModel.children.length - 1];
      if (!lastNote || !matchFlavours(lastNote, ['affine:note'])) {
        const newNoteId = this.doc.addBlock('affine:note', {}, rootModel.id);
        const newNote = this.doc.getBlockById(newNoteId);
        if (!newNote) return null;
        lastNote = newNote;
      }

      const lastItem = lastNote.children[lastNote.children.length - 1];
      if (lastItem) {
        targetModel = lastItem;
      } else {
        const newParagraphId = this.doc.addBlock(
          'affine:paragraph',
          {},
          lastNote,
          0
        );
        const newParagraph = this.doc.getBlockById(newParagraphId);
        if (!newParagraph) return null;
        targetModel = newParagraph;
      }
    }
    return targetModel;
  }

  get doc() {
    return this.std.doc;
  }

  get editorHost(): EditorHost {
    return this.std.host;
  }

  get type(): 'before' | 'after' {
    return !FileDropExtension.dropResult ||
      FileDropExtension.dropResult.type !== 'before'
      ? 'after'
      : 'before';
  }

  private readonly _onDrop = (event: DragEvent, options: FileDropOptions) => {
    FileDropExtension.indicator.rect = null;

    const { onDrop } = options;
    if (!onDrop) return;

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    const effectAllowed = dataTransfer.effectAllowed;
    if (effectAllowed === 'none') return;

    const droppedFiles = dataTransfer.files;
    if (!droppedFiles || !droppedFiles.length) return;

    const { clientX, clientY } = event;
    const point = new Point(clientX, clientY);
    const element = getClosestBlockComponentByPoint(point.clone());

    let result: DropResult | null = null;
    if (element) {
      const model = element.model;
      const parent = this.std.doc.getParent(model);
      if (!matchFlavours(parent, ['affine:surface' as BlockSuite.Flavour])) {
        result = calcDropTarget(point, model, element);
      }
    }
    FileDropExtension.dropResult = result;

    const { x, y } = event;
    const { targetModel, type: place } = this;
    const drop = onDrop({
      std: this.std,
      files: [...droppedFiles],
      targetModel,
      place,
      point: [x, y],
    });

    if (drop) {
      event.preventDefault();
    }
    return drop;
  };

  override mounted() {
    super.mounted();
    const std = this.std;

    std.event.disposables.add(
      std.event.add('nativeDragMove', context => {
        const event = context.get('dndState');
        this.onDragMove(event.raw);
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDragLeave', () => {
        this.onDragLeave();
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDrop', context => {
        const values = std.provider
          .getAll(FileDropConfigExtensionIdentifier)
          .values();

        for (const value of values) {
          if (value.onDrop) {
            const event = context.get('dndState');
            const drop = this._onDrop(event.raw, value);
            if (drop) {
              return;
            }
          }
        }
      })
    );
  }
}

const FileDropConfigExtensionIdentifier = createIdentifier<FileDropOptions>(
  'FileDropConfigExtension'
);

export const FileDropConfigExtension = (
  options: FileDropOptions
): ExtensionType => {
  const identifier = FileDropConfigExtensionIdentifier(options.flavour);
  return {
    setup: di => {
      di.addImpl(identifier, () => options);
    },
  };
};
