import {
  createOpenAICompatible,
  type OpenAICompatibleProvider as VercelOpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import {
  AISDKError,
  generateObject,
  generateText,
  stepCountIs,
  streamText,
} from 'ai';

import {
  CopilotPromptInvalid,
  CopilotProviderNotSupported,
  CopilotProviderSideError,
  metrics,
} from '../../../base';
import { CopilotProvider } from './provider';
import type {
  CopilotChatOptions,
  CopilotProviderModel,
  CopilotStructuredOptions,
  ModelConditions,
  PromptMessage,
  StreamObject,
} from './types';
import { CopilotProviderType, ModelInputType, ModelOutputType } from './types';
import {
  chatToGPTMessage,
  CitationParser,
  StreamObjectParser,
  TextStreamParser,
} from './utils';
import z from 'zod';
import { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

export type DeepSeekConfig = {
  apiKey: string;
  baseURL?: string;
};

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

export class DeepSeekProvider extends CopilotProvider<DeepSeekConfig> {
  readonly type = CopilotProviderType.DeepSeek;

  readonly models = [
    // DeepSeek Chat models
    {
      name: 'DeepSeek Chat',
      id: 'deepseek-chat',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Text, ModelOutputType.Object],
          defaultForOutputType: true,
        },
      ],
    },
    {
      name: 'DeepSeek Coder',
      id: 'deepseek-coder',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
    {
      name: 'DeepSeek V3',
      id: 'deepseek-v3',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
  ];

  override async refreshOnlineModels() {
    try {
      const baseUrl = this.config.baseURL || 'https://api.deepseek.com/v1';
      if (this.config.apiKey && baseUrl && !this.onlineModelList.length) {
        const { data } = await fetch(`${baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
        })
          .then(r => r.json())
          .then(r => ModelListSchema.parse(r));
        this.onlineModelList = data.map(model => model.id);
      }
    } catch (e) {
      this.logger.error('Failed to fetch available models', e);
    }
  }

  private getProvider(): VercelOpenAICompatibleProvider {
    if (!this.configured()) {
      throw new CopilotPromptInvalid('DeepSeek provider is not configured');
    }

    const config = this.config;
    return createOpenAICompatible({
      name: 'deepseek',
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? 'https://api.deepseek.com/v1',
    });
  }

  override configured(): boolean {
    return !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.logger.debug(
        `DeepSeek provider initialized with baseURL: ${this.config.baseURL || 'https://api.deepseek.com/v1'}`
      );
  }

  async text(
      cond: ModelConditions,
      messages: PromptMessage[],
      options: CopilotChatOptions = {}
    ): Promise<string> {
      this.logger.debug(
        `DeepSeek开始执行文本生成`
      );
      const fullCond = { ...cond, outputType: ModelOutputType.Text };
      await this.checkParams({ messages, cond: fullCond, options });
      const model = this.selectModel(fullCond);
      const provider = this.getProvider();
  
      try {
        metrics.ai.counter('chat_text_calls').add(1, { model: model.id });
  
        const [system, msgs] = await chatToGPTMessage(messages);
  
        const { text } = await generateText({
          model: provider(model.id),
          system,
          messages: msgs,
          temperature: options.temperature ?? 0,
          maxOutputTokens: options.maxTokens ?? 4096,
          providerOptions: {
            openai: this.getOpenAIOptions(options, model.id),
          },
          tools: await this.getTools(options, model.id),
          stopWhen: stepCountIs(this.MAX_STEPS),
          abortSignal: options.signal,
        });
  
        return text.trim();
      } catch (e: any) {
        metrics.ai.counter('chat_text_errors').add(1, { model: model.id });
        throw this.handleError(e, model.id);
      }
    }
  
    async *streamText(
      cond: ModelConditions,
      messages: PromptMessage[],
      options: CopilotChatOptions = {}
    ): AsyncIterable<string> {
      const fullCond = {
        ...cond,
        outputType: ModelOutputType.Text,
      };
      this.logger.debug(
        `DeepSeek开始执行流式文本生成`
      );
      await this.checkParams({ messages, cond: fullCond, options });
      const model = this.selectModel(fullCond);
  
      try {
        metrics.ai.counter('chat_text_stream_calls').add(1, { model: model.id });
        const fullStream = await this.getFullStream(model, messages, options);
        const citationParser = new CitationParser();
        const textParser = new TextStreamParser();
        for await (const chunk of fullStream) {
          switch (chunk.type) {
            case 'text-delta': {
              let result = textParser.parse(chunk);
              result = citationParser.parse(result);
              yield result;
              break;
            }
            case 'finish': {
              const footnotes = textParser.end();
              const result =
                citationParser.end() + (footnotes.length ? '\n' + footnotes : '');
              yield result;
              break;
            }
            default: {
              yield textParser.parse(chunk);
              break;
            }
          }
          if (options.signal?.aborted) {
            await fullStream.cancel();
            break;
          }
        }
      } catch (e: any) {
        metrics.ai.counter('chat_text_stream_errors').add(1, { model: model.id });
        throw this.handleError(e, model.id);
      }
    }

    override async *streamObject(
        cond: ModelConditions,
        messages: PromptMessage[],
        options: CopilotChatOptions = {}
      ): AsyncIterable<StreamObject> {
        this.logger.debug(
        `DeepSeek开始执行流式对象生成`
      );
        const fullCond = { ...cond, outputType: ModelOutputType.Object };
        await this.checkParams({ cond: fullCond, messages, options });
        const model = this.selectModel(fullCond);
    
        try {
          metrics.ai
            .counter('chat_object_stream_calls')
            .add(1, { model: model.id });
          const fullStream = await this.getFullStream(model, messages, options);
          const parser = new StreamObjectParser();
          for await (const chunk of fullStream) {
            const result = parser.parse(chunk);
            if (result) {
              yield result;
            }
            if (options.signal?.aborted) {
              await fullStream.cancel();
              break;
            }
          }
        } catch (e: any) {
          metrics.ai
            .counter('chat_object_stream_errors')
            .add(1, { model: model.id });
          throw this.handleError(e, model.id);
        }
      }

  override async structure(
    cond: ModelConditions,
    messages: PromptMessage[],
    options: CopilotStructuredOptions = {}
  ): Promise<string> {
    const fullCond = { ...cond, outputType: ModelOutputType.Structured };
    const model = this.selectModel(fullCond);

    if (!model.id) {
      throw new CopilotPromptInvalid('Model ID is required for DeepSeek provider');
    }

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });

      const provider = this.getProvider();
      const gptModel = provider(model.id);

      const [system, msgs, schema] = await chatToGPTMessage(messages);
      if (!schema) {
        throw new CopilotPromptInvalid('Schema is required');
      }

      const { object } = await generateObject({
        model: gptModel,
        system,
        messages: msgs,
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? 4096,
        maxRetries: options.maxRetries ?? 3,
        schema,
        abortSignal: options.signal,
      });

      return JSON.stringify(object);
    } catch (e) {
      this.handleError(e, model.id);
    }
  }

  private async getFullStream(
      model: CopilotProviderModel,
      messages: PromptMessage[],
      options: CopilotChatOptions = {}
    ) {
      const [system, msgs] = await chatToGPTMessage(messages, true, true);
      const { fullStream } = streamText({
        model: this.getProvider()(model.id),
        system,
        messages: msgs,
        frequencyPenalty: options.frequencyPenalty ?? 0,
        presencePenalty: options.presencePenalty ?? 0,
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? 4096,
        providerOptions: {
          openai: this.getOpenAIOptions(options, model.id),
        },
        tools: await this.getTools(options, model.id),
        stopWhen: stepCountIs(this.MAX_STEPS),
        abortSignal: options.signal,
      });
      return fullStream;
    }

    private getOpenAIOptions(options: CopilotChatOptions, model: string) {
        const result: OpenAIResponsesProviderOptions = {};
        if (options?.reasoning) {
          result.reasoningEffort = 'medium';
          result.reasoningSummary = 'detailed';
        }
        if (options?.user) {
          result.user = options.user;
        }
        return result;
      }

  private handleError(error: any, modelId?: string): never {
    if (modelId) {
      metrics.ai.counter('chat_text_errors').add(1, { model: modelId });
    }

    if (error instanceof AISDKError) {
      throw new CopilotProviderSideError({
        provider: this.type,
        kind: error.name || 'unknown',
        message: error.message,
      });

    }
    if (error instanceof Error) {
      throw new CopilotProviderSideError({
        provider: this.type,
        kind: error.name || 'unknown',
        message: error.message,
      });
    }

    throw new CopilotProviderSideError({
        provider: this.type,
        kind: error.name || 'unknown',
        message: error.message,
      });
  }
}