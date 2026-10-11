import { Client, GatewayIntentBits, Partials } from 'discord.js';
import config from '../config/index.js';
import logger from '../config/logger.js';

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Future phases may add:
      // GatewayIntentBits.GuildMembers,
      // GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel],
  });

  client.config = config;
  client.logger = logger;

  return client;
}