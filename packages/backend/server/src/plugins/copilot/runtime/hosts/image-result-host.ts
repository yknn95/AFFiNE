import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { LlmImageResponse } from '../../../../native';
import { CopilotStorage } from '../../storage';

@Injectable()
export class ImageResultHost {
  constructor(private readonly storage: CopilotStorage) {}

  async persistRemoteLink(userId: string, workspaceId: string, link: string) {
    return await this.storage.handleRemoteLink(userId, workspaceId, link);
  }

  async persistNativeArtifact(
    userId: string,
    workspaceId: string,
    artifact: LlmImageResponse['images'][number] & { mimeType?: string }
  ) {
    const encoded = artifact.data_base64 ?? artifact.b64_json;
    if (encoded) {
      const buffer = Buffer.from(encoded, 'base64');
      const filename = cryptoHash(buffer);
      const mediaType = resolveImageMimeType(artifact);
      if (!mediaType) {
        return null;
      }
      return await this.storage.put(
        userId,
        workspaceId,
        filename,
        buffer,
        mediaType
      );
    }
    if (artifact.url) {
      return await this.persistRemoteLink(userId, workspaceId, artifact.url);
    }
    return null;
  }
}

function cryptoHash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('base64url');
}

function resolveImageMimeType(
  artifact: LlmImageResponse['images'][number] & { mimeType?: string }
) {
  if (artifact.media_type) {
    return artifact.media_type;
  }
  if (artifact.mimeType) {
    return artifact.mimeType;
  }
  if (artifact.output_format) {
    return normalizeOutputFormatToMimeType(artifact.output_format);
  }
  return 'image/png';
}

function normalizeOutputFormatToMimeType(format: string) {
  switch (format.toLowerCase()) {
    case 'jpg':
      return 'image/jpeg';
    case 'png':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return `image/${format.toLowerCase()}`;
    default:
      return `image/${format.toLowerCase()}`;
  }
}
