import {
  AnthropicOfficialProvider,
  AnthropicVertexProvider,
} from './anthropic';
import { CloudflareWorkersAIProvider } from './cloudflare';
import { DeepSeekProvider } from './deepseek';
import { FalProvider } from './fal';
import { GeminiGenerativeProvider, GeminiVertexProvider } from './gemini';
import { OpenAIProvider } from './openai';

export const CopilotProviders = [
  OpenAIProvider,
  DeepSeekProvider,
  CloudflareWorkersAIProvider,
  FalProvider,
  GeminiGenerativeProvider,
  GeminiVertexProvider,
  AnthropicOfficialProvider,
  AnthropicVertexProvider,
];
