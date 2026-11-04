import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VenuesService } from '../../venues/venues.service';
import { REVIEW_CREATED, REVIEW_UPDATED, REVIEW_DELETED } from '../events';

@Injectable()
export class RatingRecalcListener {
  constructor(private readonly venues: VenuesService) {}

  @OnEvent(REVIEW_CREATED)
  @OnEvent(REVIEW_UPDATED)
  @OnEvent(REVIEW_DELETED)
  async invalidate() {
    await this.venues.invalidateListCache();
  }
}
