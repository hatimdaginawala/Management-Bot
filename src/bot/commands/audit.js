import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as auditService from '../../services/audit.service.js';
import * as permissionService from '../../services/permission.service.js';
import * as userRepo from '../../db/repositories/user.repository.js';
import { AuthorizationError, ValidationError } from '../../utils/errors.js';
import { infoEmbed } from '../embedBuilders.js';
import { paginate } from '../components/pagination.js';
import { formatAuditLine, renderActor, renderTarget, compactTime } from '../utils/auditFormat.js';

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('Audit log browsing.')
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View audit log entries with filters.')
      .addStringOption((opt) => opt.setName('actor').setDescription('Filter by actor Discord ID or "system"'))
      .addStringOption((opt) => opt.setName('category').setDescription('Filter by category'))
      .addStringOption((opt) => opt.setName('action').setDescription('Filter by exact action key'))
      .addStringOption((opt) => opt.setName('targettype').setDescription('Filter by target type'))
      .addStringOption((opt) => opt.setName('targetid').setDescription('Filter by target ID'))
      .addStringOption((opt) => opt.setName('from').setDescription('Start date (YYYY-MM-DD)'))
      .addStringOption((opt) => opt.setName('to').setDescription('End date (YYYY-MM-DD)'))
  )
  .addSubcommand((sub) =>
    sub
      .setName('summary')
      .setDescription('Aggregated audit log summary.')
      .addStringOption((opt) => opt.setName('from').setDescription('Start date (YYYY-MM-DD)'))
      .addStringOption((opt) => opt.setName('to').setDescription('End date (YYYY-MM-DD)'))
  )
  .addSubcommand((sub) =>
    sub
      .setName('entry')
      .setDescription('View a single audit log entry.')
      .addStringOption((opt) => opt.setName('id').setDescription('Entry ID').setRequired(true))
  )
  .toJSON();

export const meta = {};

export async function execute(interaction) {
  await assertPermission(interaction, 'audit.view');

  const sub = interaction.options.getSubcommand(true);
  switch (sub) {
    case 'view':    return handleView(interaction);
    case 'summary': return handleSummary(interaction);
    case 'entry':   return handleEntry(interaction);
    default:
      throw new Error('Unknown /audit subcommand: ' + sub);
  }
}

async function handleView(interaction) {
  const filter = {};
  const actor = interaction.options.getString('actor');
  const category = interaction.options.getString('category');
  const action = interaction.options.getString('action');
  const targetType = interaction.options.getString('targettype');
  const targetId = interaction.options.getString('targetid');
  const fromRaw = interaction.options.getString('from');
  const toRaw = interaction.options.getString('to');

  if (actor) filter.actorId = actor;
  if (category) filter.category = category.toUpperCase();
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (fromRaw) filter.from = parseDate(fromRaw, 'from');
  if (toRaw) filter.to = parseDate(toRaw + 'T23:59:59.999Z', 'to');

  const first = await auditService.queryLogs({ ...filter, page: 1, pageSize: 10 });

  if (first.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Entries', description: 'No audit log entries match those filters.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: first.totalPages,
    renderPage: async (page) => {
      const result = await auditService.queryLogs({ ...filter, page, pageSize: 10 });
      const lines = result.items.map(formatAuditLine);
      return infoEmbed({
        title: 'Audit Log (' + result.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}

async function handleSummary(interaction) {
  const fromRaw = interaction.options.getString('from');
  const toRaw = interaction.options.getString('to');

  const summary = await auditService.summarize({
    from: fromRaw ? parseDate(fromRaw, 'from') : null,
    to: toRaw ? parseDate(toRaw + 'T23:59:59.999Z', 'to') : null,
  });

  if (summary.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Activity', description: 'No audit entries in that window.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const byCategory = summary.byCategory.slice(0, 10)
    .map((c) => '**' + c.category + ':** ' + c.count).join('\n');
  const byAction = summary.byAction.slice(0, 10)
    .map((a) => '`' + a.action + '` — ' + a.count).join('\n');
  const byActor = summary.byActor.slice(0, 10)
    .map((a) => renderActor(a.actorId) + ' — ' + a.count).join('\n');

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Audit Summary',
      description: 'Total entries: **' + summary.total + '**',
      fields: [
        { name: 'By Category', value: byCategory || '_none_', inline: true },
        { name: 'Top Actions', value: byAction || '_none_', inline: false },
        { name: 'Top Actors', value: byActor || '_none_', inline: false },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEntry(interaction) {
  const id = interaction.options.getString('id', true);
  const entry = await auditService.getEntry(id);

  const fields = [
    { name: 'Actor', value: renderActor(entry.actor_id), inline: true },
    { name: 'Category', value: '`' + entry.category + '`', inline: true },
    { name: 'Action', value: '`' + entry.action + '`', inline: true },
    { name: 'Target', value: renderTarget(entry.target_type, entry.target_id), inline: false },
    { name: 'When', value: compactTime(entry.created_at), inline: false },
  ];

  if (entry.before_json) {
    fields.push({ name: 'Before', value: '```json\n' + safeJson(entry.before_json) + '\n```', inline: false });
  }
  if (entry.after_json) {
    fields.push({ name: 'After', value: '```json\n' + safeJson(entry.after_json) + '\n```', inline: false });
  }
  if (entry.reason) {
    fields.push({ name: 'Reason', value: entry.reason, inline: false });
  }

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Audit Entry `' + entry.id + '`',
      fields,
    })],
    flags: MessageFlags.Ephemeral,
  });
}

function parseDate(raw, label) {
  const iso = raw.length === 10 ? raw + 'T00:00:00.000Z' : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new ValidationError(label + ' must be a valid date.');
  return d;
}

function safeJson(obj) {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > 900 ? s.slice(0, 890) + '\n…(truncated)' : s;
  } catch {
    return '(unserializable)';
  }
}

async function assertPermission(interaction, permissionKey) {
  const user = await userRepo.findByDiscordId(interaction.user.id);
  if (!user) throw new AuthorizationError('You do not have permission to perform this action.');
  const ok = await permissionService.hasPermission(user.id, permissionKey);
  if (!ok) throw new AuthorizationError('You do not have permission to perform this action.');
}