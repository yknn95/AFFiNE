import type { BlockComponent } from '@blocksuite/block-std';
import type { Rect } from '@blocksuite/global/utils';
import type { BlockModel } from '@blocksuite/store';

export interface EditingState {
  element: BlockComponent;
  model: BlockModel;
  rect: DOMRect;
}

/**
 * Returns a flag for the drop target.
 */
export enum DropFlags {
  Normal,
  Database,
  EmptyDatabase,
}

/**
 * A dropping type.
 */
export type DroppingType = 'none' | 'before' | 'after' | 'database' | 'in';

export type DropResult = {
  type: DroppingType;
  rect: Rect;
  modelState: EditingState;
};
