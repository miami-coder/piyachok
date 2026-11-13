export const REVIEW_CREATED = 'review.created';
export const REVIEW_UPDATED = 'review.updated';
export const REVIEW_DELETED = 'review.deleted';

export interface ReviewCreatedEvent {
  reviewId: string;
  venueId: string;
}

export interface ReviewUpdatedEvent {
  reviewId: string;
  venueId: string;
}

export interface ReviewDeletedEvent {
  reviewId: string;
  venueId: string;
}
