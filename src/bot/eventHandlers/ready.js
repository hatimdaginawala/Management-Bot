import logger from '../../config/logger.js';

export const name = 'clientReady';   // was 'ready' — discord.js v14.16 rename
export const once = true;

export async function execute(client) {
  logger.info(
    { user: client.user.tag, guilds: client.guilds.cache.size },
    'Discord client ready'
  );
}