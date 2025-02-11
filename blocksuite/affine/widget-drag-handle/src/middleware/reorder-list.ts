import { correctNumberedListsOrderToPrev } from '@blocksuite/affine-block-list';
import { matchFlavours } from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/block-std';
import type { JobMiddleware } from '@blocksuite/store';

export const reorderList =
  (std: BlockStdScope): JobMiddleware =>
  ({ slots }) => {
    slots.afterImport.on(payload => {
      if (payload.type === 'block') {
        const model = payload.model;
        if (
          matchFlavours(model, ['affine:list']) &&
          model.type === 'numbered'
        ) {
          const next = std.doc.getNext(model);
          correctNumberedListsOrderToPrev(std.doc, model);
          if (next) {
            correctNumberedListsOrderToPrev(std.doc, next);
          }
        }
      }
    });
  };
