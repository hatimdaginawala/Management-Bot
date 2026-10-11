import pino from 'pino';
import config from './index.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'DISCORD_TOKEN',
  'discord.token',
  '*.token',
  '*.password',
];

const transport = config.isProduction || config.isTest
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };

const logger = pino({
 level: config.isTest ? 'silent' : config.log.level,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'guard24-bot', env: config.env },
  transport,
});

export default logger;