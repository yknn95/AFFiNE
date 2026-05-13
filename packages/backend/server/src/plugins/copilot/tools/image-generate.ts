import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type { CapabilityRuntime } from '../runtime/capability-runtime';
import type { ImageResultHost } from '../runtime/hosts/image-result-host';
import { CopilotProviderType, type PromptMessage } from '../providers/types';
import { toolError } from './error';
import { defineTool } from './tool';

const logger = new Logger('ImageGenerateTool');

function pickLatestUserMessage(messages?: PromptMessage[]) {
  if (!messages?.length) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user') {
      return message;
    }
  }
  return null;
}

export const createImageGenerateTool = (
  getRuntime: () => CapabilityRuntime,
  getImageResults: () => ImageResultHost,
  context: {
    userId?: string;
    workspaceId?: string;
    sessionId?: string;
  }
) => {
  return defineTool({
    description:
      'Generate one or more images from a prompt. Use this when the user explicitly asks to create or generate an image, illustration, poster, cover, wallpaper, or similar visual asset.',
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .describe('The prompt to use for image generation'),
      size: z
        .string()
        .optional()
        .describe('Optional size hint such as 1024x1024 or 1536x1024'),
      quality: z
        .string()
        .optional()
        .describe('Optional quality hint such as low, medium, high, or hd'),
      count: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe('How many images to generate'),
    }),
    execute: async ({ prompt, size, quality, count }, options) => {
      const { userId, workspaceId, sessionId } = context;
      const runtime = getRuntime();
      const imageResults = getImageResults();
      const latestUserMessage = pickLatestUserMessage(options.messages);
      const attachments = latestUserMessage?.attachments;
      logger.log(
        `[image-generate] start sessionId=${sessionId ?? 'n/a'} workspaceId=${workspaceId ?? 'n/a'} userId=${userId ?? 'n/a'} prompt=${safeImagePreview(prompt)} size=${size ?? 'n/a'} quality=${quality ?? 'n/a'} count=${count ?? 1} sourceMessages=${safeImagePreview(
          options.messages?.map(message => ({
            role: message.role,
            content: message.content,
            params: message.params,
            attachmentsCount: message.attachments?.length ?? 0,
          }))
        )}`
      );
      const messages: PromptMessage[] = [
        {
          role: 'user',
          content: prompt,
          ...(attachments?.length ? { attachments } : {}),
        },
      ];

      try {
        const images: Array<Record<string, unknown>> = [];
        let generated = 0;

        for await (const artifact of runtime.streamImageArtifacts(
          {},
          messages,
          {
            ...(typeof size === 'string' ? { size } : {}),
            ...(typeof quality === 'string' ? { quality } : {}),
            ...(userId ? { user: userId } : {}),
            ...(workspaceId ? { workspace: workspaceId } : {}),
            ...(sessionId ? { session: sessionId } : {}),
            featureKind: 'image',
            signal: options.signal,
          },
          { prefer: CopilotProviderType.OpenAI }
        )) {
          logger.log(
            `[image-generate] artifact prompt=${safeImagePreview(prompt)} payload=${safeImagePreview(artifact)}`
          );
          const persisted =
            userId && workspaceId
              ? await imageResults.persistNativeArtifact(
                  userId,
                  workspaceId,
                  artifact
                )
              : artifact.url ?? null;
          images.push({
            ...(persisted ? { url: persisted } : {}),
            ...(typeof artifact.media_type === 'string'
              ? { mimeType: artifact.media_type }
              : {}),
            ...(typeof artifact.output_format === 'string'
              ? { output_format: artifact.output_format }
              : {}),
            ...(typeof artifact.width === 'number'
              ? { width: artifact.width }
              : {}),
            ...(typeof artifact.height === 'number'
              ? { height: artifact.height }
              : {}),
            ...(typeof artifact.b64_json === 'string'
              ? { b64_json: artifact.b64_json }
              : {}),
            ...(typeof artifact.data_base64 === 'string'
              ? { data_base64: artifact.data_base64 }
              : {}),
          });
          generated += 1;
          if (generated >= (count ?? 1)) {
            break;
          }
        }

        if (!images.length) {
          logger.warn(
            `[image-generate] empty-result prompt=${safeImagePreview(prompt)}`
          );
          return toolError('Image Generate Failed', 'No image was generated');
        }

        logger.log(
          `[image-generate] success prompt=${safeImagePreview(prompt)} images=${safeImagePreview(images)}`
        );
        return {
          prompt,
          images,
        };
      } catch (err: any) {
        logger.error(`Failed to generate image for prompt: ${prompt}`, err);
        return toolError('Image Generate Failed', err.message);
      }
    },
  });
};

function safeImagePreview(value: unknown, max = 600) {
  try {
    const text =
      typeof value === 'string' ? value : JSON.stringify(value, null, 0);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return '[unserializable]';
  }
}
