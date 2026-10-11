import { MessageFlags } from 'discord.js';
import { loadCommands, getCommand } from '../commandLoader.js';
import { loadInteractionHandlers, findButton, findModal, findSelect } from '../interactionRouter.js';
import { guard } from '../permissionGuard.js';
import { errorEmbed } from '../embedBuilders.js';
import logger from '../../config/logger.js';

export const name = 'interactionCreate';

let booted = false;

export async function execute(interaction) {
  logger.info(
    {
      type: interaction.type,
      commandName: interaction.commandName,
      customId: interaction.customId,
      user: interaction.user?.id,
    },
    'Interaction received'
  );

  // Load commands and component handlers once, lazily.
  if (!booted) {
    booted = true;
    await loadCommands();
    await loadInteractionHandlers();
  }

  try {
    // Autocomplete FIRST — these are technically chat input but with
    // a different response mechanism, so they must be dispatched
    // before isChatInputCommand().
    if (interaction.isAutocomplete()) {
      return await handleAutocomplete(interaction);
    }
    if (interaction.isChatInputCommand()) {
      return await handleSlash(interaction);
    }
    if (interaction.isButton()) {
      return await handleButton(interaction);
    }
    if (interaction.isModalSubmit()) {
      return await handleModal(interaction);
    }
    if (
      interaction.isStringSelectMenu() ||
      interaction.isUserSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isChannelSelectMenu() ||
      interaction.isMentionableSelectMenu()
    ) {
      return await handleSelect(interaction);
    }

    logger.warn(
      {
        type: interaction.type,
        isChatInput: interaction.isChatInputCommand(),
        isButton: interaction.isButton(),
        isModal: interaction.isModalSubmit(),
        isStringSelect: interaction.isStringSelectMenu(),
        isUserSelect: interaction.isUserSelectMenu(),
      },
      'Interaction fell through dispatch chain'
    );
  } catch (err) {
    logger.error(
      {
        err: err.message,
        stack: err.stack,
        type: interaction.type,
        command: interaction.commandName,
        customId: interaction.customId,
      },
      'Interaction dispatch failed'
    );
    // Report to the audit channel (best-effort).
    if (interaction.client) {
      const { reportError } = await import('../utils/errorReporter.js');
      await reportError(interaction.client, err, {
        source: 'dispatch',
        command: interaction.commandName,
        customId: interaction.customId,
        userId: interaction.user?.id,
      });
    }
    // Only try to reply if this interaction type can be replied to.
    // Autocomplete interactions cannot be replied with embeds.
    if (!interaction.isAutocomplete()) {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [
              errorEmbed({
                title: 'Unexpected Error',
                description: 'Something went wrong handling this interaction.',
              }),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // swallow
      }
    }
  }
}

async function handleAutocomplete(interaction) {
  const command = getCommand(interaction.commandName);
  if (!command || typeof command.autocomplete !== 'function') {
    // Empty response is the correct way to say "no suggestions".
    return interaction.respond([]);
  }
  try {
    await command.autocomplete(interaction);
  } catch (err) {
    logger.error(
      {
        err: err.message,
        stack: err.stack,
        command: interaction.commandName,
        focused: interaction.options.getFocused(),
      },
      'Autocomplete failed'
    );
    // Fall back to an empty response so the user still sees the picker.
    try {
      if (!interaction.responded) await interaction.respond([]);
    } catch {
      // swallow
    }
  }
}

async function handleSlash(interaction) {
  const command = getCommand(interaction.commandName);
  if (!command) {
    return interaction.reply({
      embeds: [
        errorEmbed({
          title: 'Unknown Command',
          description: 'This command is not registered.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await guard(interaction, command.meta, async (ctx) => {
    await command.execute(interaction, ctx);
  });
}

async function handleButton(interaction) {
  const handler = findButton(interaction.customId);
  if (!handler) {
    logger.debug({ customId: interaction.customId }, 'No handler for button');
    return;
  }
  await guard(interaction, handler.meta, async (ctx) => {
    await handler.execute(interaction, ctx);
  });
}

async function handleModal(interaction) {
  const handler = findModal(interaction.customId);
  if (!handler) {
    logger.debug({ customId: interaction.customId }, 'No handler for modal');
    return;
  }
  await guard(interaction, handler.meta, async (ctx) => {
    await handler.execute(interaction, ctx);
  });
}

async function handleSelect(interaction) {
  const handler = findSelect(interaction.customId);
  if (!handler) {
    logger.warn({ customId: interaction.customId }, 'No handler for select');
    return;
  }
  await guard(interaction, handler.meta, async (ctx) => {
    await handler.execute(interaction, ctx);
  });
}