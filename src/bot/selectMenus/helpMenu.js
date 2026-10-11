import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { infoEmbed, COLORS } from '../embedBuilders.js';
import { APP_NAME, APP_VERSION } from '../../config/constants.js';

export const customId = 'help:group';
export const meta = {};

// Duplicate the group data (small enough — avoids cross-imports)
const GROUPS = [
  { key: 'auth', label: 'Auth', emoji: '🔗', description: 'Roblox account linking and verification.', subcommands: [
    { name: 'link <roblox_username>', description: 'Begin linking your Roblox account.' },
    { name: 'verify', description: 'Complete linking after placing the code in your profile.' },
    { name: 'unlink', description: 'Remove the link from your Roblox account.' },
    { name: 'status', description: 'Show your current link status.' },
    { name: 'manual <user> <roblox_username> <reason>', description: 'Force-link a user (staff only).' },
  ]},
  { key: 'event', label: 'Events', emoji: '📅', description: 'Log events, review submissions, and manage history.', subcommands: [
    { name: 'create', description: 'Log a new event.' },
    { name: 'view', description: 'View a single event.' },
    { name: 'list', description: 'Browse events with filters.' },
    { name: 'approve', description: 'Approve a pending event.' },
    { name: 'reject', description: 'Reject a pending event.' },
    { name: 'cancel', description: 'Cancel an approved event.' },
    { name: 'types', description: 'Show available event types.' },
  ]},
  { key: 'attendance', label: 'Attendance', emoji: '🎟️', description: 'Attendance records and manual corrections.', subcommands: [
    { name: 'view [user] [page]', description: 'List a user’s attendance.' },
    { name: 'history [user] [limit]', description: 'Full attendance timeline.' },
    { name: 'stats [mode]', description: 'Aggregated attendance stats.' },
    { name: 'add', description: 'Manually add a user to an event.' },
    { name: 'remove', description: 'Manually remove a user from an event.' },
  ]},
  { key: 'quota', label: 'Quotas', emoji: '📊', description: 'Weekly quota policies and exemptions.', subcommands: [
    { name: 'view [category]', description: 'Show active quota policy.' },
    { name: 'status', description: 'Show current quota period.' },
    { name: 'set', description: 'Change a quota policy.' },
    { name: 'exempt', description: 'Grant a quota exemption.' },
    { name: 'unexempt', description: 'Revoke a quota exemption.' },
  ]},
  { key: 'strike', label: 'Strikes', emoji: '⚠️', description: 'Strike management and removals.', subcommands: [
    { name: 'view <user>', description: 'Active strikes for a user.' },
    { name: 'history <user>', description: 'Full strike history.' },
    { name: 'issue', description: 'Issue a manual strike.' },
    { name: 'remove', description: 'Remove an active strike.' },
    { name: 'recover', description: 'Mark a strike as recovered.' },
    { name: 'pending-removals', description: 'List pending removals.' },
    { name: 'approve-removal', description: 'Approve a pending removal.' },
    { name: 'dismiss-removal', description: 'Dismiss a pending removal.' },
  ]},
  { key: 'leave', label: 'Leave', emoji: '🌴', description: 'Leave requests and approvals.', subcommands: [
    { name: 'create', description: 'Submit a leave request.' },
    { name: 'view [user]', description: 'View leave history.' },
    { name: 'active', description: 'List active leaves.' },
    { name: 'approve', description: 'Approve a pending leave.' },
    { name: 'reject', description: 'Reject a pending leave.' },
    { name: 'end', description: 'End an approved leave early.' },
    { name: 'cancel', description: 'Cancel your pending leave.' },
  ]},
  { key: 'notice', label: 'Notices', emoji: '📌', description: 'Notices and inactivity records.', subcommands: [
    { name: 'create', description: 'Create a notice for a user.' },
    { name: 'view <user>', description: 'View a user’s notices.' },
    { name: 'cancel', description: 'Cancel an active notice.' },
    { name: 'active', description: 'List all active notices.' },
  ]},
  { key: 'roles', label: 'Roles', emoji: '🎖️', description: 'Internal role management.', subcommands: [
    { name: 'list', description: 'List all active roles.' },
    { name: 'view <role>', description: 'Role details.' },
    { name: 'create', description: 'Create a custom role.' },
    { name: 'edit <role>', description: 'Edit a role.' },
    { name: 'delete', description: 'Delete a custom role.' },
    { name: 'assign', description: 'Assign a role to a user.' },
    { name: 'remove', description: 'Remove a role from a user.' },
    { name: 'permissions <role>', description: 'List a role’s permissions.' },
  ]},
  { key: 'members', label: 'Members', emoji: '👥', description: 'Browse and filter members.', subcommands: [
    { name: 'list [filters]', description: 'List members with filters.' },
    { name: 'active', description: 'Active members.' },
    { name: 'inactive', description: 'Inactive/left members.' },
    { name: 'leave', description: 'Members on leave.' },
    { name: 'pending-removal', description: 'Members pending removal.' },
    { name: 'rank <name>', description: 'Filter by Roblox rank.' },
    { name: 'role <key>', description: 'Filter by internal role.' },
  ]},
  { key: 'stats', label: 'Statistics', emoji: '📈', description: 'Group analytics and dashboards.', subcommands: [
    { name: 'daily / weekly / monthly', description: 'Time-window summaries.' },
    { name: 'user [user]', description: 'Per-user dashboard.' },
    { name: 'events / attendance / hosts', description: 'Domain statistics.' },
    { name: 'quota / strikes / members', description: 'Breakdowns.' },
  ]},
  { key: 'report', label: 'Reports', emoji: '📄', description: 'Weekly, monthly, manual reports.', subcommands: [
    { name: 'weekly', description: 'Generate this week’s report.' },
    { name: 'monthly', description: 'Generate this month’s report.' },
    { name: 'generate', description: 'Manual report for a range.' },
    { name: 'list [kind]', description: 'List stored reports.' },
    { name: 'view <reportkey>', description: 'View a stored report.' },
  ]},
  { key: 'settings', label: 'Settings', emoji: '⚙️', description: 'Bot configuration.', subcommands: [
    { name: 'view [group]', description: 'Show current settings.' },
    { name: 'paths', description: 'List writable paths.' },
    { name: 'set', description: 'Change a setting.' },
    { name: 'reset <path>', description: 'Reset to default.' },
  ]},
  { key: 'audit', label: 'Audit', emoji: '📜', description: 'Audit log browsing.', subcommands: [
    { name: 'view [filters]', description: 'Browse audit entries.' },
    { name: 'summary', description: 'Aggregated summary.' },
    { name: 'entry <id>', description: 'Single entry detail.' },
  ]},
  { key: 'sync', label: 'Sync', emoji: '🔄', description: 'Roblox group synchronization.', subcommands: [
    { name: 'roblox', description: 'Trigger a manual sync.' },
    { name: 'status', description: 'Show last sync result.' },
  ]},
  { key: 'utility', label: 'Utility', emoji: '🛠️', description: 'Small helper commands.', subcommands: [
    { name: 'help', description: 'Show this command browser.' },
    { name: '_ping', description: 'Check the bot is responding.' },
  ]},
];

