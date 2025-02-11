import {
  EdgelessEditorBlockSpecs,
  PageEditorBlockSpecs,
} from '@blocksuite/blocks';

export function getExampleSpecs() {
  const pageModeSpecs = PageEditorBlockSpecs;
  const edgelessModeSpecs = EdgelessEditorBlockSpecs;

  return {
    pageModeSpecs,
    edgelessModeSpecs,
  };
}
