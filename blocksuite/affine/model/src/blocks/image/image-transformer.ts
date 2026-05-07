import type {
  BlockSnapshotLeaf,
  FromSnapshotPayload,
  SnapshotNode,
  ToSnapshotPayload,
} from '@blocksuite/store';
import { BaseBlockTransformer } from '@blocksuite/store';

import type { ImageBlockProps } from './image-model.js';

export class ImageBlockTransformer extends BaseBlockTransformer<ImageBlockProps> {
  override async fromSnapshot(
    payload: FromSnapshotPayload
  ): Promise<SnapshotNode<ImageBlockProps>> {
    const snapshotRet = await super.fromSnapshot(payload);
    const sourceId = snapshotRet.props.sourceId;
    const originalSourceId = snapshotRet.props.originalSourceId;

    if (!payload.assets.isEmpty()) {
      if (sourceId && !sourceId.startsWith('/'))
        await payload.assets.writeToBlob(sourceId);
      if (originalSourceId && !originalSourceId.startsWith('/'))
        await payload.assets.writeToBlob(originalSourceId);
    }

    return snapshotRet;
  }

  override toSnapshot(
    snapshot: ToSnapshotPayload<ImageBlockProps>
  ): BlockSnapshotLeaf {
    const snapshotRet = super.toSnapshot(snapshot);
    const sourceId = snapshot.model.props.sourceId;
    const originalSourceId = snapshot.model.props.originalSourceId;
    const pathBlobIdMap = snapshot.assets.getPathBlobIdMap();

    if (sourceId) {
      pathBlobIdMap.set(snapshot.model.id, sourceId);
    }
    if (originalSourceId) {
      pathBlobIdMap.set(`${snapshot.model.id}-original`, originalSourceId);
    }
    return snapshotRet;
  }
}
