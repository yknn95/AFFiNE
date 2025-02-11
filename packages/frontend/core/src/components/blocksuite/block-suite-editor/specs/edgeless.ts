import { AIEdgelessRootBlockSpec } from '@affine/core/blocksuite/presets/ai';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { builtInTemplates as builtInEdgelessTemplates } from '@affine/templates/edgeless';
import { builtInTemplates as builtInStickersTemplates } from '@affine/templates/stickers';
import type { ExtensionType } from '@blocksuite/affine/block-std';
import type { TemplateManager } from '@blocksuite/affine/blocks';
import {
  EdgelessRootBlockSpec,
  EdgelessTemplatePanel,
  SpecProvider,
} from '@blocksuite/affine/blocks';
import { type FrameworkProvider } from '@toeverything/infra';

import { enableAffineExtension, enableAIExtension } from './custom/root-block';

export function createEdgelessModeSpecs(
  framework: FrameworkProvider
): ExtensionType[] {
  const featureFlagService = framework.get(FeatureFlagService);
  const enableAI = featureFlagService.flags.enable_ai.value;
  const edgelessSpec = SpecProvider.getInstance().getSpec('edgeless');
  enableAffineExtension(framework, edgelessSpec);
  if (enableAI) {
    enableAIExtension(edgelessSpec);
    edgelessSpec.replace(EdgelessRootBlockSpec, AIEdgelessRootBlockSpec);
  }

  return edgelessSpec.value;
}

export function effects() {
  EdgelessTemplatePanel.templates.extend(
    builtInStickersTemplates as TemplateManager
  );
  EdgelessTemplatePanel.templates.extend(
    builtInEdgelessTemplates as TemplateManager
  );
}
