import { PageViewportService } from '@blocksuite/affine-shared/services';
import { getScrollContainer } from '@blocksuite/affine-shared/utils';

import type { AffineDragHandleWidget } from '../drag-handle.js';

export class PageWatcher {
  get pageViewportService() {
    return this.widget.std.get(PageViewportService);
  }

  constructor(readonly widget: AffineDragHandleWidget) {}

  watch() {
    const { disposables } = this.widget;
    const scrollContainer = getScrollContainer(this.widget.rootComponent);

    disposables.add(
      this.widget.doc.slots.blockUpdated.on(() => this.widget.hide())
    );

    disposables.add(
      this.pageViewportService.on(() => {
        this.widget.hide();
        if (this.widget.dropIndicator) {
          this.widget.dropIndicator.rect = null;
        }
      })
    );

    disposables.addFromEvent(
      scrollContainer,
      'scrollend',
      this.widget.updateDropIndicatorOnScroll
    );
  }
}
