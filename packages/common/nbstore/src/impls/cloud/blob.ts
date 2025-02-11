import {
  deleteBlobMutation,
  gqlFetcherFactory,
  listBlobsQuery,
  releaseDeletedBlobsMutation,
  setBlobMutation,
} from '@affine/graphql';

import { DummyConnection } from '../../connection';
import {
  type BlobRecord,
  BlobStorageBase,
  type BlobStorageOptions,
} from '../../storage';

interface CloudBlobStorageOptions extends BlobStorageOptions {
  apiBaseUrl: string;
}

export class CloudBlobStorage extends BlobStorageBase<CloudBlobStorageOptions> {
  private readonly gql = gqlFetcherFactory(
    this.options.apiBaseUrl + '/graphql'
  );
  override connection = new DummyConnection();

  override async get(key: string) {
    const res = await fetch(
      this.options.apiBaseUrl +
        '/api/workspaces/' +
        this.spaceId +
        '/blobs/' +
        key,
      {
        cache: 'default',
        headers: {
          'x-affine-version': BUILD_CONFIG.appVersion,
        },
      }
    );

    if (!res.ok) {
      return null;
    }

    const data = await res.arrayBuffer();

    return {
      key,
      data: new Uint8Array(data),
      mime: res.headers.get('content-type') || '',
      size: data.byteLength,
      createdAt: new Date(res.headers.get('last-modified') || Date.now()),
    };
  }

  override async set(blob: BlobRecord) {
    await this.gql({
      query: setBlobMutation,
      variables: {
        workspaceId: this.spaceId,
        blob: new File([blob.data], blob.key, { type: blob.mime }),
      },
    });
  }

  override async delete(key: string, permanently: boolean) {
    await this.gql({
      query: deleteBlobMutation,
      variables: { workspaceId: this.spaceId, key, permanently },
    });
  }

  override async release() {
    await this.gql({
      query: releaseDeletedBlobsMutation,
      variables: { workspaceId: this.spaceId },
    });
  }

  override async list() {
    const res = await this.gql({
      query: listBlobsQuery,
      variables: { workspaceId: this.spaceId },
    });

    return res.workspace.blobs.map(blob => ({
      ...blob,
      createdAt: new Date(blob.createdAt),
    }));
  }
}
