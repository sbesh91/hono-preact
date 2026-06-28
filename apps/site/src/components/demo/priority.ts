// Shared priority label + badge-class maps, used by both the board card
// (TaskCard) and the task detail hero so the two stay visually identical and the
// card->detail view-transition morph reads as the same card growing.
import type { Task } from '../../demo/data.js';

export const PRIORITY_LABEL: Record<Task['priority'], string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIORITY_BADGE: Record<Task['priority'], string> = {
  urgent: 'badge-urgent',
  high: 'badge-high',
  medium: 'badge-medium',
  low: 'badge-low',
};
