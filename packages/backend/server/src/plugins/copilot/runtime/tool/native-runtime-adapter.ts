import type { LlmRequest, LlmToolLoopStreamEvent } from '../../../../native';
import type { PromptMessage, StreamObject } from '../../providers/types';
import { projectRuntimeEventToStreamObject } from '../contracts/runtime-event-contract';

type NativeRuntimeEvent = {
  type: string;
  [key: string]: unknown;
};

type NativeRuntimeDispatch = (
  request: LlmRequest,
  signalOrOptions?: AbortSignal | { signal?: AbortSignal },
  maybeMessages?: PromptMessage[]
) => AsyncIterableIterator<NativeRuntimeEvent>;

export type EnrichedToolCallEvent = Extract<
  LlmToolLoopStreamEvent,
  { type: 'tool_call' }
>;

export type EnrichedToolResultEvent = Omit<
  Extract<LlmToolLoopStreamEvent, { type: 'tool_result' }>,
  'name' | 'arguments'
> & {
  name: string;
  arguments: Record<string, unknown>;
};

export class NativeRuntimeAdapter {
  readonly #dispatchWithTools: NativeRuntimeDispatch;

  constructor(dispatchWithTools: NativeRuntimeDispatch) {
    this.#dispatchWithTools = dispatchWithTools;
  }

  streamEvents(
    request: LlmRequest,
    signal?: AbortSignal,
    messages?: PromptMessage[]
  ) {
    return this.#dispatchWithTools(request, signal, messages);
  }

  async *streamObject(
    request: LlmRequest,
    signal?: AbortSignal,
    messages?: PromptMessage[]
  ): AsyncIterableIterator<StreamObject> {
    for await (const event of this.streamEvents(request, signal, messages)) {
      if (event.type === 'tool_result') {
        const toolName =
          typeof event.name === 'string' ? event.name : 'unknown';
        const args =
          event.arguments && typeof event.arguments === 'object'
            ? (event.arguments as Record<string, unknown>)
            : undefined;
        if (
          toolName === 'image_generate' &&
          args?.source === 'responses_output'
        ) {
          console.log('[native-runtime-adapter] received responses image tool_result', {
            callId:
              typeof event.call_id === 'string' ? event.call_id : 'n/a',
            outputPreview: JSON.stringify(event.output).slice(0, 500),
          });
        }
      }
      if (event.type === 'error') {
        throw new Error(
          typeof event.message === 'string'
            ? event.message
            : 'native runtime stream error'
        );
      }
      const streamObject = projectRuntimeEventToStreamObject(event);
      if (streamObject) {
        yield streamObject;
      }
    }
  }
}
