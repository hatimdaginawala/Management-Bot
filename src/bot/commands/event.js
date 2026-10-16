// src/bot/commands/event.js
import { SlashCommandBuilder } from 'discord.js';
import { openMenuForModule } from '../menus/render.js';

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Event management.')
  .toJSON();

export const meta = {};

export async function execute(interaction, ctx) {
  return openMenuForModule(interaction, ctx, 'event');
}