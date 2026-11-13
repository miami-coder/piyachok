import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VenuesCatalogService } from '../venues-catalog.service';
import { VENUE_CREATED, VENUE_UPDATED, VENUE_STATUS_CHANGED } from '../events';

@Injectable()
export class VenueCacheListener {
  constructor(private readonly catalog: VenuesCatalogService) {}

  @OnEvent(VENUE_CREATED)
  @OnEvent(VENUE_UPDATED)
  @OnEvent(VENUE_STATUS_CHANGED)
  async invalidate() {
    await this.catalog.invalidateListCache();
  }
}
