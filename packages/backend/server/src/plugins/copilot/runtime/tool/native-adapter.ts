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

type ResponsesImageGenerationItem = {
  id: string;
  status?: string;
  revised_prompt?: string;
  result: string;
  output_format?: string;
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
    const emittedResponsesImageCallIds = new Set<string>();

    for await (const event of this.#runtime.streamEvents(
      request,
      signal,
      messages
    )) {
      this.logger.log(
        `[native-stream-object] event type=${event.type}${'name' in event && typeof event.name === 'string' ? ` name=${event.name}` : ''}${'call_id' in event && typeof event.call_id === 'string' ? ` callId=${event.call_id}` : ''}${'model' in event && typeof event.model === 'string' ? ` model=${event.model}` : ''}`
      );
      const bridgedResponsesImages = extractResponsesImageToolResults(
        event,
        messages,
        emittedResponsesImageCallIds
      );
      if (bridgedResponsesImages.length > 0) {
        sawMeaningfulOutput = true;
        this.logger.log(
          `[native-stream-object] bridged responses image events count=${bridgedResponsesImages.length} sourceType=${event.type}`
        );
        for (const bridged of bridgedResponsesImages) {
          if (bridged.type === 'tool-call') {
            this.logger.log(
              `[native-stream-object] responses image bridge tool_call toolCallId=${bridged.toolCallId} args=${truncateNativePreview(
                bridged.args
              )}`
            );
          } else {
            this.logger.log(
              `[native-stream-object] responses image bridge tool_result toolCallId=${bridged.toolCallId} result=${truncateNativePreview(
                bridged.result
              )}`
            );
          }
          yield bridged;
        }
        continue;
      }
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
          const normalized = event as EnrichedToolResultEvent;
          const isResponsesImageResult =
            normalized.name === 'image_generate' &&
            normalized.arguments?.source === 'responses_output';
          sawMeaningfulOutput = true;
          this.logger.log(
            `[native-stream-object] tool_result payload=${truncateNativePreview(normalized.output)} source=${normalized.arguments?.source ?? 'n/a'} responsesImage=${isResponsesImageResult ? 'true' : 'false'}`
          );
          if (isResponsesImageResult) {
            this.logger.log(
              `[native-stream-object] responses image tool_result detected; fallback will be suppressed`
            );
          }
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
        case 'response.created':
        case 'response.output_item.added':
        case 'response.output_text.delta':
        case 'response.image_generation_call.partial_image':
        case 'response.completed':
          this.logger.log(
            `[native-stream-object] raw responses event payload=${truncateNativePreview(event)}`
          );
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
      this.logger.log(
        `[native-stream-object] no meaningful output detected; entering image fallback`
      );
      yield* this.#streamImageFallback(messages, signal);
    } else {
      this.logger.log(
        `[native-stream-object] meaningful output detected; image fallback suppressed`
      );
    }
  }

  async *#streamImageFallback(
    messages?: PromptMessage[],
    signal?: AbortSignal
  ): AsyncIterableIterator<StreamObject> {
    const execute = this.#fallbackImageTool?.execute;
    const analysis = analyzeImageFallback(messages);
    const prompt = analysis.prompt;
    this.logger.log(
      `[native-stream-object] image fallback analysis hasTool=${execute ? 'true' : 'false'} matched=${analysis.matched ? 'true' : 'false'} candidate=${truncateNativePreview(
        analysis.candidate
      )} reason=${analysis.reason} messages=${truncateNativePreview(
        analysis.debugMessages
      )}`
    );
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

function analyzeImageFallback(messages?: PromptMessage[]) {
  const userMessages = (messages ?? [])
    .filter(message => message.role === 'user')
    .map(message => ({
      role: message.role,
      content: message.content,
      params: message.params,
      attachmentsCount: message.attachments?.length ?? 0,
      candidate: pickPromptContent(message),
    }));
  const candidates = userMessages
    .map(message => message.candidate)
    .filter((value): value is string => typeof value === 'string' && !!value.trim());

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (looksLikeImageGenerationRequest(candidate)) {
      return {
        matched: true,
        prompt: candidate,
        candidate,
        reason: `matched_candidate_index=${i}`,
        debugMessages: userMessages,
      };
    }
  }

  return {
    matched: false,
    prompt: null,
    candidate: candidates[candidates.length - 1] ?? null,
    reason:
      candidates.length > 0 ? 'no_candidate_matched' : 'no_user_candidate',
    debugMessages: userMessages,
  };
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

export function looksLikeImageGenerationRequest(content: string) {
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

function extractResponsesImageToolResults(
  event: { type: string; [key: string]: unknown },
  messages: PromptMessage[] | undefined,
  emittedCallIds: Set<string>
): StreamObject[] {
  const prompt = pickLatestImagePrompt(messages);
  const imageItems =
    event.type === 'response.output_item.done'
      ? extractResponsesImageItemsFromOutputItemDone(event)
      : event.type === 'response.completed'
        ? extractResponsesImageItemsFromCompleted(event)
        : [];

  if (!imageItems.length) {
    if (event.type === 'response.image_generation_call.partial_image') {
      console.log('[native-stream-object] responses partial image event', {
        preview: truncateNativePreview(event),
      });
    }
    return [];
  }

  const bridged: StreamObject[] = [];
  for (const item of imageItems) {
    const toolCallId = `responses_image_generate_${item.id}`;
    if (!emittedCallIds.has(toolCallId)) {
      emittedCallIds.add(toolCallId);
      bridged.push({
        type: 'tool-call',
        toolCallId,
        toolName: 'image_generate',
        args: {
          source: 'responses_output',
          count: 1,
          ...(prompt ? { prompt } : {}),
        },
      });
    }
    bridged.push({
      type: 'tool-result',
      toolCallId,
      toolName: 'image_generate',
      args: {
        source: 'responses_output',
        count: 1,
        ...(prompt ? { prompt } : {}),
      },
      result: {
        source: 'responses_output',
        ...(prompt ? { prompt } : {}),
        ...(typeof item.revised_prompt === 'string'
          ? { revised_prompt: item.revised_prompt }
          : {}),
        images: [
          {
            id: item.id,
            b64_json: item.result,
            mimeType: outputFormatToMimeType(item.output_format),
            ...(typeof item.output_format === 'string'
              ? { output_format: item.output_format }
              : {}),
            ...(typeof item.revised_prompt === 'string'
              ? { revised_prompt: item.revised_prompt }
              : {}),
          },
        ],
      },
    });
  }

  return bridged;
}

function extractResponsesImageItemsFromOutputItemDone(event: {
  [key: string]: unknown;
}) {
  const item = event.item;
  if (!item || typeof item !== 'object') {
    return [];
  }
  return normalizeResponsesImageItems([item]);
}

function extractResponsesImageItemsFromCompleted(event: {
  [key: string]: unknown;
}) {
  const response = event.response;
  if (!response || typeof response !== 'object') {
    return [];
  }
  const output = (response as Record<string, unknown>).output;
  if (!Array.isArray(output)) {
    return [];
  }
  return normalizeResponsesImageItems(output);
}

function normalizeResponsesImageItems(values: unknown[]) {
  return values
    .map(value => normalizeResponsesImageItem(value))
    .filter((value): value is ResponsesImageGenerationItem => value !== null);
}

function normalizeResponsesImageItem(
  value: unknown
): ResponsesImageGenerationItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== 'image_generation_call') {
    return null;
  }

  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id
      : `inline_${hashPreview(JSON.stringify(record))}`;
  const result =
    typeof record.result === 'string' && record.result.trim()
      ? record.result
      : null;
  if (!result) {
    return null;
  }

  return {
    id,
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.revised_prompt === 'string'
      ? { revised_prompt: record.revised_prompt }
      : {}),
    ...(typeof record.output_format === 'string'
      ? { output_format: record.output_format }
      : {}),
    result,
  };
}

function pickLatestImagePrompt(messages?: PromptMessage[]) {
  if (!messages?.length) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') {
      continue;
    }
    const candidate = pickPromptContent(message)?.trim();
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function outputFormatToMimeType(format: string | undefined) {
  const normalized = format?.trim().toLowerCase();
  if (!normalized) {
    return 'image/png';
  }
  if (normalized === 'jpg') {
    return 'image/jpeg';
  }
  return `image/${normalized}`;
}

function hashPreview(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
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
