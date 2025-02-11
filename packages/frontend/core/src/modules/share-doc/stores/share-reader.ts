import { ErrorNames, UserFriendlyError } from '@affine/graphql';
import type { DocMode } from '@blocksuite/affine/blocks';
import { Store } from '@toeverything/infra';

import type { ServersService } from '../../cloud';
import { isBackendError } from '../../cloud';

export class ShareReaderStore extends Store {
  constructor(private readonly serversService: ServersService) {
    super();
  }

  async loadShare(serverId: string, workspaceId: string, docId: string) {
    const server = this.serversService.server$(serverId).value;
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    try {
      const docResponse = await server.fetch(
        `/api/workspaces/${workspaceId}/docs/${docId}`
      );
      const publishMode = docResponse.headers.get(
        'publish-mode'
      ) as DocMode | null;
      const docBinary = await docResponse.arrayBuffer();

      const workspaceResponse = await server.fetch(
        `/api/workspaces/${workspaceId}/docs/${workspaceId}`
      );
      const workspaceBinary = await workspaceResponse.arrayBuffer();

      return {
        doc: new Uint8Array(docBinary),
        workspace: new Uint8Array(workspaceBinary),
        publishMode,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        isBackendError(error) &&
        UserFriendlyError.fromAnyError(error).name === ErrorNames.ACCESS_DENIED
      ) {
        return null;
      }
      throw error;
    }
  }
}
