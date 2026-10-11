import {
  Event,
  EventType,
  User,
  Attendance,
  Settings,
} from '../models/index.js';
import { audit } from '../utils/audit.js';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  AuthorizationError,
} from '../utils/errors.js';
import { EVENT_COOLDOWN_MS } from '../config/constants.js';
import logger from '../config/logger.js';

/**
 * Event service.
 *
 * Single entry point for all event operations. Discord commands and
 * future REST routes call these; nothing else touches Event or
 * Attendance directly.
 *
 * Idempotency strategy (no transactions):
 *   - approveEvent: `findOneAndUpdate({ status: 'PENDING' }, { status: 'APPROVED' })`
 *     acts as a CAS. Only the caller who wins the CAS performs the
 *     attendance fan-out.
 *   - Attendance uses `Attendance.updateOne(..., { upsert: true })`
 *     which is idempotent thanks to `uniq_event_user`.
 *   - cancelEvent deletes Attendance rows by event ID, which is safe
 *     to re-run.
 *   - updateEvent recomputes attendance as a full set-difference:
 *     adds new, removes stale, leaves unchanged.
 */

// ============================================================
//  Helpers
// ============================================================

async function getSettings() {
  const s = await Settings.findOne({ key: 'global' }).lean();
  return s ?? {};
}

/**
 * Normalize attendee entries:
 *   - dedupe by discordId (and robloxUsername for unverified)
 *   - remove the host if present
 *   - cap the list length to prevent abuse
 */
