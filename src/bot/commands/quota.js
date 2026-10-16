// src/bot/commands/quota.js

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as quotaPolicyService from '../../services/quotaPolicy.service.js';
import * as quotaPeriodService from '../../services/quotaPeriod.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import * as quotaResultRepo from '../../db/repositories/quotaResult.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, warningEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';
import { openMenuForModule, replyOrUpdate } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('quota')
  .setDescription('Weekly quota policies, exemptions, and status.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'quota');
}

async function handleView(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'quota.view');

  const requested = params.category ?? interaction.options?.getString?.('category');
  const categories = requested ? [requested] : ['STAFF', 'LOW_RANK'];

  const fields = [];
  for (const category of categories) {
    const policy = await quotaPolicyService.getActivePolicyForCategory(category);
    if (!policy) {
      fields.push({ name: category, value: '_No active policy_', inline: false });
      continue;
    }
    fields.push({
      name: category,
      value: [
        'Metric: `' + policy.metric + '`',
        'Required: **' + policy.amount + '** per ' + policy.period_kind.toLowerCase(),
        'Recovery multiplier: `' + policy.recovery_multiplier + 'x`',
        'Active since: <t:' + Math.floor(new Date(policy.effective_from).getTime() / 1000) + ':R>',
      ].join('\n'),
      inline: false,
    });
  }

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Active Quota Policies',
      description: 'Current configuration for each category.',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(interaction, ctx) {
  await assertPermission(interaction, 'quota.view');

  const period = await quotaPeriodService.getCurrentPeriod();
  if (!period) {
    return replyOrUpdate(interaction, {
      embeds: [warningEmbed({
        title: 'No Open Period',
        description: 'There is no currently OPEN quota period.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const start = Math.floor(new Date(period.start_at).getTime() / 1000);
  const end = Math.floor(new Date(period.end_at).getTime() / 1000);

  const fields = [
    { name: 'Status', value: '`' + period.status + '`', inline: true },
    { name: 'Period Key', value: '`' + period.period_key + '`', inline: true },
    { name: 'Ends', value: '<t:' + end + ':R>', inline: true },
  ];

  if (Array.isArray(period.policies) && period.policies.length > 0) {
    for (const p of period.policies) {
      fields.push({
        name: p.category + ' policy',
        value: [
          'Metric: `' + p.metric + '`',
          'Required: **' + p.amount + '**',
          'Recovery: `' + p.recoveryMultiplier + 'x`',
        ].join('\n'),
        inline: true,
      });
    }
  }

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Quota Period Status',
      description: 'Started <t:' + start + ':R>',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHistory(interaction, ctx, params = {}) {
  await assertPermission(interaction, 'quota.view');

  const target = params.user ?? interaction.options?.getUser?.('user') ?? interaction.user;
  const limit = params.limit ?? interaction.options?.getInteger?.('limit') ?? 8;

  const user = await userRepo.findByDiscordId(target.id);
  if (!user) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'User Not Registered',
        description: '<@' + target.id + '> is not registered.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const results = await quotaResultRepo.recentForUser(user.id, { limit });
  if (results.length === 0) {
    return replyOrUpdate(interaction, {
      embeds: [infoEmbed({
        title: 'No Quota History',
        description: '<@' + target.id + '> has no recorded quota results.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = results.map((r) => {
    const emoji = { MET: '🟢', MISSED: '🔴', EXEMPT: '⚪', SKIPPED: '⬛' }[r.status] || '⚪';
    const progress = (r.status === 'MET' || r.status === 'MISSED')
      ? ' (' + r.actual_amount + '/' + r.required_amount + ')'
      : '';
    const exempt = r.exempt_reason ? ' — *' + r.exempt_reason + '*' : '';
    return emoji + ' `' + r.period_key + '` — **' + r.category + '** · ' + r.status + progress + exempt;
  });

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Quota History — ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startExemptFlow(interaction, ctx) {
  await assertPermission(interaction, 'quota.exempt');
  sessions.startSession('quota:exempt', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('quota:exempt:user')
    .setPlaceholder('Select the user to exempt')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Grant Quota Exemption — Step 1 of 2',
      description: 'Select the user you want to exempt from weekly quota.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function startUnexemptFlow(interaction, ctx) {
  await assertPermission(interaction, 'quota.exempt');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('quota:unexempt:user')
    .setPlaceholder('Select the user to unexempt')
    .setMinValues(1).setMaxValues(1);

  return replyOrUpdate(interaction, {
    embeds: [infoEmbed({
      title: 'Revoke Quota Exemption',
      description: 'Select the user whose exemption you want to revoke.',
    })],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}

export const HANDLERS = {
  view: handleView,
  status: handleStatus,
  history: handleHistory,
  exempt: startExemptFlow,
  unexempt: startUnexemptFlow,
};