export async function execute(interaction) {
  const value = interaction.values[0];

  if (value === '__overview__') {
    const fields = GROUPS.map((g) => ({
      name: g.emoji + ' ' + g.label + ' (`/' + g.key + '`)',
      value: g.description,
      inline: false,
    }));
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(APP_NAME + ' — Command Browser')
      .setDescription(
        'Version **' + APP_VERSION + '**\n\n' +
        'Use `/help <group>` or pick from the dropdown below to see individual commands.'
      )
      .addFields(fields.slice(0, 25))
      .setTimestamp(new Date());

    return interaction.update({ embeds: [embed], components: [buildMenu(null)] });
  }

  const group = GROUPS.find((g) => g.key === value);
  if (!group) {
    return interaction.update({
      embeds: [infoEmbed({ title: 'Unknown Group', description: 'That group was not found.' })],
      components: [buildMenu(null)],
    });
  }

  const lines = group.subcommands.map(
    (s) => '**/' + group.key + ' ' + s.name + '**\n  _' + s.description + '_'
  );
  const embed = infoEmbed({
    title: group.emoji + ' ' + group.label + ' Commands',
    description: group.description + '\n\n' + lines.join('\n'),
  });
  return interaction.update({ embeds: [embed], components: [buildMenu(group.key)] });
}

function buildMenu(selectedKey) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:group')
    .setPlaceholder(selectedKey ? 'Back to overview' : 'View a group')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      {
        label: 'Overview (all groups)',
        value: '__overview__',
        description: 'Show every command group',
        default: !selectedKey,
      },
      ...GROUPS.map((g) => ({
        label: (g.emoji + ' ' + g.label).slice(0, 100),
        value: g.key,
        description: g.description.slice(0, 100),
        default: g.key === selectedKey,
      })),
    ]);
  return new ActionRowBuilder().addComponents(menu);
}