import { Injectable, Logger } from '@nestjs/common';

import type { Turn } from '../../core';
import type { StreamObject } from '../../providers/types';
import { ChatSession } from '../../session';
import { ConversationHost } from './conversation-host';
import { ResponsePostprocessor } from './response-postprocessor';

@Injectable()
export class TurnPersistence {
  private readonly logger = new Logger(TurnPersistence.name);

  constructor(
    private readonly conversations: ConversationHost,
    private readonly postprocessor: ResponsePostprocessor
  ) {}

  async persistTextResult(
    session: ChatSession,
    content: string,
    wasAborted: boolean
  ) {
    return await this.conversations.persistAssistantTurn(
      session,
      this.postprocessor.buildTextAssistantTurn(
        session.config.sessionId,
        content
      ),
      wasAborted
    );
  }

  async persistObjectResult(
    session: ChatSession,
    chunks: StreamObject[],
    wasAborted: boolean
  ) {
    return await this.conversations.persistAssistantTurn(
      session,
      this.postprocessor.buildObjectAssistantTurn(
        session.config.sessionId,
        chunks
      ),
      wasAborted
    );
  }

  async persistImageResult(
    session: ChatSession,
    attachments: string[],
    wasAborted: boolean
  ) {
    this.logger.log(
      `[image-turn-persist] sessionId=${session.config.sessionId} workspaceId=${session.config.workspaceId ?? 'n/a'} attachments=${attachments.length} aborted=${wasAborted}`
    );
    attachments.forEach((attachment, index) => {
      this.logger.log(
        `[image-turn-persist] attachment[${index}]=${attachment.slice(0, 160)}${attachment.length > 160 ? '...' : ''}`
      );
    });
    return await this.conversations.persistAssistantTurn(
      session,
      this.postprocessor.buildImageAssistantTurn(
        session.config.sessionId,
        attachments
      ),
      wasAborted
    );
  }

  async persistProjectedResult(
    session: ChatSession,
    turn: Turn,
    wasAborted: boolean
  ) {
    return await this.conversations.persistAssistantTurn(
      session,
      turn,
      wasAborted
    );
  }
}
