import { describe, test, expect, beforeEach } from '@jest/globals';
import * as attendanceService from '../src/services/attendance.service.js';
import * as eventService from '../src/services/event.service.js';
import { User, Event, Attendance, Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { ValidationError, NotFoundError, ConflictError } from '../src/utils/errors.js';

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

/**
 * Create an APPROVED event with the given attendees (which must
 * already exist as Users).
 */
async function makeApprovedEvent(hostDiscordId, attendeeDiscordIds) {
  const event = await eventService.createEvent(hostDiscordId, {
    eventTypeKey: 'patrol',
    proofUrl: 'https://example.com/x.png',
    attendees: attendeeDiscordIds.map((d) => ({ discordId: d })),
  });
  // Force approval path (Phase 7 CAS).
  await eventService.approveEvent('admin', event._id);
  return event;
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
});

// ===========================================================================
describe('attendance.service — listAttendance', () => {
  test('returns active rows for a specific user', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');
    await makeApprovedEvent('h1', ['a1', 'a2']);

    const result = await attendanceService.listAttendance({ userDiscordId: 'a1' });
    expect(result.total).toBe(1);
    expect(result.items[0].discordId).toBe('a1');
    expect(result.items[0].active).toBe(true);
  });

  test('filters by eventId', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);

    const result = await attendanceService.listAttendance({ eventId: event._id });
    expect(result.total).toBe(1);
    expect(String(result.items[0].event)).toBe(String(event._id));
  });

  test('filters by eventTypeKey', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeApprovedEvent('h1', ['a1']);

    const result = await attendanceService.listAttendance({ eventTypeKey: 'patrol' });
    expect(result.total).toBe(1);

    const empty = await attendanceService.listAttendance({ eventTypeKey: 'raid' });
    expect(empty.total).toBe(0);
  });

  test('pagination works', async () => {
    await makeUser('h1');
    const attendees = ['a1', 'a2', 'a3', 'a4', 'a5'];
    for (const a of attendees) await makeUser(a);
    await makeApprovedEvent('h1', attendees);

    const page1 = await attendanceService.listAttendance({ page: 1, pageSize: 2 });
    const page2 = await attendanceService.listAttendance({ page: 2, pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.totalPages).toBe(3);
  });
});

// ===========================================================================
describe('attendance.service — getAttendanceHistory', () => {
  test('returns all rows (active and inactive)', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);
    await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'invalid',
    });

    const history = await attendanceService.getAttendanceHistory('a1');
    expect(history.records).toHaveLength(1);
    expect(history.records[0].active).toBe(false);
    expect(history.activeCount).toBe(0);
    expect(history.inactiveCount).toBe(1);
  });

  test('throws NotFoundError for unknown user', async () => {
    await expect(
      attendanceService.getAttendanceHistory('nobody')
    ).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
describe('attendance.service — attendanceStats', () => {
  test('total counts active rows', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');
    await makeApprovedEvent('h1', ['a1', 'a2']);

    const result = await attendanceService.attendanceStats({ mode: 'total' });
    expect(result.total).toBe(2);
  });

  test('byUser ranks top attendees', async () => {
    await makeUser('h1');
    await makeUser('h2');
    await makeUser('a1');
    await makeUser('a2');
    await makeApprovedEvent('h1', ['a1', 'a2']);
    // Second event with different host to bypass cooldown.
    await makeApprovedEvent('h2', ['a1']);

    const result = await attendanceService.attendanceStats({ mode: 'byUser', limit: 5 });
    expect(result.rows[0].discordId).toBe('a1');
    expect(result.rows[0].count).toBe(2);
  });

  test('byType aggregates by eventTypeKey', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeApprovedEvent('h1', ['a1']);

    const result = await attendanceService.attendanceStats({ mode: 'byType' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]._id).toBe('patrol');
    expect(result.rows[0].count).toBe(1);
  });

  test('byWeek aggregates by ISO week', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeApprovedEvent('h1', ['a1']);

    const result = await attendanceService.attendanceStats({ mode: 'byWeek' });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].count).toBe(1);
  });

  test('unknown mode throws ValidationError', async () => {
    await expect(
      attendanceService.attendanceStats({ mode: 'nope' })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('attendance.service — addManualAttendance', () => {
  test('adds a new row', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);
    // Now add a second user who wasn't an original attendee.
    await makeUser('a2');

    const record = await attendanceService.addManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a2',
      reason: 'forgot to include',
    });
    expect(record.status).toBe('MANUAL_ADDED');
    expect(record.addedBy).toBe('admin');
  });

  test('is idempotent — re-adding is a no-op', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);

    await attendanceService.addManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
    });
    const record = await attendanceService.addManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
    });

    const all = await Attendance.find({ event: event._id, user: (await User.findOne({ discordId: 'a1' }))._id });
    expect(all).toHaveLength(1);
    expect(record).toBeTruthy();
  });

  test('rejects adding to a non-approved event', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await eventService.createEvent('h1', {
      eventTypeKey: 'patrol',
      proofUrl: 'https://example.com/x.png',
      attendees: [{ discordId: 'a1' }],
    });
    // Not approved yet.
    await expect(
      attendanceService.addManualAttendance('admin', {
        eventId: event._id,
        userDiscordId: 'a1',
      })
    ).rejects.toThrow(ConflictError);
  });

  test('rejects adding the host', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);
    await expect(
      attendanceService.addManualAttendance('admin', {
        eventId: event._id,
        userDiscordId: 'h1',   // ← host
      })
    ).rejects.toThrow(ValidationError);
  });

  test('reactivates a previously removed row', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);
    await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'invalid proof of presence',
    });
    const record = await attendanceService.addManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'reinstated after review',
    });
    expect(record.active).toBe(true);
    expect(record.status).toBe('MANUAL_ADDED');
  });
});

