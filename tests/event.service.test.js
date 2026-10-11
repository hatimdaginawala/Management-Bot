import { describe, test, expect, beforeEach } from '@jest/globals';
import * as eventService from '../src/services/event.service.js';
import { User, Attendance, Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { seedEventTypes } from '../scripts/seedEventTypes.js';
import { ValidationError, ConflictError, NotFoundError } from '../src/utils/errors.js';

// ---------------------------------------------------------------------------
//  Fixtures
// ---------------------------------------------------------------------------

async function makeUser(discordId) {
  return User.create({ discordId, status: 'ACTIVE' });
}

/**
 * Every test must pass its attendees explicitly. No default attendees.
 * This avoids "the fixture created X but the payload sent Y" bugs.
 */
function payload({ attendees, ...overrides }) {
  if (!attendees) throw new Error('payload() requires explicit attendees');
  return {
    eventTypeKey: 'patrol',
    proofUrl: 'https://example.com/proof.png',
    notes: '',
    attendees,
    ...overrides,
  };
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedEventTypes();
});

// ===========================================================================
describe('event.service — createEvent', () => {
  test('happy path creates PENDING when approval required', async () => {
    await makeUser('host1');
    await makeUser('a1');

    const event = await eventService.createEvent('host1', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    expect(event.status).toBe('PENDING');
    expect(event.attendeeEntries).toHaveLength(1);
    expect(event.attendeeEntries[0].discordId).toBe('a1');
  });

  test('rejects when proof is missing', async () => {
    await makeUser('host2');
    await makeUser('a1');
    await expect(
      eventService.createEvent('host2', payload({
        attendees: [{ discordId: 'a1' }],
        proofUrl: '',
      }))
    ).rejects.toThrow(ValidationError);
  });

  test('rejects when proof is not a URL', async () => {
    await makeUser('host3');
    await makeUser('a1');
    await expect(
      eventService.createEvent('host3', payload({
        attendees: [{ discordId: 'a1' }],
        proofUrl: 'not-a-url',
      }))
    ).rejects.toThrow(ValidationError);
  });

  test('rejects unknown event type', async () => {
    await makeUser('host4');
    await makeUser('a1');
    await expect(
      eventService.createEvent('host4', payload({
        attendees: [{ discordId: 'a1' }],
        eventTypeKey: 'nope',
      }))
    ).rejects.toThrow(NotFoundError);
  });

  test('excludes the host from attendees', async () => {
    await makeUser('host5');
    await makeUser('a1');
    const event = await eventService.createEvent('host5', payload({
      attendees: [{ discordId: 'host5' }, { discordId: 'a1' }],
    }));
    const ids = event.attendeeEntries.map((a) => a.discordId);
    expect(ids).not.toContain('host5');
    expect(ids).toContain('a1');
  });

  test('deduplicates attendees', async () => {
    await makeUser('host6');
    await makeUser('a1');
    const event = await eventService.createEvent('host6', payload({
      attendees: [{ discordId: 'a1' }, { discordId: 'a1' }],
    }));
    expect(event.attendeeEntries).toHaveLength(1);
  });

  test('enforces 5-minute cooldown', async () => {
    await makeUser('host7');
    await makeUser('a1');
    await eventService.createEvent('host7', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await expect(
      eventService.createEvent('host7', payload({
        attendees: [{ discordId: 'a1' }],
      }))
    ).rejects.toThrow(ConflictError);
  });

  test('auto-approves when approvalRequired is false', async () => {
    await makeUser('host8');
    await makeUser('a1');
    await Settings.updateOne(
      { key: 'global' },
      { $set: { 'events.approvalRequired': false } }
    );

    const event = await eventService.createEvent('host8', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    expect(event.status).toBe('APPROVED');

    const atts = await Attendance.find({ event: event._id });
    expect(atts).toHaveLength(1);
  });
});

// ===========================================================================
describe('event.service — approveEvent', () => {
  test('approves and creates attendance', async () => {
    await makeUser('h1');
    await makeUser('a1');
    await makeUser('a2');
    const event = await eventService.createEvent('h1', payload({
      attendees: [{ discordId: 'a1' }, { discordId: 'a2' }],
    }));

    const { event: approved, alreadyApproved } = await eventService.approveEvent('admin', event._id);
    expect(approved.status).toBe('APPROVED');
    expect(alreadyApproved).toBe(false);

    const atts = await Attendance.find({ event: event._id });
    expect(atts).toHaveLength(2);
  });

  test('is idempotent — approve twice has no double attendance', async () => {
    await makeUser('h2');
    await makeUser('a1');
    const event = await eventService.createEvent('h2', payload({
      attendees: [{ discordId: 'a1' }],
    }));

    await eventService.approveEvent('admin', event._id);
    const second = await eventService.approveEvent('admin', event._id);
    expect(second.alreadyApproved).toBe(true);

    const atts = await Attendance.find({ event: event._id });
    expect(atts).toHaveLength(1);
  });

  test('rejects approval of a REJECTED event', async () => {
    await makeUser('h3');
    await makeUser('a1');
    const event = await eventService.createEvent('h3', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await eventService.rejectEvent('admin', event._id, { reason: 'invalid proof' });
    await expect(eventService.approveEvent('admin', event._id)).rejects.toThrow(ConflictError);
  });
});

// ===========================================================================
describe('event.service — rejectEvent', () => {
  test('rejects with a reason, no attendance created', async () => {
    await makeUser('h4');
    await makeUser('a1');
    const event = await eventService.createEvent('h4', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    const rejected = await eventService.rejectEvent('admin', event._id, { reason: 'proof blurred' });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('proof blurred');
    const atts = await Attendance.find({ event: event._id });
    expect(atts).toHaveLength(0);
  });

  test('rejects without reason throws', async () => {
    await makeUser('h5');
    await makeUser('a1');
    const event = await eventService.createEvent('h5', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await expect(
      eventService.rejectEvent('admin', event._id, { reason: '' })
    ).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
describe('event.service — cancelEvent', () => {
  test('cancels APPROVED event and removes attendance', async () => {
    await makeUser('h6');
    await makeUser('a1');
    const event = await eventService.createEvent('h6', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await eventService.approveEvent('admin', event._id);

    const cancelled = await eventService.cancelEvent('admin', event._id, { reason: 'invalid' });
    expect(cancelled.status).toBe('CANCELLED');
    const atts = await Attendance.find({ event: event._id });
    expect(atts).toHaveLength(0);
  });

  test('cancel is idempotent', async () => {
    await makeUser('h7');
    await makeUser('a1');
    const event = await eventService.createEvent('h7', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await eventService.cancelEvent('admin', event._id);
    const second = await eventService.cancelEvent('admin', event._id);
    expect(second.status).toBe('CANCELLED');
  });
});

// ===========================================================================
describe('event.service — updateEvent', () => {
  test('changing attendees recomputes attendance', async () => {
    await makeUser('h8');
    await makeUser('a1');
    await makeUser('a2');
    const event = await eventService.createEvent('h8', payload({
      attendees: [{ discordId: 'a1' }],
    }));
    await eventService.approveEvent('admin', event._id);

    await eventService.updateEvent('admin', event._id, {
      attendees: [{ discordId: 'a2' }],
    });

    const atts = await Attendance.find({ event: event._id }).lean();
    expect(atts).toHaveLength(1);
    expect(atts[0].discordId).toBe('a2');
  });
});

// ===========================================================================
describe('event.service — listEvents', () => {
  test('filters by status and paginates', async () => {
    await makeUser('lh1');
    await makeUser('lh2');
    await makeUser('lh3');
    await makeUser('a1');

    await eventService.createEvent('lh1', payload({ attendees: [{ discordId: 'a1' }] }));
    await eventService.createEvent('lh2', payload({ attendees: [{ discordId: 'a1' }] }));
    await eventService.createEvent('lh3', payload({ attendees: [{ discordId: 'a1' }] }));

    const result = await eventService.listEvents({ status: 'PENDING', page: 1, pageSize: 2 });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.totalPages).toBe(2);
  });
});