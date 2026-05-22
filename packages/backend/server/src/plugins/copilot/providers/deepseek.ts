import { CopilotProviderSideError, UserFriendlyError } from '../../../base';
import { type LlmBackendConfig } from '../../../native';
import { CopilotProvider } from './provider';
import type {
  CopilotProviderExecution,
  ProviderDriverSpec,
} from './provider-runtime-contract';
import { CopilotProviderType } from './types';

export type DeepSeekConfig = {
  apiKey: string;
  baseURL?: string;
};

export class DeepSeekProvider extends CopilotProvider<DeepSeekConfig> {
  override readonly type = CopilotProviderType.DeepSeek;

  protected resolveModelBackendKind() {
    return 'deepseek' as const;
  }

  override configured(execution?: CopilotProviderExecution): boolean {
    return !!this.getConfig(execution).apiKey;
  }

  private createNativeConfig(
    execution?: CopilotProviderExecution
  ): LlmBackendConfig {
    const config = this.getConfig(execution);
    const baseUrl = config.baseURL || 'https://api.deepseek.com/v1';
    return {
      base_url: baseUrl.replace(/\/v1\/?$/, ''),
      auth_token: config.apiKey,
    };
  }

  private handleError(e: any) {
    if (e instanceof UserFriendlyError) {
      return e;
    }
    return new CopilotProviderSideError({
      provider: this.type,
      kind: 'unexpected_response',
      message: e?.message || 'Unexpected deepseek response',
    });
  }

  override getDriverSpec(): ProviderDriverSpec {
    return {
      createBackendConfig: execution => this.createNativeConfig(execution),
      mapError: error => this.handleError(error),
      chat: {
        resolveTooling: context => ({
          middleware: this.getActiveProviderMiddleware(context.execution),
        }),
      },
      structured: false,
      embedding: false,
      rerank: false,
      image: false,
    };
  }
}