// ===========================================================================
describe('attendance.service — removeManualAttendance', () => {
  test('soft-removes an active row', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);

    const removed = await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'invalid proof',
    });
    expect(removed.active).toBe(false);
    expect(removed.status).toBe('MANUAL_REMOVED');
    expect(removed.removedBy).toBe('admin');
    expect(removed.reason).toBe('invalid proof');
  });

  test('requires a reason', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);
    await expect(
      attendanceService.removeManualAttendance('admin', {
        eventId: event._id,
        userDiscordId: 'a1',
        reason: '',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('throws NotFoundError if no row exists', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');   // ← not an attendee
    const event = await makeApprovedEvent('h1', ['a1']);
    await expect(
      attendanceService.removeManualAttendance('admin', {
        eventId: event._id,
        userDiscordId: 'a2',
        reason: 'was not there',
      })
    ).rejects.toThrow(NotFoundError);
  });

  test('is idempotent — re-removing is a no-op', async () => {
    await makeUser('h1');
    await makeUser('a1');
    const event = await makeApprovedEvent('h1', ['a1']);

    const first = await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'invalid',
    });
    const second = await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a1',
      reason: 'invalid again',
    });
    expect(second.active).toBe(false);
    expect(second.status).toBe('MANUAL_REMOVED');
  });
});

// ===========================================================================
describe('attendance.service — helpers', () => {
  test('countAttendanceForUser respects date range', async () => {
    await makeUser('h1');
    const user = await makeUser('a1');
    await makeApprovedEvent('h1', ['a1']);

    const all = await attendanceService.countAttendanceForUser(user._id);
    expect(all).toBe(1);

    const future = await attendanceService.countAttendanceForUser(user._id, {
      from: new Date(Date.now() + 86_400_000),
    });
    expect(future).toBe(0);
  });

  test('countAttendanceForEvent returns active count', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');
    const event = await makeApprovedEvent('h1', ['a1', 'a2']);

    const count = await attendanceService.countAttendanceForEvent(event._id);
    expect(count).toBe(2);

    await attendanceService.removeManualAttendance('admin', {
      eventId: event._id,
      userDiscordId: 'a2',
      reason: 'invalid',
    });
    const after = await attendanceService.countAttendanceForEvent(event._id);
    expect(after).toBe(1);
  });
});