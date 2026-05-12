import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type { LlmImageResponse } from '../../../../native';
import { CopilotStorage } from '../../storage';

@Injectable()
export class ImageResultHost {
  private readonly logger = new Logger(ImageResultHost.name);

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
    this.logger.log(
      `[image-persist] workspaceId=${workspaceId} hasUrl=${!!artifact.url} hasDataBase64=${!!artifact.data_base64} hasB64Json=${!!artifact.b64_json} mediaType=${artifact.media_type ?? artifact.mimeType ?? 'n/a'} outputFormat=${artifact.output_format ?? 'n/a'}`
    );
    if (encoded) {
      const buffer = Buffer.from(encoded, 'base64');
      const filename = cryptoHash(buffer);
      const mediaType = resolveImageMimeType(artifact);
      if (!mediaType) {
        return null;
      }
      const stored = await this.storage.put(
        userId,
        workspaceId,
        filename,
        buffer,
        mediaType
      );
      this.logger.log(
        `[image-persist] storedBase64Artifact workspaceId=${workspaceId} mimeType=${mediaType} result=${truncateForLog(stored)}`
      );
      return stored;
    }
    if (artifact.url) {
      const stored = await this.persistRemoteLink(userId, workspaceId, artifact.url);
      this.logger.log(
        `[image-persist] storedRemoteArtifact workspaceId=${workspaceId} sourceUrl=${truncateForLog(artifact.url)} result=${truncateForLog(stored)}`
      );
      return stored;
    }
    this.logger.warn('[image-persist] skipped artifact because no url/base64 payload found');
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

function truncateForLog(value: string, max = 160) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
