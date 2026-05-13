import { Logger } from '@nestjs/common';

import type { LlmRequest, LlmToolLoopStreamEvent } from '../../../../native';
import type { NodeTextMiddleware } from '../../config';
import type { PromptMessage, StreamObject } from '../../providers/types';
import {
  CitationFootnoteFormatter,
  TextStreamParser,
} from '../../providers/utils';
import type { CopilotTool } from '../../tools';
import type { CopilotToolSet } from '../../tools';
import { projectRuntimeEventToStreamObject } from '../contracts/runtime-event-contract';
import { createToolLoopBridge, type ToolLoopBackend } from './bridge';
import {
  type EnrichedToolCallEvent,
  type EnrichedToolResultEvent,
  NativeRuntimeAdapter,
} from './native-runtime-adapter';

type AttachmentFootnote = {
  blobId: string;
  fileName: string;
  fileType: string;
};

export type NativeProviderAdapterOptions = {
  maxSteps?: number;
  nodeTextMiddleware?: NodeTextMiddleware[];
  fallbackImageTool?: CopilotTool;
  onUsage?: (input: {
    providerId: string;
    model?: string;
    usage?: Extract<LlmToolLoopStreamEvent, { type: 'usage' }>['usage'];
  }) => void | Promise<void>;
};

type NativeStreamDispatch = ConstructorParameters<
  typeof NativeRuntimeAdapter
>[0];

function pickAttachmentFootnote(value: unknown): AttachmentFootnote | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const blobId =
    typeof record.blobId === 'string'
      ? record.blobId
      : typeof record.blob_id === 'string'
        ? record.blob_id
        : undefined;
  const fileName =
    typeof record.fileName === 'string'
      ? record.fileName
      : typeof record.name === 'string'
        ? record.name
        : undefined;
  const fileType =
    typeof record.fileType === 'string'
      ? record.fileType
      : typeof record.mimeType === 'string'
        ? record.mimeType
        : 'application/octet-stream';

  if (!blobId || !fileName) {
    return null;
  }

  return { blobId, fileName, fileType };
}

function collectAttachmentFootnotes(
  event: EnrichedToolResultEvent
): AttachmentFootnote[] {
  if (event.name === 'blob_read') {
    const item = pickAttachmentFootnote(event.output);
    return item ? [item] : [];
  }

  if (event.name === 'doc_semantic_search' && Array.isArray(event.output)) {
    return event.output
      .map(item => pickAttachmentFootnote(item))
      .filter((item): item is AttachmentFootnote => item !== null);
  }

  return [];
}

function formatAttachmentFootnotes(
  attachments: AttachmentFootnote[],
  options: { includeReferences?: boolean } = {}
) {
  const references =
    options.includeReferences === false
      ? ''
      : attachments.map((_, index) => `[^${index + 1}]`).join('');
  const definitions = attachments
    .map((attachment, index) => {
      return `[^${index + 1}]: ${JSON.stringify({
        type: 'attachment',
        blobId: attachment.blobId,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
      })}`;
    })
    .join('\n');

  return references
    ? `\n\n${references}\n\n${definitions}`
    : `\n\n${definitions}`;
}

export class NativeProviderAdapter {
  readonly logger = new Logger(NativeProviderAdapter.name);
  readonly #runtime: NativeRuntimeAdapter;
  readonly #enableCallout: boolean;
  readonly #enableCitationFootnote: boolean;
  readonly #fallbackImageTool?: CopilotTool;
  readonly #onUsage?: NativeProviderAdapterOptions['onUsage'];

  constructor(
    dispatchWithTools: NativeStreamDispatch,
    options: NativeProviderAdapterOptions = {}
  ) {
    this.#runtime = new NativeRuntimeAdapter(dispatchWithTools);
    const enabledNodeTextMiddlewares = new Set(
      options.nodeTextMiddleware ?? ['citation_footnote', 'callout']
    );
    this.#enableCallout =
      enabledNodeTextMiddlewares.has('callout') ||
      enabledNodeTextMiddlewares.has('thinking_format');
    this.#enableCitationFootnote =
      enabledNodeTextMiddlewares.has('citation_footnote');
    this.#fallbackImageTool = options.fallbackImageTool;
    this.#onUsage = options.onUsage;
  }

