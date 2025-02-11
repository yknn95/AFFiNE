import { DragIndicator } from './drag-indicator.js';
export {
  FileDropConfigExtension,
  FileDropExtension,
  type FileDropOptions,
  type onDropProps,
} from './file-drop-manager.js';

export { DragIndicator };

export function effects() {
  customElements.define('affine-drag-indicator', DragIndicator);
}
