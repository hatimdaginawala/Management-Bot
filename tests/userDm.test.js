import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { Settings } from '../src/models/index.js';
import { seedPermissions } from '../scripts/seedPermissions.js';
import { seedRoles } from '../scripts/seedRoles.js';
import { seedSettings } from '../scripts/seedSettings.js';
import { sendUserDm, dmNoticeCreated, dmStrikeIssued, dmRemovalRequested, dmExemptionGranted } from '../src/bot/utils/userDm.js';
import { COLORS } from '../src/bot/embedBuilders.js';

function makeMockClient() {
  const sent = [];
  return {
    users: {
      fetch: jest.fn(async (discordId) => ({
        id: discordId,
        send: jest.fn(async (payload) => {
          sent.push({ discordId, payload });
          return { id: 'msg-1' };
        }),
      })),
    },
    __sent: sent,
  };
}

beforeEach(async () => {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
});

describe('userDm — generic', () => {
  test('sends an embed with title and fields', async () => {
    const client = makeMockClient();
    await sendUserDm(client, {
      discordId: 'u1',
      title: 'Test Notification',
      color: COLORS.INFO,
      fields: [{ name: 'Foo', value: 'Bar', inline: true }],
    });
    expect(client.__sent).toHaveLength(1);
    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Test Notification');
    expect(embed.fields[0].name).toBe('Foo');
  });

  test('skips when dmAffectedUser is disabled', async () => {
    await Settings.updateOne({ key: 'global' }, { $set: { 'notifications.dmAffectedUser': false } });
    const client = makeMockClient();
    await sendUserDm(client, { discordId: 'u1', title: 'Test' });
    expect(client.__sent).toHaveLength(0);
  });

  test('does not throw when send fails', async () => {
    const failingClient = {
      users: {
        fetch: jest.fn(async () => ({
          id: 'u1',
          send: jest.fn(async () => { throw new Error('DMs closed'); }),
        })),
      },
    };
    await expect(
      sendUserDm(failingClient, { discordId: 'u1', title: 'Test' })
    ).resolves.toBeUndefined();
  });

  test('does nothing when discordId is missing', async () => {
    const client = makeMockClient();
    await sendUserDm(client, { title: 'Test' });
    expect(client.users.fetch).not.toHaveBeenCalled();
  });
});

describe('userDm — notice created', () => {
  test('formats notice DM with type and reason', async () => {
    const client = makeMockClient();
    await dmNoticeCreated(client, {
      _id: 'n1',
      discordId: 'u1',
      type: 'WARNING',
      reason: 'minor infraction',
      grantsQuotaExemption: false,
      endAt: null,
    }, { actorId: 'admin-1' });

    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Notice Issued');
    expect(embed.fields.some((f) => f.name === 'Type' && f.value.includes('WARNING'))).toBe(true);
    expect(embed.fields.some((f) => f.name === 'Issued By' && f.value === '<@admin-1>')).toBe(true);
    // No ObjectId anywhere.
    expect(JSON.stringify(embed)).not.toContain('n1');
  });
});

describe('userDm — strike issued', () => {
  test('formats strike DM with type and period', async () => {
    const client = makeMockClient();
    await dmStrikeIssued(client, {
      _id: 's1',
      discordId: 'u1',
      type: 'MANUAL',
      reason: 'insubordination',
      quotaPeriodKey: null,
      issuedAt: new Date(),
    }, { actorId: 'admin-1' });

    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Strike Issued');
    expect(embed.fields.some((f) => f.name === 'Type')).toBe(true);
    expect(embed.fields.some((f) => f.name === 'Issued By' && f.value === '<@admin-1>')).toBe(true);
    expect(JSON.stringify(embed)).not.toContain('s1');
  });
});

describe('userDm — removal requested', () => {
  test('formats threshold removal DM', async () => {
    const client = makeMockClient();
    await dmRemovalRequested(client, {
      _id: 'r1',
      discordId: 'u1',
      strikeCount: 3,
      strikeThreshold: 3,
      description: 'Automatic removal request',
    });

    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Pending Removal Created');
    expect(embed.fields.some((f) => f.name === 'Active Strikes' && f.value === '3')).toBe(true);
    expect(JSON.stringify(embed)).not.toContain('r1');
  });
});

describe('userDm — exemption granted', () => {
  test('formats exemption DM', async () => {
    const client = makeMockClient();
    await dmExemptionGranted(client, 'u1', {
      reason: 'medical',
      exemptUntil: new Date(Date.now() + 7 * 86_400_000),
      actorId: 'admin-1',
    });

    const embed = client.__sent[0].payload.embeds[0].data;
    expect(embed.title).toBe('Quota Exemption Granted');
    expect(embed.fields.some((f) => f.name === 'Reason' && f.value === 'medical')).toBe(true);
    expect(embed.fields.some((f) => f.name === 'Granted By' && f.value === '<@admin-1>')).toBe(true);
  });
});