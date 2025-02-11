import type { BlockComponent } from '@blocksuite/block-std';
import { type Point, Rect } from '@blocksuite/global/utils';
import type { BlockModel } from '@blocksuite/store';

import { BLOCK_CHILDREN_CONTAINER_PADDING_LEFT } from '../../consts/index.js';
import {
  getClosestBlockComponentByElement,
  getRectByBlockComponent,
} from '../dom/index.js';
import { matchFlavours } from '../model/index.js';
import { getDropRectByPoint } from './get-drop-rect-by-point.js';
import { DropFlags, type DroppingType, type DropResult } from './types.js';

function getVisiblePreviousElementSibling(element: Element | null) {
  if (!element) return null;
  let prev = element.previousElementSibling;
  while (prev && !prev.checkVisibility()) {
    prev = prev.previousElementSibling;
  }
  return prev;
}

function getVisibleNextElementSibling(element: Element | null) {
  if (!element) return null;
  let next = element.nextElementSibling;
  while (next && !next.checkVisibility()) {
    next = next.nextElementSibling;
  }
  return next;
}

/**
 * Calculates the drop target.
 */
export function calcDropTarget(
  point: Point,
  model: BlockModel,
  element: Element,
  draggingElements: BlockComponent[] = [],
  scale: number = 1,
  /**
   * Allow the dragging block to be dropped as sublist
   */
  allowSublist: boolean = true
): DropResult | null {
  const schema = model.doc.getSchemaByFlavour('affine:database');
  const children = schema?.model.children ?? [];

  let shouldAppendToDatabase = true;

  if (children.length && draggingElements.length) {
    shouldAppendToDatabase = draggingElements
      .map(el => el.model)
      .every(m => children.includes(m.flavour));
  }

  if (!shouldAppendToDatabase && !matchFlavours(model, ['affine:database'])) {
    const databaseBlockComponent =
      element.closest<BlockComponent>('affine-database');
    if (databaseBlockComponent) {
      element = databaseBlockComponent;
      model = databaseBlockComponent.model;
    }
  }

  let type: DroppingType = 'none';
  const height = 3 * scale;
  const dropResult = getDropRectByPoint(point, model, element);
  if (!dropResult) return null;
  const { rect: domRect, flag } = dropResult;

  if (flag === DropFlags.EmptyDatabase) {
    // empty database
    const rect = Rect.fromDOMRect(domRect);
    rect.top -= height / 2;
    rect.height = height;
    type = 'database';

    return {
      type,
      rect,
      modelState: {
        model,
        rect: domRect,
        element: element as BlockComponent,
      },
    };
  } else if (flag === DropFlags.Database) {
    // not empty database
    const distanceToTop = Math.abs(domRect.top - point.y);
    const distanceToBottom = Math.abs(domRect.bottom - point.y);
    const before = distanceToTop < distanceToBottom;
    type = before ? 'before' : 'after';

    return {
      type,
      rect: Rect.fromLWTH(
        domRect.left,
        domRect.width,
        (before ? domRect.top - 1 : domRect.bottom) - height / 2,
        height
      ),
      modelState: {
        model,
        rect: domRect,
        element: element as BlockComponent,
      },
    };
  }

  const distanceToTop = Math.abs(domRect.top - point.y);
  const distanceToBottom = Math.abs(domRect.bottom - point.y);
  const before = distanceToTop < distanceToBottom;

  type = before ? 'before' : 'after';
  let offsetY = 4;

  if (type === 'before') {
    // before
    let prev;
    let prevRect;

    prev = getVisiblePreviousElementSibling(element);
    if (prev) {
      if (
        draggingElements.length &&
        prev === draggingElements[draggingElements.length - 1]
      ) {
        type = 'none';
      } else {
        prevRect = getRectByBlockComponent(prev);
      }
    } else {
      prev = getVisiblePreviousElementSibling(element.parentElement);
      if (prev) {
        prevRect = prev.getBoundingClientRect();
      }
    }

    if (prevRect) {
      offsetY = (domRect.top - prevRect.bottom) / 2;
    }
  } else {
    // Only consider drop as children when target block is list block.
    // To drop in, the position must after the target first
    // If drop in target has children, we can use insert before or after of that children
    // to achieve the same effect.
    const hasChild = (element as BlockComponent).childBlocks.length;
    if (
      allowSublist &&
      matchFlavours(model, ['affine:list']) &&
      !hasChild &&
      point.x > domRect.x + BLOCK_CHILDREN_CONTAINER_PADDING_LEFT
    ) {
      type = 'in';
    }
    // after
    let next;
    let nextRect;

    next = getVisibleNextElementSibling(element);
    if (next) {
      if (
        type === 'after' &&
        draggingElements.length &&
        next === draggingElements[0]
      ) {
        type = 'none';
        next = null;
      }
    } else {
      next = getVisibleNextElementSibling(
        getClosestBlockComponentByElement(element.parentElement)
      );
    }

    if (next) {
      nextRect = getRectByBlockComponent(next);
      offsetY = (nextRect.top - domRect.bottom) / 2;
    }
  }

  if (type === 'none') return null;

  let top = domRect.top;
  if (type === 'before') {
    top -= offsetY;
  } else {
    top += domRect.height + offsetY;
  }

  if (type === 'in') {
    domRect.x += BLOCK_CHILDREN_CONTAINER_PADDING_LEFT;
    domRect.width -= BLOCK_CHILDREN_CONTAINER_PADDING_LEFT;
  }

  return {
    type,
    rect: Rect.fromLWTH(domRect.left, domRect.width, top - height / 2, height),
    modelState: {
      model,
      rect: domRect,
      element: element as BlockComponent,
    },
  };
}
