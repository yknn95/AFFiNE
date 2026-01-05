import {
  AnthropicOfficialProvider,
  AnthropicVertexProvider,
} from './anthropic';
import { FalProvider } from './fal';
import { GeminiGenerativeProvider, GeminiVertexProvider } from './gemini';
import { MorphProvider } from './morph';
import { OpenAIProvider } from './openai';
import { PerplexityProvider } from './perplexity';
import { TencentHunyuanProvider } from './tencent-hunyuan';

export const CopilotProviders = [
  OpenAIProvider,
  FalProvider,
  GeminiGenerativeProvider,
  GeminiVertexProvider,
  PerplexityProvider,
  AnthropicOfficialProvider,
  AnthropicVertexProvider,
  MorphProvider,
  TencentHunyuanProvider,
];

export {
  AnthropicOfficialProvider,
  AnthropicVertexProvider,
} from './anthropic';
export { CopilotProviderFactory } from './factory';
export { FalProvider } from './fal';
export { GeminiGenerativeProvider, GeminiVertexProvider } from './gemini';
export { OpenAIProvider } from './openai';
export { PerplexityProvider } from './perplexity';
export { TencentHunyuanProvider } from './tencent-hunyuan';
export type { CopilotProvider } from './provider';
export * from './types';
