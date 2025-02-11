import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

import { EventEmitter, type EventPayload } from '../../base';
import {
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionVariant,
} from './types';

@Injectable()
export class SubscriptionCronJobs {
  constructor(
    private readonly db: PrismaClient,
    private readonly event: EventEmitter
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpiredOnetimeSubscriptions() {
    const subscriptions = await this.db.subscription.findMany({
      where: {
        variant: SubscriptionVariant.Onetime,
        end: {
          lte: new Date(),
        },
      },
    });

    for (const subscription of subscriptions) {
      this.event.emit('user.subscription.canceled', {
        userId: subscription.targetId,
        plan: subscription.plan as SubscriptionPlan,
        recurring: subscription.variant as SubscriptionRecurring,
      });
    }
  }

  @OnEvent('user.subscription.canceled')
  async handleUserSubscriptionCanceled({
    userId,
    plan,
  }: EventPayload<'user.subscription.canceled'>) {
    await this.db.subscription.delete({
      where: {
        targetId_plan: {
          targetId: userId,
          plan,
        },
      },
    });
  }
}
