import { describe, test, expect } from '@jest/globals';
import {
  isoWeekParts, isoWeekKey, startOfIsoWeek, isoWeekBounds,
  boundsFromKey, previousKey, nextKey,
} from '../src/utils/isoWeek.js';

describe('isoWeek', () => {
  test('known dates produce expected keys', () => {
    // 2026-01-01 is a Thursday → week 1
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    // 2025-12-29 is a Monday → week 1 of 2026
    expect(isoWeekKey(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
    // 2026-10-05 is a Monday, week 41
    expect(isoWeekKey(new Date('2026-10-05T00:00:00Z'))).toBe('2026-W41');
  });

  test('startOfIsoWeek always lands on a Monday', () => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2026, 9, 5 + i));
      const monday = startOfIsoWeek(d);
      expect(monday.getUTCDay()).toBe(1);
      expect(monday.getUTCHours()).toBe(0);
    }
  });

  test('bounds are exclusive on end', () => {
    const { startAt, endAt } = isoWeekBounds(new Date('2026-10-07T12:00:00Z'));
    expect(startAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  test('boundsFromKey round-trips', () => {
    const { startAt } = boundsFromKey('2026-W41');
    expect(isoWeekKey(startAt)).toBe('2026-W41');
  });

  test('boundsFromKey rejects malformed input', () => {
    expect(() => boundsFromKey('2026-W99')).toThrow();
    expect(() => boundsFromKey('garbage')).toThrow();
    expect(() => boundsFromKey('2026-41')).toThrow();
  });

test('previousKey and nextKey', () => {
  expect(previousKey('2026-W01')).toBe('2025-W52');
  expect(nextKey('2026-W52')).toBe('2026-W53');
  expect(nextKey('2026-W53')).toBe('2027-W01');
});
});