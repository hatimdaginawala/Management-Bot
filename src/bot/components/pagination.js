import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { withPageFooter } from '../embedBuilders.js';

/**
 * Reusable pagination component.
 *
 * Renders a single-page embed (the caller supplies a function that
 * returns the embed for a given page index) plus Prev/Next buttons.
 *
 * Usage:
 *   await paginate(interaction, {
 *     totalPages: 7,
 *     renderPage: (page) => buildEmbedForPage(page),
 *   });
 *
 * Behavior:
 *   - If totalPages <= 1, no buttons are rendered.
 *   - Buttons are disabled at boundaries.
 *   - Collector runs for 2 minutes.
 *   - Only the original user can press buttons.
 *   - Errors are swallowed silently.
 */
export async function paginate(interaction, {
  totalPages,
  renderPage,
  timeoutMs = 120_000,
} = {}) {
  if (totalPages <= 1) {
    const embed = await renderPage(1);
    return reply(interaction, { embeds: [embed] });
  }

  let page = 1;
  const build = async () => {
    const embed = await renderPage(page);
    return {
      embeds: [withPageFooter(embed, page, totalPages)],
      components: [buildRow(page, totalPages)],
    };
  };

  const initial = await reply(interaction, await build());
  if (!initial) return;

  const message = interaction.deferred || interaction.replied
    ? await interaction.fetchReply()
    : initial;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeoutMs,
  });

  collector.on('collect', async (btn) => {
    try {
      if (btn.user.id !== interaction.user.id) {
        return btn.reply({ content: 'These buttons are not for you.', ephemeral: true });
      }
      if (btn.customId === 'page:prev' && page > 1) page--;
      else if (btn.customId === 'page:next' && page < totalPages) page++;

      await btn.update(await build());
    } catch {
      // ignore
    }
  });

  collector.on('end', async () => {
    try {
      const disabledRow = buildRow(page, totalPages, true);
      await interaction.editReply({ components: [disabledRow] });
    } catch {
      // ignore
    }
  });

  return message;
}

function buildRow(page, totalPages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('page:prev')
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 1),
    new ButtonBuilder()
      .setCustomId('page:next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages)
  );
}

async function reply(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply(payload);
    }
    if (interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch {
    return null;
  }
}