export const VENUE_CREATED = 'venue.created';
export const VENUE_UPDATED = 'venue.updated';
export const VENUE_STATUS_CHANGED = 'venue.status_changed';

export interface VenueCreatedEvent {
  venueId: string;
}

export interface VenueUpdatedEvent {
  venueId: string;
}

export interface VenueStatusChangedEvent {
  venueId: string;
  from: string;
  to: string;
}
