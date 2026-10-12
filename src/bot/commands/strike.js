import {
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import * as strikeService from '../../services/strike.service.js';
import * as removalRequestService from '../../services/removalRequest.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import * as sessions from '../sessions.js';
import { resolveUsernames, formatRelative, truncatePlain } from '../utils/format.js';

export const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Strike management, recovery, and removal requests.')
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('Show active strikes for a user.')
      .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('history').setDescription('Full strike history for a user.')
      .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption((opt) => opt.setName('limit').setDescription('How many records (max 100)').setMinValue(1).setMaxValue(100))
  )
  .addSubcommand((sub) => sub.setName('issue').setDescription('Issue a manual strike to a user.'))
  .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an active strike.'))
  .addSubcommand((sub) => sub.setName('recover').setDescription('Mark an active strike as recovered.'))
  .addSubcommand((sub) => sub.setName('pending-removals').setDescription('List pending removal requests.'))
  .addSubcommand((sub) => sub.setName('approve-removal').setDescription('Approve a pending removal request.'))
  .addSubcommand((sub) => sub.setName('dismiss-removal').setDescription('Dismiss a pending removal request.'))
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'view':              return handleView(interaction);
    case 'history':           return handleHistory(interaction);
    case 'issue':             return startIssueFlow(interaction);
    case 'remove':            return startRemoveFlow(interaction);
    case 'recover':           return startRecoverFlow(interaction);
    case 'pending-removals':  return handlePendingRemovals(interaction);
    case 'approve-removal':   return startApproveRemovalFlow(interaction);
    case 'dismiss-removal':   return startDismissRemovalFlow(interaction);
    default:
      throw new Error('Unknown /strike subcommand: ' + sub);
  }
}

async function handleView(interaction) {
  await assertPermission(interaction, 'strikes.view');
  const target = interaction.options.getUser('user', true);
  const active = await strikeService.getActiveStrikes(target.id);

  if (active.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Active Strikes', description: '<@' + target.id + '> has no active strikes.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = active.map((s) => {
    const ts = Math.floor(new Date(s.issued_at).getTime() / 1000);
    const period = s.quota_period_key ? ' — ' + s.quota_period_key : '';
    return '• `' + s.type + '`' + period + ' — <t:' + ts + ':R> — ' + s.reason;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Active Strikes for ' + target.username,
      description: lines.join('\n'),
      fields: [{ name: 'Total Active', value: String(active.length), inline: true }],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHistory(interaction) {
  await assertPermission(interaction, 'strikes.view');
  const target = interaction.options.getUser('user', true);
  const limit = interaction.options.getInteger('limit') || 50;
  const all = await strikeService.getStrikeHistory(target.id, { limit });

  if (all.length === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Strike History', description: '<@' + target.id + '> has no strike history.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = all.map((s) => {
    const ts = Math.floor(new Date(s.issued_at).getTime() / 1000);
    const emoji = { ACTIVE: '🟡', RECOVERED: '🟢', CANCELLED: '⚫', EXPIRED: '⚪' }[s.status] || '⚪';
    const period = s.quota_period_key ? ' — ' + s.quota_period_key : '';
    return emoji + ' `' + s.type + '`' + period + ' — <t:' + ts + ':R>';
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Strike History for ' + target.username,
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function startIssueFlow(interaction) {
  await assertPermission(interaction, 'strikes.issue');

  sessions.startSession('strike:issue', interaction.user.id, { step: 'user' });

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:issue:user')
    .setPlaceholder('Select the user to strike')
    .setMinValues(1).setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({ title: 'Issue Strike — Step 1 of 2', description: 'Select the Discord user you want to issue a strike to.' })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRemoveFlow(interaction) {
  await assertPermission(interaction, 'strikes.remove');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:remove:user')
    .setPlaceholder('Select the user whose strike you want to remove')
    .setMinValues(1).setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({ title: 'Remove Strike — Step 1 of 2', description: 'Select the user.' })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function startRecoverFlow(interaction) {
  await assertPermission(interaction, 'strikes.remove');

  const menu = new UserSelectMenuBuilder()
    .setCustomId('strike:recover:user')
    .setPlaceholder('Select the user whose strike you want to recover')
    .setMinValues(1).setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({ title: 'Recover Strike — Step 1 of 2', description: 'Select the user.' })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePendingRemovals(interaction) {
  await assertPermission(interaction, 'removal.view');

  const result = await removalRequestService.listPendingRemovals({ page: 1, pageSize: 10 });

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Pending Removals', description: 'There are no pending removal requests.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await removalRequestService.listPendingRemovals({ page, pageSize: 10 });
      const lines = pageResult.items.map((r) => {
        const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
        return '• <@' + r.discord_id + '> — ' + r.reason +
               ' — strikes: ' + r.strike_count + '/' + r.strike_threshold +
               ' — <t:' + ts + ':R>';
      });
      return infoEmbed({
        title: 'Pending Removal Requests (' + pageResult.total + ')',
        description: lines.join('\n'),
      });
    },
  });
}

async function startApproveRemovalFlow(interaction) {
  await assertPermission(interaction, 'removal.approve');
  return showRemovalPicker(interaction, 'removal:approve:request', 'Approve Removal');
}

async function startDismissRemovalFlow(interaction) {
  await assertPermission(interaction, 'removal.dismiss');
  return showRemovalPicker(interaction, 'removal:dismiss:request', 'Dismiss Removal');
}

async function showRemovalPicker(interaction, customId, title) {
  const pending = await removalRequestService.listPendingRemovals({ page: 1, pageSize: 25 });

  if (pending.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Pending Removals', description: 'There are no pending removal requests.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const usernames = await resolveUsernames(
    interaction.client,
    pending.items.map((r) => r.discord_id)
  );

  const options = pending.items.map((r) => {
    const username = usernames.get(r.discord_id) || 'unknown user';
    const reason = r.description || r.reason || 'no reason';
    const ageAgo = formatRelative(r.created_at);

    const label = truncatePlain('@' + username, 100);
    const description = truncatePlain(
      r.strike_count + '/' + r.strike_threshold + ' strikes · ' + ageAgo + ' · ' + reason,
      100
    );

    return { label, description, value: String(r.id) };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a pending removal')
    .setMinValues(1).setMaxValues(1).addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    embeds: [infoEmbed({
      title,
      description: '**' + pending.total + '** pending removal request(s).',
    })],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}