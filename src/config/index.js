import dotenv from 'dotenv';

dotenv.config();

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error('Missing required environment variable: ' + key);
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

const config = {
  env: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  isTest: optional('NODE_ENV', 'development') === 'test',
  port: parseInt(optional('PORT', '3000'), 10),
  mongo: {
    uri: required('MONGODB_URI'),
  },
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
  },
  roblox: {
    groupId: required('ROBLOX_GROUP_ID'),
  },
  timezone: optional('DEFAULT_TIMEZONE', 'Asia/Kolkata'),
  cron: {
    robloxSync: optional('ROBLOX_SYNC_CRON', '0 */6 * * *'),
    quotaEvaluation: optional('QUOTA_EVALUATION_CRON', '30 23 * * 0'),
    weeklyReport: optional('WEEKLY_REPORT_CRON', '0 22 * * 0'),
    expirationSweep: optional('EXPIRATION_SWEEP_CRON', '*/15 * * * *'),
    removalSweep: optional('REMOVAL_SWEEP_CRON', '5 0 * * *'),
    cleanup: optional('CLEANUP_CRON', '0 3 * * *'),
  },
  log: {
    level: optional('LOG_LEVEL', 'info'),
  },
  api: {
    key: optional('API_KEY', null),
  },
};

export default Object.freeze(config);