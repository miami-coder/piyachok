import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PermissionsService } from '../permissions.service';
import {
  USER_ROLE_ADDED,
  USER_ROLE_REMOVED,
  type UserRoleAddedEvent,
  type UserRoleRemovedEvent,
} from '../events';

@Injectable()
export class UserRoleListener {
  private readonly logger = new Logger(UserRoleListener.name);

  constructor(private readonly perms: PermissionsService) {}

  @OnEvent(USER_ROLE_ADDED)
  async handleAdded(payload: UserRoleAddedEvent) {
    this.logger.log(
      `Invalidating permissions cache for user ${payload.userId} (role added)`,
    );
    await this.perms.invalidate(payload.userId);
  }

  @OnEvent(USER_ROLE_REMOVED)
  async handleRemoved(payload: UserRoleRemovedEvent) {
    this.logger.log(
      `Invalidating permissions cache for user ${payload.userId} (role removed)`,
    );
    await this.perms.invalidate(payload.userId);
  }
}
