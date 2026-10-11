import logger from '../../config/logger.js';

export const name = 'error';

export function execute(err) {
  logger.error({ err: err.message, stack: err.stack }, 'Discord client error');
}