function normalizeAttendees(rawAttendees, hostDiscordId) {
  const MAX = 200;
  const seen = new Set();
  const result = [];

  for (const a of rawAttendees) {
    if (result.length >= MAX) break;
    const discordId = a.discordId ? String(a.discordId) : null;
    const robloxUsername = a.robloxUsername ? String(a.robloxUsername).trim() : null;

    if (!discordId && !robloxUsername) continue;
    if (discordId && discordId === hostDiscordId) continue; // host excluded

    const key = discordId ?? `rbx:${robloxUsername.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      discordId: discordId ?? null,
      robloxUsername: robloxUsername ?? null,
      resolvedUserId: a.resolvedUserId ?? null,
      isVerified: Boolean(a.resolvedUserId),
    });
  }

  return result;
}

/**
 * Look up Users for every attendee entry that has a discordId.
 * Unlinked attendees stay unverified.
 */
async function resolveAttendeeUsers(entries) {
  const withDiscordIds = entries.filter((e) => e.discordId);
  if (withDiscordIds.length === 0) return entries;

  const users = await User.find({
    discordId: { $in: withDiscordIds.map((e) => e.discordId) },
  })
    .select('_id discordId')
    .lean();
  const byDiscordId = new Map(users.map((u) => [u.discordId, u]));

  return entries.map((e) => {
    if (!e.discordId) return e;
    const u = byDiscordId.get(e.discordId);
    return {
      ...e,
      resolvedUserId: u ? u._id : null,
      isVerified: Boolean(u),
    };
  });
}

/**
 * Enforce the 5-minute cooldown between events by the same host.
 * Returns { allowed: boolean, retryAt: Date | null }.
 */
async function checkCooldown(hostDiscordId, cooldownMs) {
  const last = await Event.findOne({ 'host.discordId': hostDiscordId })
    .sort({ cooldownAnchor: -1 })
    .select('cooldownAnchor')
    .lean();
  if (!last) return { allowed: true, retryAt: null };
  const nextAllowed = new Date(new Date(last.cooldownAnchor).getTime() + cooldownMs);
  if (nextAllowed <= new Date()) return { allowed: true, retryAt: null };
  return { allowed: false, retryAt: nextAllowed };
}

/**
 * Fan out Attendance rows for an approved event.
 * Uses upsert + uniq_event_user for idempotency.
 */
async function writeAttendanceForEvent(event) {
  const activeEntries = event.attendeeEntries.filter((e) => e.resolvedUserId);
  if (activeEntries.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  for (const entry of activeEntries) {
    const result = await Attendance.updateOne(
      { event: event._id, user: entry.resolvedUserId },
      {
        $setOnInsert: {
          event: event._id,
          eventTypeKey: event.eventTypeKey,
          user: entry.resolvedUserId,
          discordId: entry.discordId,
          robloxId: null, // populated in Phase 9 quota evaluation if needed
          eventAt: event.createdAt ?? new Date(),
          status: 'PRESENT',
          addedBy: null,
          active: true,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount === 1) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
}

/**
 * Remove every Attendance row for an event.
 * Used by cancelEvent and updateEvent (before re-fanning out).
 */
async function clearAttendanceForEvent(eventId) {
  const result = await Attendance.deleteMany({ event: eventId });
  return result.deletedCount ?? 0;
}

// ============================================================
//  Create
// ============================================================

/**
 * Create a new event.
 *
 * Validation:
 *   - host has permission (caller's responsibility)
 *   - event type exists and is active
 *   - proof URL is present and looks like a URL
 *   - attendees are provided, and host is not among them
 *   - 5-minute cooldown has passed
 *   - approval behavior comes from Settings.events.approvalRequired
 *
 * Returns the created Event document.
 */
export async function createEvent(actorDiscordId, payload) {
  const {
    eventTypeKey,
    attendees = [],
    proofUrl,
    notes = '',
  } = payload;

  if (!eventTypeKey) throw new ValidationError('eventTypeKey is required.');
  if (!proofUrl || typeof proofUrl !== 'string') {
    throw new ValidationError('Proof URL is required.');
  }
  if (!/^https?:\/\//i.test(proofUrl.trim())) {
    throw new ValidationError('Proof URL must start with http:// or https://');
  }
  if (!Array.isArray(attendees) || attendees.length === 0) {
    throw new ValidationError('At least one attendee is required.');
  }

  const eventType = await EventType.findOne({
    key: eventTypeKey.toLowerCase(),
    active: true,
  }).lean();
  if (!eventType) throw new NotFoundError('Event type', { key: eventTypeKey });

  const settings = await getSettings();
  const approvalRequired = settings.events?.approvalRequired ?? true;
  const cooldownMs = (settings.events?.cooldownMinutes ?? 5) * 60 * 1000;

  // Cooldown check (applies regardless of approval mode).
  const { allowed, retryAt } = await checkCooldown(actorDiscordId, cooldownMs);
  if (!allowed) {
    const secs = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
    throw new ConflictError(
      `Please wait ${secs}s before logging another event.`
    );
  }

  // Host lookup (for snapshot).
  const host = await User.findOne({ discordId: actorDiscordId }).lean();

  // Normalize + resolve attendees.
  let entries = normalizeAttendees(attendees, actorDiscordId);
  entries = await resolveAttendeeUsers(entries);

  if (entries.length === 0) {
    throw new ValidationError(
      'No valid attendees after removing the host and duplicates.'
    );
  }

  const status = approvalRequired ? 'PENDING' : 'APPROVED';

  const event = await Event.create({
    host: {
      userId: host?._id ?? null,
      discordId: actorDiscordId,
      discordUsername: host?.discordUsername ?? null,
      robloxId: host?.robloxId ?? null,
      robloxUsername: host?.robloxUsername ?? null,
    },
    eventType: eventType._id,
    eventTypeKey: eventType.key,
    attendeeEntries: entries,
    proofUrl: proofUrl.trim(),
    notes: String(notes).slice(0, 2000),
    status,
    createdBy: actorDiscordId,
    cooldownAnchor: new Date(),
    ...(status === 'APPROVED'
      ? {
          approvedBy: actorDiscordId,
          approvedAt: new Date(),
        }
      : {}),
  });

  // Immediate fan-out if auto-approved.
  if (status === 'APPROVED') {
    await writeAttendanceForEvent(event);
  }

  await audit({
    actorId: actorDiscordId,
    action: status === 'APPROVED' ? 'event.created_auto_approved' : 'event.created',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event._id,
    after: {
      eventTypeKey: event.eventTypeKey,
      status,
      attendees: entries.length,
      proofUrl: event.proofUrl,
    },
  });

  logger.info(
    { eventId: event._id, host: actorDiscordId, status, attendees: entries.length },
    'Event created'
  );
  return event;
}

// ============================================================
//  Approve / Reject
// ============================================================

/**
 * Approve a PENDING event.
 * Idempotent: re-approving does nothing.
 * CAS: `findOneAndUpdate({ status: 'PENDING' }, ...)` ensures only
 * one concurrent approver performs the fan-out.
 */
export async function approveEvent(actorDiscordId, eventId) {
  const event = await Event.findOneAndUpdate(
    { _id: eventId, status: 'PENDING' },
    {
      $set: {
        status: 'APPROVED',
        approvedBy: actorDiscordId,
        approvedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!event) {
    // Either not found or not PENDING. Disambiguate for a better error.
    const existing = await Event.findById(eventId);
    if (!existing) throw new NotFoundError('Event', { id: String(eventId) });
    if (existing.status === 'APPROVED') {
      return { event: existing, alreadyApproved: true };
    }
    throw new ConflictError(`Cannot approve event with status ${existing.status}.`);
  }

  await writeAttendanceForEvent(event);

  await audit({
    actorId: actorDiscordId,
    action: 'event.approved',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event._id,
    after: { status: 'APPROVED' },
  });

  return { event, alreadyApproved: false };
}

export async function rejectEvent(actorDiscordId, eventId, { reason }) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('Rejection requires a reason.');
  }

  const event = await Event.findOneAndUpdate(
    { _id: eventId, status: 'PENDING' },
    {
      $set: {
        status: 'REJECTED',
        rejectedBy: actorDiscordId,
        rejectedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    },
    { new: true }
  );

  if (!event) {
    const existing = await Event.findById(eventId);
    if (!existing) throw new NotFoundError('Event', { id: String(eventId) });
    throw new ConflictError(`Cannot reject event with status ${existing.status}.`);
  }

  await audit({
    actorId: actorDiscordId,
    action: 'event.rejected',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event._id,
    after: { status: 'REJECTED' },
    reason,
  });

  return event;
}

// ============================================================
//  Cancel
// ============================================================

/**
 * Cancel an APPROVED event. Removes all Attendance rows for it.
 * Idempotent: cancelling an already-cancelled event is a no-op.
 * Cancelling a PENDING event is allowed (no attendance to remove).
 */
export async function cancelEvent(actorDiscordId, eventId, { reason = null } = {}) {
  const existing = await Event.findById(eventId);
  if (!existing) throw new NotFoundError('Event', { id: String(eventId) });

  if (existing.status === 'CANCELLED') return existing;
  if (existing.status === 'REJECTED') {
    throw new ConflictError('Cannot cancel a rejected event.');
  }

  const previousStatus = existing.status;

  existing.status = 'CANCELLED';
  existing.cancelledBy = actorDiscordId;
  existing.cancelledAt = new Date();
  existing.cancellationReason = reason;
  await existing.save();

  if (previousStatus === 'APPROVED') {
    await clearAttendanceForEvent(existing._id);
  }

  await audit({
    actorId: actorDiscordId,
    action: 'event.cancelled',
    category: 'EVENT',
    targetType: 'Event',
    targetId: existing._id,
    before: { status: previousStatus },
    after: { status: 'CANCELLED' },
    reason,
  });

  return existing;
}

// ============================================================
//  Update
// ============================================================

/**
 * Update an event's mutable fields.
 * Reconciles Attendance only when the attendee list changes
 * AND the event is APPROVED.
 *
 * Mutable fields:
 *   - proofUrl
 *   - notes
 *   - attendees (fully replaces attendeeEntries)
 *
 * Immutable:
 *   - host
 *   - eventTypeKey
 *   - createdAt / cooldownAnchor
 */
export async function updateEvent(actorDiscordId, eventId, patch) {
  const event = await Event.findById(eventId);
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });

  const before = {
    proofUrl: event.proofUrl,
    notes: event.notes,
    attendeeCount: event.attendeeEntries.length,
  };

  let attendeesChanged = false;

  if (patch.proofUrl !== undefined) {
    if (!/^https?:\/\//i.test(String(patch.proofUrl))) {
      throw new ValidationError('Proof URL must start with http:// or https://');
    }
    event.proofUrl = String(patch.proofUrl).trim();
  }
  if (patch.notes !== undefined) {
    event.notes = String(patch.notes).slice(0, 2000);
  }
  if (patch.attendees !== undefined) {
    if (!Array.isArray(patch.attendees) || patch.attendees.length === 0) {
      throw new ValidationError('Attendees array cannot be empty.');
    }
    let entries = normalizeAttendees(patch.attendees, event.host.discordId);
    entries = await resolveAttendeeUsers(entries);
    event.attendeeEntries = entries;
    attendeesChanged = true;
  }

  await event.save();

  if (attendeesChanged && event.status === 'APPROVED') {
    await clearAttendanceForEvent(event._id);
    await writeAttendanceForEvent(event);
  }

  await audit({
    actorId: actorDiscordId,
    action: 'event.edited',
    category: 'EVENT',
    targetType: 'Event',
    targetId: event._id,
    before,
    after: {
      proofUrl: event.proofUrl,
      notes: event.notes,
      attendeeCount: event.attendeeEntries.length,
    },
  });

  return event;
}

// ============================================================
//  Reads
// ============================================================

export async function getEvent(eventId) {
  const event = await Event.findById(eventId).lean();
  if (!event) throw new NotFoundError('Event', { id: String(eventId) });
  return event;
}

/**
 * List events with filters and pagination.
 *   status           - PENDING / APPROVED / REJECTED / CANCELLED, or 'ANY'
 *   hostDiscordId    - events hosted by a specific user
 *   eventTypeKey     - filter by type
 *   from, to         - inclusive date range on createdAt
 *   page, pageSize   - pagination
 */
export async function listEvents({
  status,
  hostDiscordId,
  eventTypeKey,
  from,
  to,
  page = 1,
  pageSize = 25,
} = {}) {
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (page - 1) * pageSize;

  const filter = {};
  if (status && status !== 'ANY') filter.status = status;
  if (hostDiscordId) filter['host.discordId'] = hostDiscordId;
  if (eventTypeKey) filter.eventTypeKey = eventTypeKey.toLowerCase();

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const [items, total] = await Promise.all([
    Event.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Event.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Latest event by a host — used by /event cooldown status.
 */
export async function getLastEventByHost(hostDiscordId) {
  return Event.findOne({ 'host.discordId': hostDiscordId })
    .sort({ cooldownAnchor: -1 })
    .lean();
}