  async #recordUsageOnProviderSelected(
    event: { type: string; [key: string]: unknown },
    state: {
      model?: string;
      usage?: Extract<LlmToolLoopStreamEvent, { type: 'usage' }>['usage'];
    }
  ) {
    if (
      event.type !== 'provider_selected' ||
      typeof event.provider_id !== 'string'
    ) {
      return;
    }
    try {
      await this.#onUsage?.({
        providerId: event.provider_id,
        model: state.model,
        usage: state.usage,
      });
    } catch (error) {
      this.logger.warn(
        `Provider usage callback failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    state.usage = undefined;
  }

  async text(
    request: LlmRequest,
    signal?: AbortSignal,
    messages?: PromptMessage[]
  ) {
    let output = '';
    for await (const chunk of this.streamText(request, signal, messages)) {
      output += chunk;
    }
    return output.trim();
  }

  async *streamText(
    request: LlmRequest,
    signal?: AbortSignal,
    messages?: PromptMessage[]
  ): AsyncIterableIterator<string> {
    const textParser = this.#enableCallout ? new TextStreamParser() : null;
    const citationFormatter = this.#enableCitationFootnote
      ? new CitationFootnoteFormatter()
      : null;
    let streamPartId = 0;
    const usageState: {
      model?: string;
      usage?: Extract<LlmToolLoopStreamEvent, { type: 'usage' }>['usage'];
    } = {};

    for await (const event of this.#runtime.streamEvents(
      request,
      signal,
      messages
    )) {
      switch (event.type) {
        case 'message_start': {
          const startEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'message_start' }
          >;
          usageState.model = startEvent.model;
          break;
        }
        case 'usage': {
          const usageEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'usage' }
          >;
          usageState.usage = usageEvent.usage;
          break;
        }
        case 'text_delta': {
          const textEvent = event as unknown as { text: string };
          if (textParser) {
            yield textParser.parse({
              type: 'text-delta',
              id: String(streamPartId++),
              text: textEvent.text,
            });
          } else {
            yield textEvent.text;
          }
          break;
        }
        case 'reasoning_delta': {
          const reasoningEvent = event as unknown as { text: string };
          if (textParser) {
            yield textParser.parse({
              type: 'reasoning-delta',
              id: String(streamPartId++),
              text: reasoningEvent.text,
            });
          } else {
            yield reasoningEvent.text;
          }
          break;
        }
        case 'tool_call': {
          if (textParser) {
            const toolCallEvent = event as EnrichedToolCallEvent;
            yield textParser.parse({
              type: 'tool-call',
              toolCallId: toolCallEvent.call_id,
              toolName: toolCallEvent.name,
              input: toolCallEvent.arguments,
            });
          }
          break;
        }
        case 'tool_result': {
          if (!textParser) break;
          const normalized = event as EnrichedToolResultEvent;
          yield textParser.parse({
            type: 'tool-result',
            toolCallId: normalized.call_id,
            toolName: normalized.name as never,
            input: normalized.arguments,
            output: normalized.output,
          });
          break;
        }
        case 'citation': {
          if (citationFormatter) {
            const citationEvent = event as unknown as {
              index: number;
              url: string;
            };
            citationFormatter.consume({
              type: 'citation',
              index: citationEvent.index,
              url: citationEvent.url,
            });
          }
          break;
        }
        case 'done': {
          const doneEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'done' }
          >;
          usageState.usage = doneEvent.usage ?? usageState.usage;
          const footnotes = textParser?.end() ?? '';
          const citations = citationFormatter?.end() ?? '';
          const tails = [citations, footnotes].filter(Boolean).join('\n');
          if (tails) {
            yield `\n${tails}`;
          }
          break;
        }
        case 'provider_selected':
          await this.#recordUsageOnProviderSelected(event, usageState);
          break;
        case 'error':
          throw new Error(
            typeof event.message === 'string'
              ? event.message
              : 'native runtime stream error'
          );
        default:
          break;
      }
    }
  }

  async *streamObject(
    request: LlmRequest,
    signal?: AbortSignal,
    messages?: PromptMessage[]
  ): AsyncIterableIterator<StreamObject> {
    const citationFormatter = this.#enableCitationFootnote
      ? new CitationFootnoteFormatter()
      : null;
    const fallbackAttachmentFootnotes = new Map<string, AttachmentFootnote>();
    let hasFootnoteReference = false;
    const usageState: {
      model?: string;
      usage?: Extract<LlmToolLoopStreamEvent, { type: 'usage' }>['usage'];
    } = {};
    let sawMeaningfulOutput = false;

    for await (const event of this.#runtime.streamEvents(
      request,
      signal,
      messages
    )) {
      this.logger.log(
        `[native-stream-object] event type=${event.type}${'name' in event && typeof event.name === 'string' ? ` name=${event.name}` : ''}${'call_id' in event && typeof event.call_id === 'string' ? ` callId=${event.call_id}` : ''}${'model' in event && typeof event.model === 'string' ? ` model=${event.model}` : ''}`
      );
      switch (event.type) {
        case 'message_start': {
          const startEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'message_start' }
          >;
          this.logger.log(
            `[native-stream-object] message_start model=${startEvent.model ?? 'n/a'}`
          );
          usageState.model = startEvent.model;
          break;
        }
        case 'usage': {
          const usageEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'usage' }
          >;
          this.logger.log(
            `[native-stream-object] usage promptTokens=${usageEvent.usage?.prompt_tokens ?? 'n/a'} completionTokens=${usageEvent.usage?.completion_tokens ?? 'n/a'} totalTokens=${usageEvent.usage?.total_tokens ?? 'n/a'}`
          );
          usageState.usage = usageEvent.usage;
          break;
        }
        case 'text_delta': {
          sawMeaningfulOutput = true;
          const textEvent = event as unknown as { text: string };
          this.logger.log(
            `[native-stream-object] text_delta preview=${truncateNativePreview(textEvent.text)}`
          );
          if (textEvent.text.includes('[^')) {
            hasFootnoteReference = true;
          }
          yield { type: 'text-delta', textDelta: textEvent.text };
          break;
        }
        case 'reasoning_delta': {
          sawMeaningfulOutput = true;
          const reasoningEvent = event as unknown as { text: string };
          this.logger.log(
            `[native-stream-object] reasoning_delta preview=${truncateNativePreview(reasoningEvent.text)}`
          );
          yield { type: 'reasoning', textDelta: reasoningEvent.text };
          break;
        }
        case 'tool_call': {
          sawMeaningfulOutput = true;
          this.logger.log(
            `[native-stream-object] tool_call payload=${truncateNativePreview(event)}`
          );
          const streamObject = projectRuntimeEventToStreamObject(
            event as LlmToolLoopStreamEvent
          );
          if (!streamObject) break;
          yield streamObject;
          break;
        }
        case 'tool_result': {
          sawMeaningfulOutput = true;
          const normalized = event as EnrichedToolResultEvent;
          this.logger.log(
            `[native-stream-object] tool_result payload=${truncateNativePreview(normalized.output)}`
          );
          const attachments = collectAttachmentFootnotes(normalized);
          attachments.forEach(attachment => {
            fallbackAttachmentFootnotes.set(attachment.blobId, attachment);
          });
          const streamObject = projectRuntimeEventToStreamObject(
            event as LlmToolLoopStreamEvent
          );
          if (!streamObject) break;
          yield streamObject;
          break;
        }
        case 'citation': {
          sawMeaningfulOutput = true;
          this.logger.log(
            `[native-stream-object] citation payload=${truncateNativePreview(event)}`
          );
          if (citationFormatter) {
            const citationEvent = event as unknown as {
              index: number;
              url: string;
            };
            citationFormatter.consume({
              type: 'citation',
              index: citationEvent.index,
              url: citationEvent.url,
            });
          }
          break;
        }
        case 'done': {
          const doneEvent = event as Extract<
            LlmToolLoopStreamEvent,
            { type: 'done' }
          >;
          this.logger.log(
            `[native-stream-object] done payload=${truncateNativePreview(doneEvent)}`
          );
          usageState.usage = doneEvent.usage ?? usageState.usage;
          const citations = citationFormatter?.end() ?? '';
          if (citations) {
            hasFootnoteReference = true;
            yield { type: 'text-delta', textDelta: `\n${citations}` };
          }
          if (!citations && fallbackAttachmentFootnotes.size > 0) {
            yield {
              type: 'text-delta',
              textDelta: formatAttachmentFootnotes(
                Array.from(fallbackAttachmentFootnotes.values()),
                { includeReferences: !hasFootnoteReference }
              ),
            };
          }
          break;
        }
        case 'provider_selected':
          this.logger.log(
            `[native-stream-object] provider_selected payload=${truncateNativePreview(event)}`
          );
          await this.#recordUsageOnProviderSelected(event, usageState);
          break;
        case 'error':
          this.logger.error(
            `[native-stream-object] error payload=${truncateNativePreview(event)}`
          );
          throw new Error(
            typeof event.message === 'string'
              ? event.message
              : 'native runtime stream error'
          );
        default:
          this.logger.warn(
            `[native-stream-object] unhandled event payload=${truncateNativePreview(event)}`
          );
          break;
      }
    }

    if (!sawMeaningfulOutput) {
      yield* this.#streamImageFallback(messages, signal);
    }
  }

  async *#streamImageFallback(
    messages?: PromptMessage[],
    signal?: AbortSignal
  ): AsyncIterableIterator<StreamObject> {
    const execute = this.#fallbackImageTool?.execute;
    const prompt = pickImageFallbackPrompt(messages);
    if (!execute || !prompt) {
      return;
    }

    const toolCallId = `fallback_image_generate_${Date.now().toString(36)}`;
    this.logger.log(
      `[native-stream-object] image fallback triggered prompt=${truncateNativePreview(prompt)}`
    );
    yield {
      type: 'tool-call',
      toolCallId,
      toolName: 'image_generate',
      args: { prompt, count: 1 },
    };

    const result = await execute(
      { prompt, count: 1 },
      {
        signal,
        messages,
      }
    );
    if (isToolErrorResult(result)) {
      this.logger.warn(
        `[native-stream-object] image fallback failed name=${result.name} message=${result.message}`
      );
      yield {
        type: 'text-delta',
        textDelta: `\n${result.message}`,
      };
      return;
    }

    this.logger.log(
      `[native-stream-object] image fallback result=${truncateNativePreview(result)}`
    );
    yield {
      type: 'tool-result',
      toolCallId,
      toolName: 'image_generate',
      args: { prompt, count: 1 },
      result,
    };
  }
}

function isToolErrorResult(
  value: unknown
): value is { type: 'error'; name: string; message: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'error' &&
    typeof (value as { message?: unknown }).message === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function pickImageFallbackPrompt(messages?: PromptMessage[]) {
  const latestUser = pickLatestUserMessage(messages);
  if (!latestUser) {
    return null;
  }
  const content = pickPromptContent(latestUser);
  if (!content || !looksLikeImageGenerationRequest(content)) {
    return null;
  }
  return content;
}

function pickLatestUserMessage(messages?: PromptMessage[]) {
  if (!messages?.length) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      return messages[i];
    }
  }
  return null;
}

function pickPromptContent(message: PromptMessage) {
  const paramContent =
    message.params &&
    typeof message.params === 'object' &&
    typeof message.params.content === 'string'
      ? message.params.content
      : null;
  return paramContent ?? message.content;
}

function looksLikeImageGenerationRequest(content: string) {
  const text = content.trim();
  if (!text) {
    return false;
  }

  return (
    /(生成|创建|做|画|绘制|出).{0,12}(一张|张|幅|个)?(图|图片|插画|海报|封面|壁纸|配图|头像|照片|logo)/u.test(
      text
    ) ||
    /(来一张|来张|配张|生图|出图)/u.test(text) ||
    /\b(draw|generate|create|make|render|design)\b[\s\S]{0,24}\b(image|picture|illustration|poster|cover|wallpaper|photo|logo|avatar)\b/i.test(
      text
    )
  );
}

function truncateNativePreview(value: unknown, max = 600) {
  try {
    const text =
      typeof value === 'string' ? value : JSON.stringify(value, null, 0);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return '[unserializable]';
  }
}

export function createNativeToolLoopAdapter(
  backend: ToolLoopBackend,
  tools: CopilotToolSet,
  options: NativeProviderAdapterOptions = {}
) {
  return new NativeProviderAdapter(
    createToolLoopBridge(backend, tools, options.maxSteps),
    {
      ...options,
      fallbackImageTool: options.fallbackImageTool ?? tools.image_generate,
    }
  );
}
