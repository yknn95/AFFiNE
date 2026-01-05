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
import { CoreUserMessage, CoreAssistantMessage } from 'ai';
import * as https from 'node:https';
import * as crypto from 'node:crypto';

import {
  CopilotPromptInvalid,
  CopilotProviderNotSupported,
  CopilotProviderSideError,
  metrics,
} from '../../../base';
import { CopilotProvider } from './provider';
import type {
  CopilotChatOptions,
  CopilotImageOptions,
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
import z, { ZodType } from 'zod';
import { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

type ChatMessage = CoreUserMessage | CoreAssistantMessage;

/**
 * 腾讯混元API状态码枚举
 * 1: 等待中
 * 2: 运行中
 * 4: 处理失败
 * 5: 处理完成
 */
enum HunyuanJobStatusCode {
  WAITING = '1',
  RUNNING = '2',
  FAILED = '4',
  COMPLETED = '5',
}

export type TencentHunyuanConfig = {
  apiKey: string;
  baseURL?: string;
  secretId: string;
  secretKey: string;
  region?: string;
};

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

export class TencentHunyuanProvider extends CopilotProvider<TencentHunyuanConfig> {
  readonly type = CopilotProviderType.TencentHunyuan;

  readonly models = [
    // Tencent Hunyuan Chat models
    {
      name: 'Hunyuan Turbos Latest',
      id: 'hunyuan-turbos-latest',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Text, ModelOutputType.Object],
          defaultForOutputType: true,
        },
      ],
    },
    {
      name: 'Hunyuan Pro',
      id: 'hunyuan-pro',
      capabilities: [
        {
          input: [ModelInputType.Text],
          output: [ModelOutputType.Text, ModelOutputType.Object],
        },
      ],
    },
    {
      name: 'Hunyuan Vision',
      id: 'hunyuan-vision',
      capabilities: [
        {
          input: [ModelInputType.Text, ModelInputType.Image],
          output: [ModelOutputType.Text, ModelOutputType.Object, ModelInputType.Image],
        },
      ],
    },
  ];

  private extractPrompt(
      message?: PromptMessage,
      options: CopilotImageOptions = {}
    ) {
      if (!message) throw new CopilotPromptInvalid('Prompt is empty');
      const { content, attachments, params } = message;
      // prompt attachments require at least one
      if (!content && (!Array.isArray(attachments) || !attachments.length)) {
        throw new CopilotPromptInvalid('Prompt or Attachments is empty');
      }
      if (Array.isArray(attachments) && attachments.length > 1) {
        throw new CopilotPromptInvalid('Only one attachment is allowed');
      }
      return {
        Action: 'SubmitHunyuanImageJob',
        Version: '2023-09-01',
        Region: 'ap-guangzhou',
        ContentImage: attachments
          ?.map(v =>
            typeof v === 'string'
              ? v
              : v.mimeType.startsWith('image/')
                ? v.attachment
                : undefined
          )
          .find(v => !!v),
        Prompt: content.trim(),
      };
    }

  override async refreshOnlineModels() {
    // try {
    //   const baseUrl = this.config.baseURL || 'https://api.hunyuan.cloud.tencent.com/v1';
    //   if (this.config.apiKey && baseUrl && !this.onlineModelList.length) {
    //     const { data } = await fetch(`${baseUrl}/models`, {
    //       headers: {
    //         Authorization: `Bearer ${this.config.apiKey}`,
    //         'Content-Type': 'application/json',
    //       },
    //     })
    //       .then(r => r.json())
    //       .then(r => ModelListSchema.parse(r));
    //     this.onlineModelList = data.map(model => model.id);
    //   }
    // } catch (e) {
    //   this.logger.error('Failed to fetch available models', e);
    // }
    this.onlineModelList = this.models.map(model => model.id);
  }

  private getProvider(): VercelOpenAICompatibleProvider {
    if (!this.configured()) {
      throw new CopilotPromptInvalid('Tencent Hunyuan provider is not configured');
    }

    const config = this.config;
    return createOpenAICompatible({
      name: 'tencent-hunyuan',
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? 'https://api.hunyuan.cloud.tencent.com/v1',
    });
  }

  override configured(): boolean {
    return !!this.config.apiKey;
  }

  protected override setup() {
    super.setup();
    this.logger.debug(
        `混元模型初始化: ${JSON.stringify(this.config)}`
      );
  }

  async text(
      cond: ModelConditions,
      messages: PromptMessage[],
      options: CopilotChatOptions = {}
    ): Promise<string> {
      this.logger.debug(
        `腾讯混元开始执行文本生成`
      );
      const fullCond = { ...cond, outputType: ModelOutputType.Text };
      await this.checkParams({ messages, cond: fullCond, options });
      const model = this.selectModel(fullCond);
      const provider = this.getProvider();
  
      try {
        metrics.ai.counter('chat_text_calls').add(1, { model: model.id });
  
        let [system, msgs] = await chatToGPTMessage(messages);
        msgs = await this.formatMessagesForTencentHunyuan(msgs);
  
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
        `腾讯混元开始执行流式文本生成`
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
        `腾讯混元开始执行流式对象生成`
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
          this.logger.debug(
            `腾讯混元生成中`
          );
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
      throw new CopilotPromptInvalid('Model ID is required for Tencent Hunyuan provider');
    }

    try {
      metrics.ai.counter('chat_text_calls').add(1, { model: model.id });

      const provider = this.getProvider();
      const gptModel = provider(model.id);

      let [system, msgs, schema] = await chatToGPTMessage(messages);
      if (!schema) {
        throw new CopilotPromptInvalid('Schema is required');
      }
      
      msgs = await this.formatMessagesForTencentHunyuan(msgs);

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

  override async *streamImages(
      cond: ModelConditions,
      messages: PromptMessage[],
      options: CopilotImageOptions = {}
    ): AsyncIterable<string> {
      this.logger.debug(
        `腾讯混元开始执行流式图片生成`
      );
      const model = this.selectModel({
        ...cond,
        outputType: ModelOutputType.Image,
      });
  
      // 记录开始时间，用于性能监控
      const startTime = Date.now();
      
      try {
        metrics.ai
          .counter('generate_images_stream_calls')
          .add(1, { model: model.id });
  
        // 验证输入参数
        if (!messages || messages.length === 0) {
          throw new CopilotPromptInvalid('Messages array is empty');
        }

        // 提取提示词
        const promptData = this.extractPrompt(
          messages[messages.length - 1],
          options as CopilotImageOptions
        );

        if (!promptData || !promptData.Prompt) {
          throw new CopilotPromptInvalid('Prompt is required for image generation');
        }

        // 构建请求参数
        const payload = JSON.stringify({
          Prompt: promptData.Prompt,
          // 添加其他可选参数
          ...(options.seed && { Seed: options.seed }),
          // 可以根据需要添加更多参数
          ContentImage: {
            ImageBase64: promptData.ContentImage
          },
        });

        this.logger.debug(`Generating image with prompt: ${promptData.Prompt}`);

        // 使用腾讯云API签名v3进行请求
        const imageUrl = await this.hunyuanImageRequest(payload, options.signal);

        if (!imageUrl) {
          throw this.handleError({ message: 'Failed to generate image: No URL returned' }, model.id);
        }

        // 记录生成时间
        const duration = Date.now() - startTime;
        this.logger.debug(`Image generated successfully in ${duration}ms. URL: ${imageUrl}`);
        
        yield imageUrl;
      } catch (e) {
        // 记录错误和生成时间
        const duration = Date.now() - startTime;
        this.logger.error(`Failed to generate image after ${duration}ms`, e);
        
        metrics.ai
          .counter('generate_images_stream_errors')
          .add(1, { model: model.id });
        throw this.handleError(e, model.id);
      }
    }

  private async getFullStream(
      model: CopilotProviderModel,
      messages: PromptMessage[],
      options: CopilotChatOptions = {}
    ) {
      let [system, msgs] = await chatToGPTMessage(messages, true, true);
      this.logger.debug(
        `腾讯混元请求参数格式化：`+JSON.stringify(msgs)
      );
      
      msgs = await this.formatMessagesForTencentHunyuan(msgs);
      
      this.logger.debug(
        `腾讯混元请求参数修正后：`+JSON.stringify(msgs)
      );
      
      const { fullStream } = streamText({
        model: this.getProvider()(model.id),
        system,
        messages: msgs,
        maxOutputTokens: options.maxTokens ?? 4096,
        tools: await this.getTools(options, model.id),
        stopWhen: stepCountIs(this.MAX_STEPS),
        abortSignal: options.signal,
      });
      return fullStream;
    }

    private async formatMessagesForTencentHunyuan(messages: ChatMessage[]): Promise<ChatMessage[]> {
    // Tencent Hunyuan requires alternating user and assistant roles
    // Starting with user and ending with user(tool), tool can appear multiple times consecutively
    if (messages.length === 0) {
      return messages;
    }
    
    // Create a new array to avoid modifying the original messages
    let processedMsgs = [...messages];
    
    // Ensure the conversation starts with a user message
    if (processedMsgs[0].role !== 'user') {
      processedMsgs = [{ role: 'user', content: 'Please continue our conversation.' }, ...processedMsgs];
    }
    
    // Process messages to ensure proper role alternation
    const finalMsgs = [];
    for (let i = 0; i < processedMsgs.length; i++) {
      const currentMsg = processedMsgs[i];
      
      // Add the current message
      finalMsgs.push(currentMsg);
      
      // If this is not the last message and next message has the same role
      if (i < processedMsgs.length - 1 && processedMsgs[i + 1].role === currentMsg.role) {
        // Insert an empty assistant message to maintain alternation
        finalMsgs.push({ role: 'assistant', content: '' });
      }
    }
    
    // Ensure the conversation ends with a user message
    if (finalMsgs.length > 0 && finalMsgs[finalMsgs.length - 1].role !== 'user') {
      finalMsgs.push({ role: 'user', content: 'Please continue.' });
    }
    
    return finalMsgs;
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

  /**
   * 通用的腾讯云API请求方法，基于腾讯云API签名v3实现
   * @param action API动作名称
   * @param payload 请求体内容
   * @param signal 可选的取消信号
   * @returns API响应的Promise
   */
  private async tencentCloudApiRequest(
    action: string,
    payload: string,
    signal?: AbortSignal
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // 从配置中获取密钥信息
      const SECRET_ID = this.config.secretId;
      const SECRET_KEY = this.config.secretKey;

      if (!SECRET_ID || !SECRET_KEY) {
        reject(new Error('Tencent Cloud secret ID or secret key is not configured'));
        return;
      }

      // API配置
      const host = "hunyuan.tencentcloudapi.com";
      const service = "hunyuan";
      const region = this.config.region || "ap-guangzhou";
      const version = "2023-09-01";
      const timestamp = parseInt(String(new Date().getTime() / 1000));
      const date = this.getDate(timestamp);

      // ************* 步骤 1：拼接规范请求串 *************
      const signedHeaders = "content-type;host";
      const hashedRequestPayload = this.getHash(payload);
      const httpRequestMethod = "POST";
      const canonicalUri = "/";
      const canonicalQueryString = "";
      const canonicalHeaders =
        "content-type:application/json; charset=utf-8\n" + "host:" + host + "\n";

      const canonicalRequest =
        httpRequestMethod +
        "\n" +
        canonicalUri +
        "\n" +
        canonicalQueryString +
        "\n" +
        canonicalHeaders +
        "\n" +
        signedHeaders +
        "\n" +
        hashedRequestPayload;

      // ************* 步骤 2：拼接待签名字符串 *************
      const algorithm = "TC3-HMAC-SHA256";
      const hashedCanonicalRequest = this.getHash(canonicalRequest);
      const credentialScope = date + "/" + service + "/" + "tc3_request";
      const stringToSign =
        algorithm +
        "\n" +
        timestamp +
        "\n" +
        credentialScope +
        "\n" +
        hashedCanonicalRequest;

      // ************* 步骤 3：计算签名 *************
      const kDate = this.sha256(date, "TC3" + SECRET_KEY, "buffer");
      const kService = this.sha256(service, kDate, "buffer");
      const kSigning = this.sha256("tc3_request", kService, "buffer");
      const signature = this.sha256(stringToSign, kSigning, "hex");

      // ************* 步骤 4：拼接 Authorization *************
      const authorization =
        algorithm +
        " " +
        "Credential=" +
        SECRET_ID +
        "/" +
        credentialScope +
        ", " +
        "SignedHeaders=" +
        signedHeaders +
        ", " +
        "Signature=" +
        signature;

      // ************* 步骤 5：构造并发起请求 *************
      const headers = {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: host,
        "X-TC-Action": action,
        "X-TC-Timestamp": timestamp,
        "X-TC-Version": version,
      };

      if (region) {
        headers["X-TC-Region"] = region;
      }

      const options = {
        hostname: host,
        method: httpRequestMethod,
        headers,
      };
      // 输出日志
      this.logger.debug("请求参数：" + JSON.stringify(options));

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const response = JSON.parse(data);
            
            // 检查响应中是否有错误
            if (response.Response && response.Response.Error) {
              reject(new Error(`Tencent Hunyuan API Error: ${response.Response.Error.Code} - ${response.Response.Error.Message}`));
              return;
            }
            
            resolve(response.Response);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on("error", (error) => {
        this.logger.debug("请求生图失败：" + JSON.stringify(error));
        reject(error);
      });

      // 处理取消信号
      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request aborted'));
        });
      }

      req.write(payload);
      req.end();
    });
  }

  /**
   * 腾讯混元生图API请求方法
   * @param payload 请求体内容
   * @param signal 可选的取消信号
   * @returns 生成的图片URL
   */
  private async hunyuanImageRequest(
    payload: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const region = this.config.region || "ap-guangzhou";
    const SECRET_ID = this.config.secretId;
    const SECRET_KEY = this.config.secretKey;

    try {
      this.logger.debug(`Submitting Hunyuan image generation request with payload: ${payload}`);
      const response = await this.tencentCloudApiRequest("SubmitHunyuanImageJob", payload, signal);
      
      // 解析成功响应，获取图片URL
      if (response && response.JobId) {
        this.logger.debug(`Image generation job submitted successfully with JobId: ${response.JobId}`);
        
        // 根据JobId获取结果
        const result = await this.getJobResult(response.JobId, region, SECRET_ID, SECRET_KEY);
        
        // 从ResultImage数组中获取图片URL
        if (result && result.ResultImage && Array.isArray(result.ResultImage) && result.ResultImage.length > 0) {
          const imageUrl = result.ResultImage[0];
          this.logger.debug(`Image generation completed successfully. URL: ${imageUrl}`);
          return imageUrl;
        } else {
          throw new Error(`No image URL found in response. Response: ${JSON.stringify(result)}`);
        }
      } else {
        throw new Error(`Invalid response format. Expected JobId but got: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      // 添加更详细的错误日志
      if (error instanceof Error) {
        this.logger.error(`Failed to generate image with Tencent Hunyuan: ${error}`, error);
      } else {
        this.logger.error(`Failed to generate image with Tencent Hunyuan: ${error}`);
      }
      throw error;
    }
  }

  /**
   * 根据JobId获取生图结果，使用指数退避重试机制
   * @param jobId 任务ID
   * @param region 区域
   * @param secretId 密钥ID
   * @param secretKey 密钥
   * @returns 结果对象
   */
  private async getJobResult(
    jobId: string,
    region: string,
    secretId: string,
    secretKey: string
  ): Promise<any> {
    const maxRetries = 30; // 最大重试次数
    const initialDelay = 2000; // 初始延迟时间（毫秒）
    const maxDelay = 30000; // 最大延迟时间（毫秒）
    let retryCount = 0;

    const calculateDelay = (attempt: number): number => {
      // 指数退避算法：delay = min(initialDelay * 2^attempt, maxDelay)
      return Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
    };

    const checkJobStatus = async (): Promise<any> => {
      try {
        const payload = JSON.stringify({ JobId: jobId });
        const response = await this.tencentCloudApiRequest("QueryHunyuanImageJob", payload);
        
        // 检查任务状态
        if (response && response.JobStatusCode !== undefined) {
          const jobStatusCode = response.JobStatusCode;
          const jobStatusMsg = response.JobStatusMsg || '';
          
          // 使用枚举值判断状态
          if (jobStatusCode === HunyuanJobStatusCode.COMPLETED) {
            // 任务完成，返回结果
            return response;
          } else if (jobStatusCode === HunyuanJobStatusCode.FAILED || response.JobErrorMsg) {
            // 任务失败（状态码4表示失败，或者存在错误消息）
            throw new Error(`Image generation failed: ${response.JobErrorMsg || response.JobStatusMsg || 'Unknown error'}`);
          } else {
            // 任务仍在进行中（等待中或运行中），继续轮询
            retryCount++;
            if (retryCount < maxRetries) {
              // 计算当前重试的延迟时间
              const currentDelay = calculateDelay(retryCount);
              
              // 使用延迟和递归来实现轮询
              return new Promise((resolve, reject) => {
                setTimeout(async () => {
                  try {
                    const result = await checkJobStatus();
                    resolve(result);
                  } catch (error) {
                    reject(error);
                  }
                }, currentDelay);
              });
            } else {
              throw new Error(`Image generation timed out after ${maxRetries} retries (approximately ${Math.round(maxRetries * initialDelay / 1000)} seconds)`);
            }
          }
        } else {
          throw new Error('Invalid response format');
        }
      } catch (error) {
        // 如果是网络错误或其他临时性错误，也可以重试
        if (retryCount < maxRetries / 2) { // 对于临时错误，重试次数减半
          retryCount++;
          const currentDelay = calculateDelay(retryCount);
          
          return new Promise((resolve, reject) => {
            setTimeout(async () => {
              try {
                const result = await checkJobStatus();
                resolve(result);
              } catch (err) {
                reject(err);
              }
            }, currentDelay);
          });
        }
        throw error;
      }
    };

    // 开始检查任务状态
    return checkJobStatus();
  }

  /**
   * SHA256哈希计算
   */
  private sha256(message: string, secret: string | Buffer = "", encoding: "buffer" | "hex" | "latin1" | "base64" = "hex"): string | Buffer {
    const hmac = crypto.createHmac("sha256", secret);
    return hmac.update(message).digest(encoding);
  }

  /**
   * 获取消息的SHA256哈希值
   */
  private getHash(message: string, encoding: "buffer" | "hex" | "latin1" | "base64" = "hex"): string {
    const hash = crypto.createHash("sha256");
    return hash.update(message).digest(encoding);
  }

  /**
   * 根据时间戳获取日期字符串
   */
  private getDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const year = date.getUTCFullYear();
    const month = ("0" + (date.getUTCMonth() + 1)).slice(-2);
    const day = ("0" + date.getUTCDate()).slice(-2);
    return `${year}-${month}-${day}`;
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