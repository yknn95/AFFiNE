export { AIButtonProvider } from './provider/ai-button';
export { AIButtonService } from './services/ai-button';

import type { Framework } from '@toeverything/infra';

import { AIButtonProvider } from './provider/ai-button';
import { AIButtonService } from './services/ai-button';

export const configureAIButtonModule = (framework: Framework) => {
  framework.service(AIButtonService, container => {
    return new AIButtonService(container.getOptional(AIButtonProvider));
  });
};
