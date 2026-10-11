import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as quotaPolicyService from '../../services/quotaPolicy.service.js';
import * as quotaPeriodService from '../../services/quotaPeriod.service.js';
import * as permissionService from '../../services/permission.service.js';
import { User } from '../../models/index.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed, successEmbed, warningEmbed } from '../embedBuilders.js';
import * as sessions from '../sessions.js';

export const data = new SlashCommandBuilder()
  .setName('quota')
  .setDescription('Weekly quota policies, exemptions, and status.')
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View the active quota policy for a category.')
      .addStringOption((opt) =>
        opt
          .setName('category')
          .setDescription('Quota category')
          .addChoices(
            { name: 'Staff (hosted events)', value: 'STAFF' },
            { name: 'Low Rank (attended events)', value: 'LOW_RANK' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show the current quota period and policy snapshot.')
  )
  .addSubcommand((sub) =>
    sub.setName('set').setDescription('Set the quota policy for a category.')
  )
  .addSubcommand((sub) =>
    sub.setName('exempt').setDescription('Grant a quota exemption to a user.')
  )
  .addSubcommand((sub) =>
    sub.setName('unexempt').setDescription('Revoke a quota exemption from a user.')
  )  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('Show recent weekly quota results for a user.')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Target user (default: yourself)')
      )
      .addIntegerOption((opt) =>
        opt
          .setName('limit')
          .setDescription('How many weeks (max 20)')
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'view':     return handleView(interaction);
    case 'status':   return handleStatus(interaction);
    case 'set':      return handleSet(interaction);
    case 'exempt':   return startExemptFlow(interaction);
    case 'unexempt': return startUnexemptFlow(interaction);
        case 'history':  return handleHistory(interaction);
    default:
      throw new Error('Unknown /quota subcommand: ' + sub);
  }
}

// ============================================================
//  view
// ============================================================

async function handleView(interaction) {
  await assertPermission(interaction, 'quota.view');

  const requested = interaction.options.getString('category');
  const categories = requested ? [requested] : ['STAFF', 'LOW_RANK'];

  const fields = [];
  for (const category of categories) {
    const policy = await quotaPolicyService.getActivePolicyForCategory(category);
    if (!policy) {
      fields.push({
        name: category,
        value: '_No active policy_',
        inline: false,
      });
      continue;
    }
    fields.push({
      name: category,
      value: [
        'Metric: `' + policy.metric + '`',
        'Required: **' + policy.amount + '** per ' + policy.period.toLowerCase(),
        'Recovery multiplier: `' + policy.recoveryMultiplier + 'x`',
        'Active since: <t:' + Math.floor(new Date(policy.effectiveFrom).getTime() / 1000) + ':R>',
      ].join('\n'),
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Active Quota Policies',
      description: 'Current configuration for each category.',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  status
// ============================================================

async function handleStatus(interaction) {
  await assertPermission(interaction, 'quota.view');

  const period = await quotaPeriodService.getCurrentPeriod();

  if (!period) {
    return interaction.reply({
      embeds: [warningEmbed({
        title: 'No Open Period',
        description:
          'There is no currently OPEN quota period. ' +
          'One will be created automatically at the next weekly evaluation, ' +
          'or the first time an eligible user is evaluated.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const start = Math.floor(new Date(period.startAt).getTime() / 1000);
  const end = Math.floor(new Date(period.endAt).getTime() / 1000);

  const fields = [
    { name: 'Status', value: '`' + period.status + '`', inline: true },
    { name: 'Period Key', value: '`' + period.periodKey + '`', inline: true },
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
  } else {
    fields.push({
      name: 'Policies',
      value: '_No policy snapshot was captured for this period._',
      inline: false,
    });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Quota Period Status',
      description: 'Started <t:' + start + ':R>',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  set (modal)
// ============================================================

async function handleSet(interaction) {
  await assertPermission(interaction, 'quota.manage');

  const modal = new ModalBuilder()
    .setCustomId('modal:quota-set')
    .setTitle('Set Quota Policy');

  const categoryInput = new TextInputBuilder()
    .setCustomId('category')
    .setLabel('Category')
    .setPlaceholder('STAFF or LOW_RANK')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(10);

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Required amount per week')
    .setPlaceholder('e.g. 5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3);

  const recoveryInput = new TextInputBuilder()
    .setCustomId('recoveryMultiplier')
    .setLabel('Recovery multiplier (default 2)')
    .setPlaceholder('2')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setPlaceholder('Reason for change')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(categoryInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(recoveryInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return interaction.showModal(modal);
}

// ============================================================
//  exempt (multi-step: user picker -> reason modal)
// ============================================================

async function startExemptFlow(interaction) {
  await assertPermission(interaction, 'quota.exempt');

  sessions.startSession('quota:exempt', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('quota:exempt:user')
    .setPlaceholder('Select the user to exempt')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Grant Quota Exemption — Step 1 of 2',
      description: 'Select the user you want to exempt from weekly quota.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  unexempt (single-step: user picker only)
// ============================================================

async function startUnexemptFlow(interaction) {
  await assertPermission(interaction, 'quota.exempt');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('quota:unexempt:user')
    .setPlaceholder('Select the user to unexempt')
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Revoke Quota Exemption',
      description: 'Select the user whose exemption you want to revoke.',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  helpers
// ============================================================

async function assertPermission(interaction, permissionKey) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  const ok = await permissionService.hasPermission(user._id, permissionKey);
  if (!ok) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
}

async function handleHistory(interaction) {
  await assertPermission(interaction, 'quota.view');

  const target = interaction.options.getUser('user') || interaction.user;
  const limit = interaction.options.getInteger('limit') || 8;

  const { QuotaResult } = await import('../../models/index.js');
  const { User } = await import('../../models/index.js');

  const user = await User.findOne({ discordId: target.id }).lean();
  if (!user) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'User Not Registered',
        description: '<@' + target.id + '> is not registered with the bot.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const results = await QuotaResult.find({ user: user._id })
    .sort({ evaluatedAt: -1 })
    .limit(limit)
    .lean();

  if (results.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'No Quota History',
        description: '<@' + target.id + '> has no recorded quota results.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = results.map((r) => {
    const emoji = {
      MET: '🟢',
      MISSED: '🔴',
      EXEMPT: '⚪',
      SKIPPED: '⬛',
    }[r.status] || '⚪';
    const progress = r.status === 'MET' || r.status === 'MISSED'
      ? ' (' + r.actual + '/' + r.required + ')'
      : '';
    const exempt = r.exemptReason ? ' — *' + r.exemptReason + '*' : '';
    return emoji + ' `' + r.periodKey + '` — **' + r.category + '** · ' + r.status + progress + exempt;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Quota History — ' + (target.username),
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}