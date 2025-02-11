import '../../../style.css';

import { createEmptyDoc, EdgelessEditor } from '@blocksuite/presets';

const doc = createEmptyDoc().init();
const editor = new EdgelessEditor();
editor.doc = doc;
document.body.append(editor);
