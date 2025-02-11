import { getTextElementText } from '../../../utils/text.js';
import type { ElementModelToMarkdownAdapterMatcher } from '../type.js';

export const textToMarkdownAdapterMatcher: ElementModelToMarkdownAdapterMatcher =
  {
    name: 'text',
    match: elementModel => elementModel.type === 'text',
    toAST: elementModel => {
      const content = getTextElementText(elementModel);
      if (!content) {
        return null;
      }

      return {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value: content,
          },
        ],
      };
    },
  };
