# fix-event-files.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

New-Item -ItemType Directory -Force -Path 'src\bot\commands\event' | Out-Null
New-Item -ItemType Directory -Force -Path 'src\bot\buttons' | Out-Null
New-Item -ItemType Directory -Force -Path 'src\bot\modals' | Out-Null

function Write-File($RelativePath, $Content) {
  $full = Join-Path $PSScriptRoot $RelativePath
  $Content = $Content -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($full, $Content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "  wrote $RelativePath" -ForegroundColor DarkGray
}

# ============================================================
#  view.js
# ============================================================
Write-File 'src\bot\commands\event\view.js' @'
import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import * as attendanceService from '../../../services/attendance.service.js';
import { infoEmbed, truncate } from '../../embedBuilders.js';

export async function handleView(interaction) {
  const id = interaction.options.getString('id', true);
  const event = await eventService.getEvent(id);
  const attendanceCount = await attendanceService.countAttendanceForEvent(event._id);

  const statusEmoji = {
    PENDING: '🟡',
    APPROVED: '🟢',
    REJECTED: '🔴',
    CANCELLED: '⚫',
  }[event.status] || '⚪';

  const fields = [
    { name: 'Status', value: statusEmoji + ' `' + event.status + '`', inline: true },
    { name: 'Type', value: '`' + event.eventTypeKey + '`', inline: true },
    { name: 'Host', value: '<@' + event.host.discordId + '>', inline: true },
    { name: 'Attendees', value: String(event.attendeeEntries.length) + ' listed, ' + String(attendanceCount) + ' credited', inline: false },
    { name: 'Proof', value: truncate(event.proofUrl, 200), inline: false },
  ];

  if (event.notes) fields.push({ name: 'Notes', value: truncate(event.notes, 500), inline: false });
  if (event.rejectionReason) fields.push({ name: 'Rejection Reason', value: truncate(event.rejectionReason, 500), inline: false });
  if (event.cancellationReason) fields.push({ name: 'Cancellation Reason', value: truncate(event.cancellationReason, 500), inline: false });

  const ts = Math.floor(new Date(event.createdAt).getTime() / 1000);

  const embed = infoEmbed({
    title: 'Event `' + event._id + '`',
    description: 'Created <t:' + ts + ':R>',
    fields,
  });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
'@

# ============================================================
#  list.js
# ============================================================
Write-File 'src\bot\commands\event\list.js' @'
import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { paginate } from '../../components/pagination.js';

export async function handleList(interaction) {
  const status = interaction.options.getString('status') || 'ANY';
  const hostUser = interaction.options.getUser('host');
  const type = interaction.options.getString('type');
  const startPage = interaction.options.getInteger('page') || 1;

  const filters = {
    status,
    hostDiscordId: hostUser ? hostUser.id : undefined,
    eventTypeKey: type || undefined,
    page: startPage,
    pageSize: 10,
  };

  const result = await eventService.listEvents(filters);

  if (result.total === 0) {
    return interaction.reply({
      embeds: [infoEmbed({ title: 'No Events', description: 'No events match those filters.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await paginate(interaction, {
    totalPages: result.totalPages,
    renderPage: async (page) => {
      const pageResult = await eventService.listEvents({ ...filters, page });
      const lines = pageResult.items.map((e) => {
        const emoji = { PENDING: '🟡', APPROVED: '🟢', REJECTED: '🔴', CANCELLED: '⚫' }[e.status] || '⚪';
        const ts = Math.floor(new Date(e.createdAt).getTime() / 1000);
        return emoji + ' `' + e._id + '` — ' + e.eventTypeKey + ' — <@' + e.host.discordId + '> — <t:' + ts + ':R>';
      });
      return infoEmbed({
        title: 'Events (' + pageResult.total + ' total)',
        description: lines.join('\n'),
      });
    },
  });
}
'@

# ============================================================
#  approve.js
# ============================================================
Write-File 'src\bot\commands\event\approve.js' @'
import { MessageFlags } from 'discord.js';
import * as eventService from '../../../services/event.service.js';
import * as permissionService from '../../../services/permission.service.js';
import { successEmbed } from '../../embedBuilders.js';
import { AuthorizationError } from '../../../utils/errors.js';
import { User } from '../../../models/index.js';

export async function handleApprove(interaction) {
  await assertPermission(interaction, 'events.approve');

  const id = interaction.options.getString('id', true);

  const result = await eventService.approveEvent(interaction.user.id, id);

  if (result.alreadyApproved) {
    return interaction.reply({
      embeds: [successEmbed({
        title: 'Already Approved',
        description: 'Event `' + id + '` was already approved.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    embeds: [successEmbed({
      title: 'Event Approved',
      description: 'Event `' + id + '` is now approved and attendance has been credited.',
      fields: [
        { name: 'Host', value: '<@' + result.event.host.discordId + '>', inline: true },
        { name: 'Type', value: '`' + result.event.eventTypeKey + '`', inline: true },
        { name: 'Attendees Credited', value: String(result.event.attendeeEntries.length), inline: true },
      ],
    })],
    flags: MessageFlags.Ephemeral,
  });
}

export async function assertPermission(interaction, permissionKey) {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
  const ok = await permissionService.hasPermission(user._id, permissionKey);
  if (!ok) {
    throw new AuthorizationError('You do not have permission to perform this action.');
  }
}
'@

# ============================================================
#  reject.js
# ============================================================
Write-File 'src\bot\commands\event\reject.js' @'
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { assertPermission } from './approve.js';

export async function handleReject(interaction) {
  await assertPermission(interaction, 'events.reject');

  const id = interaction.options.getString('id', true);

  const modal = new ModalBuilder()
    .setCustomId('modal:event-reject:' + id)
    .setTitle('Reject Event');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for rejection')
    .setPlaceholder('Explain why this event is being rejected')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
'@

# ============================================================
#  cancel.js
# ============================================================
Write-File 'src\bot\commands\event\cancel.js' @'
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { assertPermission } from './approve.js';

export async function handleCancel(interaction) {
  await assertPermission(interaction, 'events.cancel');

  const id = interaction.options.getString('id', true);

  const modal = new ModalBuilder()
    .setCustomId('modal:event-cancel:' + id)
    .setTitle('Cancel Event');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}
'@

# ============================================================
#  types.js
# ============================================================
Write-File 'src\bot\commands\event\types.js' @'
import { MessageFlags } from 'discord.js';
import * as eventTypeService from '../../../services/eventType.service.js';
import { infoEmbed } from '../../embedBuilders.js';
import { assertPermission } from './approve.js';

export async function handleTypes(interaction) {
  await assertPermission(interaction, 'events.view');

  const types = await eventTypeService.listEventTypes({ includeInactive: false });

  const lines = types.map((t) => {
    const desc = t.description || 'no description';
    return '**' + t.name + '** (`' + t.key + '`) — ' + desc;
  });

  return interaction.reply({
    embeds: [infoEmbed({
      title: 'Available Event Types',
      description: lines.join('\n'),
    })],
    flags: MessageFlags.Ephemeral,
  });
}
'@

# ============================================================
#  buttons/eventApproval.js
# ============================================================
Write-File 'src\bot\buttons\eventApproval.js' @'
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import * as eventService from '../../services/event.service.js';
import * as permissionService from '../../services/permission.service.js';
import { successEmbed, errorEmbed, infoEmbed } from '../embedBuilders.js';
import { AuthorizationError } from '../../utils/errors.js';
import { User } from '../../models/index.js';
import logger from '../../config/logger.js';

export const customId = ['event:approve:*', 'event:reject:*'];

export const meta = {};

export async function execute(interaction) {
  const action = parseAction(interaction.customId);

  if (!action) {
    return interaction.reply({
      embeds: [errorEmbed({ title: 'Error', description: 'Malformed interaction.' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action.kind === 'approve') return handleApprove(interaction, action.eventId);
  if (action.kind === 'reject') return handleReject(interaction, action.eventId);
}

async function handleApprove(interaction, eventId) {
  const perm = await checkPermission(interaction.user.id, 'events.approve');
  if (!perm) {
    throw new AuthorizationError('You do not have permission to approve events.');
  }

  const result = await eventService.approveEvent(interaction.user.id, eventId);

  try {
    if (interaction.message && interaction.message.edit) {
      await interaction.message.edit({ components: [] });
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not edit approval message');
  }

  if (result.alreadyApproved) {
    return interaction.reply({
      embeds: [infoEmbed({
        title: 'Already Approved',
        description: 'Event `' + eventId + '` was already approved.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (interaction.channel && interaction.channel.send) {
      await interaction.channel.send({
        embeds: [successEmbed({
          title: 'Event Approved',
          description: 'Event `' + eventId + '` was approved by <@' + interaction.user.id + '>.',
          fields: [
            { name: 'Host', value: '<@' + result.event.host.discordId + '>', inline: true },
            { name: 'Attendees Credited', value: String(result.event.attendeeEntries.length), inline: true },
          ],
        })],
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not post public approval confirmation');
  }

  return interaction.reply({
    embeds: [successEmbed({
      title: 'Approved',
      description: 'Event `' + eventId + '` approved.',
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReject(interaction, eventId) {
  const perm = await checkPermission(interaction.user.id, 'events.reject');
  if (!perm) {
    throw new AuthorizationError('You do not have permission to reject events.');
  }

  const modal = new ModalBuilder()
    .setCustomId('modal:event-reject:' + eventId)
    .setTitle('Reject Event');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for rejection')
    .setPlaceholder('Explain why this event is being rejected')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

function parseAction(customId) {
  const m = /^event:(approve|reject):([a-f0-9]{24})$/.exec(customId);
  if (!m) return null;
  return { kind: m[1], eventId: m[2] };
}

async function checkPermission(discordId, permissionKey) {
  const user = await User.findOne({ discordId });
  if (!user) return false;
  return permissionService.hasPermission(user._id, permissionKey);
}
'@

# ============================================================
#  Verify syntax
# ============================================================
Write-Host ""
Write-Host "Verifying syntax..." -ForegroundColor Cyan

$files = @(
  'src\bot\commands\event\view.js',
  'src\bot\commands\event\list.js',
  'src\bot\commands\event\approve.js',
  'src\bot\commands\event\reject.js',
  'src\bot\commands\event\cancel.js',
  'src\bot\commands\event\types.js',
  'src\bot\buttons\eventApproval.js'
)

$ok = 0
$fail = 0
foreach ($f in $files) {
  $out = & node --check $f 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK   $f" -ForegroundColor Green
    $ok++
  } else {
    Write-Host "  FAIL $f" -ForegroundColor Red
    Write-Host $out
    $fail++
  }
}

Write-Host ""
Write-Host "Summary: $ok OK, $fail FAIL" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host ""