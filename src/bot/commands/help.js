import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';
import { infoEmbed, COLORS } from '../embedBuilders.js';
import { APP_NAME, APP_VERSION } from '../../config/constants.js';

/**
 * /help — single-entry command browser.
 *
 * Structure:
 *   - Base embed lists every command group with a one-line summary.
 *   - A select menu lets the user drill into one group and see each
 *     subcommand + a short description.
 *
 * Everything is static text pulled from a local catalog, so this
 * command has no DB dependency and is safe to run by anyone.
 */

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List available commands.')
  .addStringOption((opt) =>
    opt
      .setName('group')
      .setDescription('Jump directly to a command group')
      .setAutocomplete(true)
  )
  .toJSON();

export const meta = {};

// ============================================================
//  Command catalog — keep in sync with the actual commands.
//  Each group: { key, label, emoji, description, subcommands: [{ name, description }] }
// ============================================================

const GROUPS = [
  {
    key: 'auth',
    label: 'Auth',
    emoji: '🔗',
    description: 'Roblox account linking and verification.',
    subcommands: [
      { name: 'link <roblox_username>', description: 'Begin linking your Roblox account.' },
      { name: 'verify', description: 'Complete linking after placing the code in your profile.' },
      { name: 'unlink', description: 'Remove the link from your Roblox account.' },
      { name: 'status', description: 'Show your current link status.' },
      { name: 'manual <user> <roblox_username> <reason>', description: 'Force-link a user (staff only).' },
    ],
  },
  {
    key: 'event',
    label: 'Events',
    emoji: '📅',
    description: 'Log events, review submissions, and manage event history.',
    subcommands: [
      { name: 'create', description: 'Log a new event via a modal.' },
      { name: 'view', description: 'View a single event from a picker.' },
      { name: 'list', description: 'Browse events with filters and pagination.' },
      { name: 'approve', description: 'Approve a pending event.' },
      { name: 'reject', description: 'Reject a pending event with a reason.' },
      { name: 'cancel', description: 'Cancel an approved event (reverses attendance).' },
      { name: 'types', description: 'Show available event types.' },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    emoji: '🎟️',
    description: 'Attendance records and manual corrections.',
    subcommands: [
      { name: 'view [user] [page]', description: 'List a user’s attendance.' },
      { name: 'history [user] [limit]', description: 'Full attendance timeline.' },
      { name: 'stats [mode]', description: 'Aggregated attendance stats.' },
      { name: 'add', description: 'Manually add a user to an event.' },
      { name: 'remove', description: 'Manually remove a user from an event.' },
    ],
  },
  {
    key: 'quota',
    label: 'Quotas',
    emoji: '📊',
    description: 'Weekly quota policies, exemptions, and status.',
    subcommands: [
      { name: 'view [category]', description: 'Show active quota policy.' },
      { name: 'status', description: 'Show current quota period.' },
      { name: 'set', description: 'Change a quota policy.' },
      { name: 'exempt', description: 'Grant a quota exemption.' },
      { name: 'unexempt', description: 'Revoke a quota exemption.' },
    ],
  },
  {
    key: 'strike',
    label: 'Strikes',
    emoji: '⚠️',
    description: 'Strike management, recovery, and removals.',
    subcommands: [
      { name: 'view <user>', description: 'Show active strikes for a user.' },
      { name: 'history <user>', description: 'Full strike history.' },
      { name: 'issue', description: 'Issue a manual strike.' },
      { name: 'remove', description: 'Remove an active strike.' },
      { name: 'recover', description: 'Mark a strike as recovered.' },
      { name: 'pending-removals', description: 'List pending removal requests.' },
      { name: 'approve-removal', description: 'Approve a pending removal.' },
      { name: 'dismiss-removal', description: 'Dismiss a pending removal.' },
    ],
  },
  {
    key: 'leave',
    label: 'Leave',
    emoji: '🌴',
    description: 'Leave requests and approvals.',
    subcommands: [
      { name: 'create', description: 'Submit a leave request.' },
      { name: 'view [user]', description: 'View leave history.' },
      { name: 'active', description: 'List active approved leaves.' },
      { name: 'approve', description: 'Approve a pending leave.' },
      { name: 'reject', description: 'Reject a pending leave.' },
      { name: 'end', description: 'End an approved leave early.' },
      { name: 'cancel', description: 'Cancel your pending leave request.' },
    ],
  },
  {
    key: 'notice',
    label: 'Notices',
    emoji: '📌',
    description: 'Notices and inactivity records.',
    subcommands: [
      { name: 'create', description: 'Create a notice for a user.' },
      { name: 'view <user>', description: 'View a user’s active notices.' },
      { name: 'cancel', description: 'Cancel an active notice.' },
      { name: 'active', description: 'List all active notices.' },
    ],
  },
  {
    key: 'roles',
    label: 'Roles',
    emoji: '🎖️',
    description: 'Internal role management.',
    subcommands: [
      { name: 'list', description: 'List all active roles.' },
      { name: 'view <role>', description: 'Role details.' },
      { name: 'create', description: 'Create a custom role.' },
      { name: 'edit <role>', description: 'Edit a role.' },
      { name: 'delete', description: 'Delete a custom role.' },
      { name: 'assign', description: 'Assign a role to a user.' },
      { name: 'remove', description: 'Remove a role from a user.' },
      { name: 'permissions <role>', description: 'List a role’s permissions.' },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    emoji: '👥',
    description: 'Browse and filter group members.',
    subcommands: [
      { name: 'list [filters]', description: 'List members with filters.' },
      { name: 'active', description: 'Active members.' },
      { name: 'inactive', description: 'Inactive/left members.' },
      { name: 'leave', description: 'Members currently on leave.' },
      { name: 'pending-removal', description: 'Members pending removal.' },
      { name: 'rank <name>', description: 'Filter by Roblox rank.' },
      { name: 'role <key>', description: 'Filter by internal role.' },
    ],
  },
  {
    key: 'stats',
    label: 'Statistics',
    emoji: '📈',
    description: 'Group analytics and dashboards.',
    subcommands: [
      { name: 'daily / weekly / monthly', description: 'Time-window summaries.' },
      { name: 'user [user]', description: 'Per-user dashboard.' },
      { name: 'events / attendance / hosts', description: 'Domain statistics.' },
      { name: 'quota / strikes / members', description: 'Breakdowns.' },
    ],
  },
  {
    key: 'report',
    label: 'Reports',
    emoji: '📄',
    description: 'Weekly, monthly, and manual reports.',
    subcommands: [
      { name: 'weekly', description: 'Generate this week’s report.' },
      { name: 'monthly', description: 'Generate this month’s report.' },
      { name: 'generate', description: 'Manual report for a date range.' },
      { name: 'list [kind]', description: 'List stored reports.' },
      { name: 'view <reportkey>', description: 'View a stored report.' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    emoji: '⚙️',
    description: 'Bot configuration.',
    subcommands: [
      { name: 'view [group]', description: 'Show current settings.' },
      { name: 'paths', description: 'List writable paths.' },
      { name: 'set', description: 'Change a setting.' },
      { name: 'reset <path>', description: 'Reset to default.' },
    ],
  },
  {
    key: 'audit',
    label: 'Audit',
    emoji: '📜',
    description: 'Audit log browsing.',
    subcommands: [
      { name: 'view [filters]', description: 'Browse audit entries.' },
      { name: 'summary', description: 'Aggregated activity summary.' },
      { name: 'entry <id>', description: 'Single entry detail.' },
    ],
  },
  {
    key: 'sync',
    label: 'Sync',
    emoji: '🔄',
    description: 'Roblox group synchronization.',
    subcommands: [
      { name: 'roblox', description: 'Trigger a manual Roblox group sync.' },
      { name: 'status', description: 'Show the last sync result.' },
    ],
  },
  {
    key: 'utility',
    label: 'Utility',
    emoji: '🛠️',
    description: 'Small helper commands.',
    subcommands: [
      { name: 'help', description: 'Show this command browser.' },
      { name: '_ping', description: 'Check the bot is responding.' },
    ],
  },
];

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = GROUPS
    .filter((g) => g.key.includes(focused) || g.label.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((g) => ({ name: g.emoji + ' ' + g.label, value: g.key }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const requestedGroup = interaction.options.getString('group');
  const { embed, components } = renderHelp(requestedGroup);

  return interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================
//  Rendering
// ============================================================

function renderHelp(selectedGroupKey = null) {
  const selectedGroup = selectedGroupKey
    ? GROUPS.find((g) => g.key === selectedGroupKey)
    : null;

  // ----- Group-specific view -----
  if (selectedGroup) {
    const lines = selectedGroup.subcommands.map(
      (s) => '**/' + selectedGroup.key + ' ' + s.name + '**\n  _' + s.description + '_'
    );
    const embed = infoEmbed({
      title: selectedGroup.emoji + ' ' + selectedGroup.label + ' Commands',
      description: selectedGroup.description + '\n\n' + lines.join('\n'),
    });
    return { embed, components: [buildGroupMenu(selectedGroup.key)] };
  }

  // ----- Overview -----
  const fields = GROUPS.map((g) => ({
    name: g.emoji + ' ' + g.label + ' (`/' + g.key + '`)',
    value: g.description,
    inline: false,
  }));

  // Chunk into 25 fields max per embed.
  const firstChunk = fields.slice(0, 25);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(APP_NAME + ' — Command Browser')
    .setDescription(
      'Version **' + APP_VERSION + '**\n\n' +
      'Use `/help <group>` or pick from the dropdown below to see individual commands.'
    )
    .addFields(firstChunk)
    .setTimestamp(new Date());

  return { embed, components: [buildGroupMenu(null)] };
}

function buildGroupMenu(selectedKey) {
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