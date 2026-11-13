export const HANGOUT_FILLED = 'hangout.filled';
export const HANGOUT_CANCELLED = 'hangout.cancelled';

export interface HangoutFilledEvent {
  hangoutId: string;
}

export interface HangoutCancelledEvent {
  hangoutId: string;
  /** true — заявку видалено повністю, а не лише скасовано */
  deleted?: boolean;
}
