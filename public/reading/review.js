import { createEmptyCard, fsrs, Rating } from '../vendor/fsrs/index.mjs';

const scheduler = fsrs({ enable_fuzz: false });
const ratings = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
});

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (value === null || value === undefined || !Number.isFinite(date.getTime())) {
    throw new TypeError(`Invalid review date: ${field}`);
  }
  return date;
}

function restoreCard(previous, now) {
  if (!previous) return createEmptyCard(now);
  const stored = previous.card ?? previous;
  const card = { ...stored, due: asDate(stored.due, 'card.due') };
  if (stored.last_review != null) {
    card.last_review = asDate(stored.last_review, 'card.last_review');
  } else {
    delete card.last_review;
  }
  return card;
}

/**
 * Schedule one completed review using ts-fsrs. `previous` can be a saved record
 * returned here, a raw FSRS card, or null for a newly collected question/word.
 * Date fields survive JSON.stringify/JSON.parse and are restored before use.
 */
export function scheduleReview(previous, rating, now = new Date()) {
  if (!Object.prototype.hasOwnProperty.call(ratings, rating)) {
    throw new TypeError('Review rating must be again, hard, good, or easy');
  }
  const reviewedAt = asDate(now, 'now');
  const { card } = scheduler.next(restoreCard(previous, reviewedAt), reviewedAt, ratings[rating]);
  return {
    card,
    due: card.due.toISOString(),
    reps: card.reps,
    lastRating: rating,
  };
}

function dueTime(record) {
  const value = record?.due ?? record?.card?.due;
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** A newly collected item has no prior review and is ready for its first recall. */
export function isDue(record, now = new Date()) {
  if (record == null) return true;
  const due = dueTime(record);
  return due !== null && due <= asDate(now, 'now').getTime();
}

/** Relative labels avoid dependence on the server's calendar/time zone. */
export function dueLabel(record) {
  if (record == null) return '首次待复习';
  const due = dueTime(record);
  if (due === null) return '尚未安排';
  const remaining = due - Date.now();
  if (remaining <= 0) return '待复习';
  if (remaining < 60 * 60 * 1000) return `${Math.ceil(remaining / 60000)} 分钟后`;
  if (remaining < 24 * 60 * 60 * 1000) return `${Math.ceil(remaining / 3600000)} 小时后`;
  return `${Math.ceil(remaining / 86400000)} 天后`;
}
