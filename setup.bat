@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  Phase 1 Scaffold - 24th Guard Rifles Management Bot
REM ============================================================

set "ROOT=%~dp0"
set "PROJ=%ROOT%24th-guard-rifles-bot"

echo.
echo ============================================================
echo   Phase 1 Scaffold - 24th Guard Rifles Management Bot
echo ============================================================
echo   Target: %PROJ%
echo.

if exist "%PROJ%" (
    set /p "OVERWRITE=Folder already exists. Overwrite files? (y/N): "
    if /i not "!OVERWRITE!"=="y" (
        echo Aborted.
        pause
        exit /b 1
    )
)

echo Creating folder structure...
mkdir "%PROJ%"                              2>nul
mkdir "%PROJ%\src"                          2>nul
mkdir "%PROJ%\src\config"                   2>nul
mkdir "%PROJ%\src\bot"                      2>nul
mkdir "%PROJ%\src\bot\eventHandlers"        2>nul
mkdir "%PROJ%\src\bot\commands"             2>nul
mkdir "%PROJ%\src\routes"                   2>nul
mkdir "%PROJ%\src\controllers"              2>nul
mkdir "%PROJ%\src\services"                 2>nul
mkdir "%PROJ%\src\models"                   2>nul
mkdir "%PROJ%\src\middleware"               2>nul
mkdir "%PROJ%\src\utils"                    2>nul
mkdir "%PROJ%\src\constants"                2>nul
mkdir "%PROJ%\scripts"                      2>nul
mkdir "%PROJ%\tests"                        2>nul

REM ============================================================
REM  package.json
REM ============================================================
echo Writing package.json...
(
echo {
echo   "name": "24th-guard-rifles-bot",
echo   "version": "1.0.0",
echo   "description": "Discord-based management system for the 24th Guard Rifles Roblox group",
echo   "type": "module",
echo   "main": "src/server.js",
echo   "engines": {
echo     "node": ">=18.0.0"
echo   },
echo   "scripts": {
echo     "start": "node src/server.js",
echo     "dev": "node --watch src/server.js",
echo     "deploy:commands": "node src/bot/deployCommands.js",
echo     "test": "set NODE_ENV=test&& node --experimental-vm-modules node_modules/jest/bin/jest.js",
echo     "lint": "echo lint-not-configured"
echo   },
echo   "dependencies": {
echo     "axios": "^1.7.7",
echo     "cors": "^2.8.5",
echo     "discord.js": "^14.16.3",
echo     "dotenv": "^16.4.5",
echo     "express": "^4.21.0",
echo     "express-rate-limit": "^7.4.0",
echo     "helmet": "^8.0.0",
echo     "mongoose": "^8.7.0",
echo     "node-cron": "^3.0.3",
echo     "pino": "^9.4.0",
echo     "pino-http": "^10.3.0"
echo   },
echo   "devDependencies": {
echo     "jest": "^29.7.0",
echo     "mongodb-memory-server": "^10.0.0",
echo     "pino-pretty": "^11.2.2"
echo   }
echo }
) > "%PROJ%\package.json"

REM ============================================================
REM  .env.example
REM ============================================================
echo Writing .env.example...
(
echo # =========================================================
echo # 24th Guard Rifles Management Bot - Environment Template
echo # =========================================================
echo # Copy this file to .env and fill in real values.
echo # NEVER commit .env to source control.
echo.
echo # ---------- Runtime ----------
echo NODE_ENV=development
echo PORT=3000
echo.
echo # ---------- MongoDB ----------
echo # Local MongoDB connection string.
echo # Note: MongoDB transactions are intentionally NOT used in this project.
echo # A standalone local mongod is sufficient.
echo MONGODB_URI=mongodb://127.0.0.1:27017/guard24
echo.
echo # ---------- Discord ----------
echo DISCORD_TOKEN=your_bot_token_here
echo DISCORD_CLIENT_ID=your_application_client_id_here
echo DISCORD_GUILD_ID=1215735093902049370
echo.
echo # ---------- Roblox ----------
echo ROBLOX_GROUP_ID=10410582
echo.
echo # ---------- Timezone ----------
echo # Canonical timezone for cron scheduling and report rendering.
echo # Internal timestamps are always stored in UTC.
echo DEFAULT_TIMEZONE=Asia/Kolkata
echo.
echo # ---------- Cron Schedules ----------
echo # Roblox group sync: every 6 hours
echo ROBLOX_SYNC_CRON=0 */6 * * *
echo.
echo # Weekly quota evaluation: Sunday 23:30 IST
echo QUOTA_EVALUATION_CRON=30 23 * * 0
echo.
echo # Weekly report: Sunday 22:00 IST (16:30 UTC)
echo WEEKLY_REPORT_CRON=0 22 * * 0
echo.
echo # Leave / notice / verification expiration sweep: every 15 minutes
echo EXPIRATION_SWEEP_CRON=*/15 * * * *
echo.
echo # Removal effective-date sweep: daily at 00:05 IST
echo REMOVAL_SWEEP_CRON=5 0 * * *
echo.
echo # Cleanup job: daily at 03:00 IST
echo CLEANUP_CRON=0 3 * * *
echo.
echo # ---------- Logging ----------
echo LOG_LEVEL=info
) > "%PROJ%\.env.example"

REM ============================================================
REM  .gitignore
REM ============================================================
echo Writing .gitignore...
(
echo node_modules/
echo .env
echo .env.local
echo .env.*.local
echo logs/
echo *.log
echo coverage/
echo .DS_Store
echo dist/
echo build/
echo tmp/
echo .idea/
echo .vscode/
) > "%PROJ%\.gitignore"

REM ============================================================
REM  .dockerignore
REM ============================================================
echo Writing .dockerignore...
(
echo node_modules
echo .env
echo .env.*
echo !.env.example
echo logs
echo coverage
echo .git
echo .gitignore
echo .vscode
echo .idea
echo Dockerfile
echo docker-compose.yml
echo README.md
echo tests
) > "%PROJ%\.dockerignore"

REM ============================================================
REM  Dockerfile
REM ============================================================
echo Writing Dockerfile...
(
echo FROM node:18-alpine AS deps
echo WORKDIR /app
echo COPY package.json ./
echo RUN npm install --omit=dev --no-audit --no-fund
echo.
echo FROM node:18-alpine
echo ENV NODE_ENV=production
echo WORKDIR /app
echo RUN apk add --no-cache tini
echo COPY --from=deps /app/node_modules ./node_modules
echo COPY package.json ./
echo COPY src ./src
echo RUN addgroup -S bot ^&^& adduser -S bot -G bot ^&^& chown -R bot:bot /app
echo USER bot
echo EXPOSE 3000
echo ENTRYPOINT ["/sbin/tini", "--"]
echo CMD ["node", "src/server.js"]
) > "%PROJ%\Dockerfile"

REM ============================================================
REM  docker-compose.yml
REM ============================================================
echo Writing docker-compose.yml...
(
echo version: "3.9"
echo.
echo services:
echo   bot:
echo     build:
echo       context: .
echo       dockerfile: Dockerfile
echo     image: guard24-bot:latest
echo     container_name: guard24-bot
echo     restart: unless-stopped
echo     env_file:
echo       - .env
echo     environment:
echo       - MONGODB_URI=${MONGODB_URI:-mongodb://host.docker.internal:27017/guard24}
echo     ports:
echo       - "${PORT:-3000}:3000"
echo     extra_hosts:
echo       - "host.docker.internal:host-gateway"
echo     logging:
echo       driver: "json-file"
echo       options:
echo         max-size: "10m"
echo         max-file: "3"
) > "%PROJ%\docker-compose.yml"

REM ============================================================
REM  src/config/index.js
REM ============================================================
echo Writing src/config/index.js...
(
echo import dotenv from 'dotenv';
echo.
echo dotenv.config^(^);
echo.
echo function required^(key^) {
echo   const value = process.env[key];
echo   if ^(value === undefined ^|^| value === ''^) {
echo     throw new Error^(`Missing required environment variable: ${key}`^);
echo   }
echo   return value;
echo }
echo.
echo function optional^(key, fallback^) {
echo   const value = process.env[key];
echo   return value === undefined ^|^| value === '' ? fallback : value;
echo }
echo.
echo const config = {
echo   env: optional^('NODE_ENV', 'development'^),
echo   isProduction: optional^('NODE_ENV', 'development'^) === 'production',
echo   isTest: optional^('NODE_ENV', 'development'^) === 'test',
echo.
echo   port: parseInt^(optional^('PORT', '3000'^), 10^),
echo.
echo   mongo: {
echo     uri: required^('MONGODB_URI'^),
echo   },
echo.
echo   discord: {
echo     token: required^('DISCORD_TOKEN'^),
echo     clientId: required^('DISCORD_CLIENT_ID'^),
echo     guildId: required^('DISCORD_GUILD_ID'^),
echo   },
echo.
echo   roblox: {
echo     groupId: required^('ROBLOX_GROUP_ID'^),
echo   },
echo.
echo   timezone: optional^('DEFAULT_TIMEZONE', 'Asia/Kolkata'^),
echo.
echo   cron: {
echo     robloxSync: optional^('ROBLOX_SYNC_CRON', '0 */6 * * *'^),
echo     quotaEvaluation: optional^('QUOTA_EVALUATION_CRON', '30 23 * * 0'^),
echo     weeklyReport: optional^('WEEKLY_REPORT_CRON', '0 22 * * 0'^),
echo     expirationSweep: optional^('EXPIRATION_SWEEP_CRON', '*/15 * * * *'^),
echo     removalSweep: optional^('REMOVAL_SWEEP_CRON', '5 0 * * *'^),
echo     cleanup: optional^('CLEANUP_CRON', '0 3 * * *'^),
echo   },
echo.
echo   log: {
echo     level: optional^('LOG_LEVEL', 'info'^),
echo   },
echo };
echo.
echo export default Object.freeze^(config^);
) > "%PROJ%\src\config\index.js"

REM ============================================================
REM  src/config/logger.js
REM ============================================================
echo Writing src/config/logger.js...
(
echo import pino from 'pino';
echo import config from './index.js';
echo.
echo const redactPaths = [
echo   'req.headers.authorization',
echo   'req.headers.cookie',
echo   'DISCORD_TOKEN',
echo   'discord.token',
echo   '*.token',
echo   '*.password',
echo ];
echo.
echo const transport = config.isProduction ^|^| config.isTest
echo   ? undefined
echo   : {
echo       target: 'pino-pretty',
echo       options: {
echo         colorize: true,
echo         translateTime: 'SYS:standard',
echo         ignore: 'pid,hostname',
echo       },
echo     };
echo.
echo const logger = pino^( {
echo   level: config.log.level,
echo   redact: { paths: redactPaths, censor: '[REDACTED]' },
echo   base: { service: 'guard24-bot', env: config.env },
echo   transport,
echo }^);
echo.
echo export default logger;
) > "%PROJ%\src\config\logger.js"

REM ============================================================
REM  src/config/database.js
REM ============================================================
echo Writing src/config/database.js...
(
echo import mongoose from 'mongoose';
echo import config from './index.js';
echo import logger from './logger.js';
echo.
echo let isConnected = false;
echo.
echo export async function connectDatabase^({ retries = 5, delayMs = 2000 } = {}^) {
echo   if ^(isConnected^) return mongoose.connection;
echo.
echo   mongoose.set^('strictQuery', true^);
echo.
echo   for ^(let attempt = 1; attempt ^<= retries; attempt++^) {
echo     try {
echo       await mongoose.connect^(config.mongo.uri, {
echo         serverSelectionTimeoutMS: 10_000,
echo         socketTimeoutMS: 45_000,
echo       }^);
echo       isConnected = true;
echo       logger.info^({ uri: maskUri^(config.mongo.uri^) }, 'MongoDB connected'^);
echo       return mongoose.connection;
echo     } catch ^(err^) {
echo       logger.error^(
echo         { attempt, retries, err: err.message },
echo         'MongoDB connection failed'
echo       ^);
echo       if ^(attempt === retries^) throw err;
echo       const wait = delayMs * attempt;
echo       await new Promise^(^(r^) =^> setTimeout^(r, wait^)^);
echo     }
echo   }
echo }
echo.
echo export async function disconnectDatabase^(^) {
echo   if ^(!isConnected^) return;
echo   await mongoose.disconnect^(^);
echo   isConnected = false;
echo   logger.info^('MongoDB disconnected'^);
echo }
echo.
echo export function isDatabaseHealthy^(^) {
echo   return mongoose.connection.readyState === 1;
echo }
echo.
echo function maskUri^(uri^) {
echo   return uri.replace^(/\/\/[^@]+@/, '//***:***@'^);
echo }
) > "%PROJ%\src\config\database.js"

REM ============================================================
REM  src/config/constants.js
REM ============================================================
echo Writing src/config/constants.js...
(
echo export const APP_NAME = '24th Guard Rifles Management Bot';
echo export const APP_VERSION = '1.0.0';
echo.
echo export const USER_STATUS = Object.freeze^( {
echo   ACTIVE: 'ACTIVE',
echo   LEFT_ROBLOX_GROUP: 'LEFT_ROBLOX_GROUP',
echo   UNVERIFIED: 'UNVERIFIED',
echo   SUSPENDED: 'SUSPENDED',
echo   INACTIVE: 'INACTIVE',
echo }^);
echo.
echo export const EVENT_TYPES = Object.freeze^([
echo   'Patrol',
echo   'CT',
echo   'DT',
echo   'Raid',
echo   'Tryout',
echo   'Other',
echo ]^);
echo.
echo export const EVENT_STATUS = Object.freeze^( {
echo   PENDING: 'PENDING',
echo   APPROVED: 'APPROVED',
echo   REJECTED: 'REJECTED',
echo   CANCELLED: 'CANCELLED',
echo }^);
echo.
echo export const EVENT_COOLDOWN_MS = 5 * 60 * 1000;
echo.
echo export const QUOTA_CATEGORY = Object.freeze^( {
echo   NONE: 'NONE',
echo   STAFF: 'STAFF',
echo   LOW_RANK: 'LOW_RANK',
echo }^);
echo.
echo export const DEFAULT_ROLE_PRIORITY = Object.freeze^( {
echo   super_admin: 1000,
echo   'Supreme Command': 100,
echo   'High Command': 80,
echo   Staff: 40,
echo   'Low Rank': 10,
echo }^);
echo.
echo export const REMOVAL_MIN_ADVANCE_DAYS = 3;
) > "%PROJ%\src\config\constants.js"

REM ============================================================
REM  src/utils/errors.js
REM ============================================================
echo Writing src/utils/errors.js...
(
echo export class AppError extends Error {
echo   constructor^(message, { code, statusCode = 500, details = null, cause } = {}^) {
echo     super^(message^);
echo     this.name = this.constructor.name;
echo     this.code = code ^|^| this.constructor.name;
echo     this.statusCode = statusCode;
echo     this.details = details;
echo     this.isOperational = true;
echo     if ^(cause^) this.cause = cause;
echo     Error.captureStackTrace?.^(this, this.constructor^);
echo   }
echo }
echo.
echo export class ValidationError extends AppError {
echo   constructor^(message, details^) {
echo     super^(message, { code: 'VALIDATION_ERROR', statusCode: 400, details }^);
echo   }
echo }
echo.
echo export class AuthorizationError extends AppError {
echo   constructor^(message = 'You do not have permission to perform this action.'^) {
echo     super^(message, { code: 'AUTHORIZATION_ERROR', statusCode: 403 }^);
echo   }
echo }
echo.
echo export class AuthenticationError extends AppError {
echo   constructor^(message = 'Authentication required.'^) {
echo     super^(message, { code: 'AUTHENTICATION_ERROR', statusCode: 401 }^);
echo   }
echo }
echo.
echo export class NotFoundError extends AppError {
echo   constructor^(resource = 'Resource', details^) {
echo     super^(`${resource} not found.`, {
echo       code: 'NOT_FOUND',
echo       statusCode: 404,
echo       details,
echo     }^);
echo   }
echo }
echo.
echo export class ConflictError extends AppError {
echo   constructor^(message, details^) {
echo     super^(message, { code: 'CONFLICT', statusCode: 409, details }^);
echo   }
echo }
echo.
echo export class ExternalAPIError extends AppError {
echo   constructor^(service, message, details^) {
echo     super^(`${service} request failed: ${message}`, {
echo       code: 'EXTERNAL_API_ERROR',
echo       statusCode: 502,
echo       details,
echo     }^);
echo   }
echo }
echo.
echo export class DatabaseError extends AppError {
echo   constructor^(message, details^) {
echo     super^(message, { code: 'DATABASE_ERROR', statusCode: 500, details }^);
echo   }
echo }
echo.
echo export class RateLimitError extends AppError {
echo   constructor^(message = 'Too many requests. Please try again later.'^) {
echo     super^(message, { code: 'RATE_LIMIT', statusCode: 429 }^);
echo   }
echo }
) > "%PROJ%\src\utils\errors.js"

REM ============================================================
REM  src/utils/asyncHandler.js
REM ============================================================
echo Writing src/utils/asyncHandler.js...
(
echo export function asyncHandler^(fn^) {
echo   return function wrapped^(req, res, next^) {
echo     Promise.resolve^(fn^(req, res, next^)^).catch^(next^);
echo   };
echo }
) > "%PROJ%\src\utils\asyncHandler.js"

REM ============================================================
REM  src/middleware/requestLogger.js
REM ============================================================
echo Writing src/middleware/requestLogger.js...
(
echo import pinoHttp from 'pino-http';
echo import logger from '../config/logger.js';
echo.
echo export const requestLogger = pinoHttp^( {
echo   logger,
echo   customLogLevel: ^(req, res, err^) =^> {
echo     if ^(err ^|^| res.statusCode ^>= 500^) return 'error';
echo     if ^(res.statusCode ^>= 400^) return 'warn';
echo     return 'info';
echo   },
echo   customSuccessMessage: ^(req, res^) =^>
echo     `${req.method} ${req.url} -^> ${res.statusCode}`,
echo   serializers: {
echo     req: ^(req^) =^> ^({ method: req.method, url: req.url }^),
echo     res: ^(res^) =^> ^({ statusCode: res.statusCode }^),
echo   },
echo }^);
) > "%PROJ%\src\middleware\requestLogger.js"

REM ============================================================
REM  src/middleware/notFound.js
REM ============================================================
echo Writing src/middleware/notFound.js...
(
echo import { NotFoundError } from '../utils/errors.js';
echo.
echo export function notFound^(req, _res, next^) {
echo   next^(new NotFoundError^('Route', { method: req.method, path: req.originalUrl }^)^);
echo }
) > "%PROJ%\src\middleware\notFound.js"

REM ============================================================
REM  src/middleware/errorHandler.js
REM ============================================================
echo Writing src/middleware/errorHandler.js...
(
echo import { AppError } from '../utils/errors.js';
echo import logger from '../config/logger.js';
echo import config from '../config/index.js';
echo.
echo export function errorHandler^(err, req, res, _next^) {
echo   const isOperational = err instanceof AppError ^&^& err.isOperational;
echo   const statusCode = isOperational ? err.statusCode : 500;
echo.
echo   if ^(isOperational^) {
echo     logger.warn^(
echo       {
echo         code: err.code,
echo         statusCode,
echo         path: req.originalUrl,
echo         method: req.method,
echo         details: err.details,
echo       },
echo       err.message
echo     ^);
echo   } else {
echo     logger.error^(
echo       {
echo         err: { message: err.message, stack: err.stack, name: err.name },
echo         path: req.originalUrl,
echo         method: req.method,
echo       },
echo       'Unhandled error'
echo     ^);
echo   }
echo.
echo   const body = {
echo     success: false,
echo     error: {
echo       code: isOperational ? err.code : 'INTERNAL_ERROR',
echo       message: isOperational ? err.message : 'An unexpected error occurred.',
echo     },
echo   };
echo.
echo   if ^(isOperational ^&^& err.details^) body.error.details = err.details;
echo.
echo   if ^(!config.isProduction ^&^& isOperational^) {
echo     body.error.stack = err.stack;
echo   }
echo.
echo   res.status^(statusCode^).json^(body^);
echo }
) > "%PROJ%\src\middleware\errorHandler.js"

REM ============================================================
REM  src/routes/health.routes.js
REM ============================================================
echo Writing src/routes/health.routes.js...
(
echo import { Router } from 'express';
echo import { asyncHandler } from '../utils/asyncHandler.js';
echo import { isDatabaseHealthy } from '../db/client.js';
echo import { APP_NAME, APP_VERSION } from '../config/constants.js';
echo.
echo const router = Router^(^);
echo.
echo router.get^(
echo   '/',
echo   asyncHandler^(async ^(_req, res^) =^> {
echo     const dbOk = isDatabaseHealthy^(^);
echo     const status = dbOk ? 'ok' : 'degraded';
echo.
echo     res.status^(dbOk ? 200 : 503^).json^( {
echo       success: dbOk,
echo       status,
echo       app: { name: APP_NAME, version: APP_VERSION },
echo       uptimeSeconds: Math.round^(process.uptime^(^)^),
echo       timestamp: new Date^(^).toISOString^(^),
echo       database: { connected: dbOk },
echo     }^);
echo   }^)
echo ^);
echo.
echo export default router;
) > "%PROJ%\src\routes\health.routes.js"

REM ============================================================
REM  src/routes/index.js
REM ============================================================
echo Writing src/routes/index.js...
(
echo import { Router } from 'express';
echo import healthRoutes from './health.routes.js';
echo.
echo const router = Router^(^);
echo.
echo router.use^('/health', healthRoutes^);
echo.
echo export default router;
) > "%PROJ%\src\routes\index.js"

REM ============================================================
REM  src/controllers/health.controller.js
REM ============================================================
echo Writing src/controllers/health.controller.js...
(
echo export const healthController = Object.freeze^( {}^);
) > "%PROJ%\src\controllers\health.controller.js"

REM ============================================================
REM  src/app.js
REM ============================================================
echo Writing src/app.js...
(
echo import express from 'express';
echo import helmet from 'helmet';
echo import cors from 'cors';
echo import rateLimit from 'express-rate-limit';
echo.
echo import routes from './routes/index.js';
echo import { requestLogger } from './middleware/requestLogger.js';
echo import { notFound } from './middleware/notFound.js';
echo import { errorHandler } from './middleware/errorHandler.js';
echo.
echo export function createApp^(^) {
echo   const app = express^(^);
echo.
echo   app.set^('trust proxy', 1^);
echo.
echo   app.use^(helmet^(^)^);
echo   app.use^(
echo     cors^( {
echo       origin: true,
echo       credentials: true,
echo     }^)
echo   ^);
echo.
echo   app.use^(express.json^({ limit: '1mb' }^)^);
echo   app.use^(express.urlencoded^({ extended: true, limit: '1mb' }^)^);
echo.
echo   app.use^(
echo     rateLimit^( {
echo       windowMs: 60 * 1000,
echo       max: 120,
echo       standardHeaders: true,
echo       legacyHeaders: false,
echo       skip: ^(req^) =^> req.path === '/health',
echo     }^)
echo   ^);
echo.
echo   app.use^(requestLogger^);
echo.
echo   app.use^('/', routes^);
echo.
echo   app.use^(notFound^);
echo   app.use^(errorHandler^);
echo.
echo   return app;
echo }
) > "%PROJ%\src\app.js"

REM ============================================================
REM  src/bot/client.js
REM ============================================================
echo Writing src/bot/client.js...
(
echo import { Client, GatewayIntentBits, Partials } from 'discord.js';
echo import config from '../config/index.js';
echo import logger from '../config/logger.js';
echo.
echo export function createDiscordClient^(^) {
echo   const client = new Client^( {
echo     intents: [GatewayIntentBits.Guilds],
echo     partials: [Partials.Channel],
echo   }^);
echo.
echo   client.config = config;
echo   client.logger = logger;
echo.
echo   return client;
echo }
) > "%PROJ%\src\bot\client.js"

REM ============================================================
REM  src/bot/eventHandlers/ready.js
REM ============================================================
echo Writing src/bot/eventHandlers/ready.js...
(
echo import logger from '../../config/logger.js';
echo.
echo export const name = 'ready';
echo export const once = true;
echo.
echo export async function execute^(client^) {
echo   logger.info^(
echo     { user: client.user.tag, guilds: client.guilds.cache.size },
echo     'Discord client ready'
echo   ^);
echo }
) > "%PROJ%\src\bot\eventHandlers\ready.js"

REM ============================================================
REM  src/bot/eventHandlers/interactionCreate.js
REM ============================================================
echo Writing src/bot/eventHandlers/interactionCreate.js...
(
echo import logger from '../../config/logger.js';
echo.
echo export const name = 'interactionCreate';
echo.
echo export async function execute^(interaction^) {
echo   try {
echo     if ^(interaction.isChatInputCommand^(^)^) {
echo       logger.debug^(
echo         { command: interaction.commandName, user: interaction.user.id },
echo         'Slash command received (no handler yet)'
echo       ^);
echo       return;
echo     }
echo   } catch ^(err^) {
echo     logger.error^({ err: err.message, stack: err.stack }, 'Interaction failed'^);
echo     if ^(interaction.isRepliable^(^) ^&^& !interaction.replied^) {
echo       await interaction
echo         .reply^({ content: 'An unexpected error occurred.', ephemeral: true }^)
echo         .catch^(^(^) =^> {}^);
echo     }
echo   }
echo }
) > "%PROJ%\src\bot\eventHandlers\interactionCreate.js"

REM ============================================================
REM  src/bot/eventHandlers/error.js
REM ============================================================
echo Writing src/bot/eventHandlers/error.js...
(
echo import logger from '../../config/logger.js';
echo.
echo export const name = 'error';
echo.
echo export function execute^(err^) {
echo   logger.error^({ err: err.message, stack: err.stack }, 'Discord client error'^);
echo }
) > "%PROJ%\src\bot\eventHandlers\error.js"

REM ============================================================
REM  src/bot/eventHandlers/index.js
REM ============================================================
echo Writing src/bot/eventHandlers/index.js...
(
echo import { readdir } from 'node:fs/promises';
echo import { fileURLToPath, pathToFileURL } from 'node:url';
echo import { dirname, join } from 'node:path';
echo import logger from '../../config/logger.js';
echo.
echo const __dirname = dirname^(fileURLToPath^(import.meta.url^)^);
echo.
echo export async function loadEventHandlers^(client^) {
echo   const files = ^(await readdir^(__dirname^)^).filter^(
echo     ^(f^) =^> f.endsWith^('.js'^) ^&^& f !== 'index.js'
echo   ^);
echo.
echo   for ^(const file of files^) {
echo     const url = pathToFileURL^(join^(__dirname, file^)^).href;
echo     const mod = await import^(url^);
echo.
echo     if ^(!mod.name ^|^| typeof mod.execute !== 'function'^) {
echo       logger.warn^({ file }, 'Skipping invalid event handler module'^);
echo       continue;
echo     }
echo.
echo     if ^(mod.once^) {
echo       client.once^(mod.name, ^(...args^) =^> mod.execute^(...args^)^);
echo     } else {
echo       client.on^(mod.name, ^(...args^) =^> mod.execute^(...args^)^);
echo     }
echo.
echo     logger.debug^({ event: mod.name, file }, 'Event handler loaded'^);
echo   }
echo.
echo   logger.info^({ count: files.length }, 'Event handlers loaded'^);
echo }
) > "%PROJ%\src\bot\eventHandlers\index.js"

REM ============================================================
REM  src/bot/deployCommands.js
REM ============================================================
echo Writing src/bot/deployCommands.js...
(
echo import { REST, Routes } from 'discord.js';
echo import { readdir } from 'node:fs/promises';
echo import { fileURLToPath, pathToFileURL } from 'node:url';
echo import { dirname, join } from 'node:path';
echo.
echo import config from '../config/index.js';
echo import logger from '../config/logger.js';
echo.
echo const __dirname = dirname^(fileURLToPath^(import.meta.url^)^);
echo const COMMANDS_DIR = join^(__dirname, 'commands'^);
echo.
echo async function collectCommands^(dir^) {
echo   const commands = [];
echo   let entries;
echo   try {
echo     entries = await readdir^(dir, { withFileTypes: true }^);
echo   } catch {
echo     return commands;
echo   }
echo.
echo   for ^(const entry of entries^) {
echo     const fullPath = join^(dir, entry.name^);
echo     if ^(entry.isDirectory^(^)^) {
echo       commands.push^(...^(await collectCommands^(fullPath^)^)^);
echo     } else if ^(entry.name.endsWith^('.js'^)^) {
echo       const mod = await import^(pathToFileURL^(fullPath^).href^);
echo       if ^(mod?.data^) {
echo         commands.push^({ data: mod.data, path: fullPath }^);
echo       }
echo     }
echo   }
echo   return commands;
echo }
echo.
echo export async function deployCommands^(^) {
echo   const collected = await collectCommands^(COMMANDS_DIR^);
echo.
echo   if ^(collected.length === 0^) {
echo     logger.info^('No slash commands found. Nothing to deploy.'^);
echo     return;
echo   }
echo.
echo   const body = collected.map^(^(c^) =^> c.data^);
echo   const rest = new REST^({ version: '10' }^).setToken^(config.discord.token^);
echo.
echo   logger.info^(
echo     { count: body.length, guildId: config.discord.guildId },
echo     'Registering slash commands'
echo   ^);
echo.
echo   const data = await rest.put^(
echo     Routes.applicationGuildCommands^(
echo       config.discord.clientId,
echo       config.discord.guildId
echo     ^),
echo     { body }
echo   ^);
echo.
echo   logger.info^({ count: data.length }, 'Slash commands registered'^);
echo   return data;
echo }
echo.
echo const isDirectRun = process.argv[1] === fileURLToPath^(import.meta.url^);
echo if ^(isDirectRun^) {
echo   deployCommands^(^)
echo     .then^(^(^) =^> process.exit^(0^)^)
echo     .catch^(^(err^) =^> {
echo       logger.error^({ err: err.message, stack: err.stack }, 'Deploy failed'^);
echo       process.exit^(1^);
echo     }^);
echo }
) > "%PROJ%\src\bot\deployCommands.js"

REM ============================================================
REM  src/constants/index.js
REM ============================================================
echo Writing src/constants/index.js...
(
echo export * from '../config/constants.js';
) > "%PROJ%\src\constants\index.js"

REM ============================================================
REM  src/server.js
REM ============================================================
echo Writing src/server.js...
(
echo import http from 'node:http';
echo.
echo import config from './config/index.js';
echo import logger from './config/logger.js';
echo import { createApp } from './app.js';
echo import { connectDatabase, disconnectDatabase } from './config/database.js';
echo import { createDiscordClient } from './bot/client.js';
echo import { loadEventHandlers } from './bot/eventHandlers/index.js';
echo.
echo async function bootstrap^(^) {
echo   logger.info^({ env: config.env }, 'Starting 24th Guard Rifles Management Bot'^);
echo.
echo   await connectDatabase^(^);
echo.
echo   const app = createApp^(^);
echo   const server = http.createServer^(app^);
echo.
echo   await new Promise^(^(resolve, reject^) =^> {
echo     server.once^('error', reject^);
echo     server.listen^(config.port, ^(^) =^> {
echo       logger.info^({ port: config.port }, 'HTTP server listening'^);
echo       resolve^(^);
echo     }^);
echo   }^);
echo.
echo   const client = createDiscordClient^(^);
echo   await loadEventHandlers^(client^);
echo.
echo   client.login^(config.discord.token^).catch^(^(err^) =^> {
echo     logger.error^(
echo       { err: err.message },
echo       'Discord login failed. HTTP server remains up.'
echo     ^);
echo   }^);
echo.
echo   let shuttingDown = false;
echo   async function shutdown^(signal^) {
echo     if ^(shuttingDown^) return;
echo     shuttingDown = true;
echo     logger.info^({ signal }, 'Shutdown initiated'^);
echo.
echo     const timeout = setTimeout^(^(^) =^> {
echo       logger.error^('Forced shutdown after timeout'^);
echo       process.exit^(1^);
echo     }, 15_000^);
echo     timeout.unref^(^);
echo.
echo     try {
echo       await new Promise^(^(resolve^) =^> server.close^(resolve^)^);
echo       logger.info^('HTTP server closed'^);
echo.
echo       if ^(client.isReady^(^)^) {
echo         await client.destroy^(^);
echo         logger.info^('Discord client destroyed'^);
echo       }
echo.
echo       await disconnectDatabase^(^);
echo.
echo       clearTimeout^(timeout^);
echo       logger.info^('Shutdown complete'^);
echo       process.exit^(0^);
echo     } catch ^(err^) {
echo       logger.error^({ err: err.message }, 'Error during shutdown'^);
echo       process.exit^(1^);
echo     }
echo   }
echo.
echo   process.on^('SIGINT', ^(^) =^> shutdown^('SIGINT'^)^);
echo   process.on^('SIGTERM', ^(^) =^> shutdown^('SIGTERM'^)^);
echo   process.on^('unhandledRejection', ^(reason^) =^> {
echo     logger.error^({ reason }, 'Unhandled promise rejection'^);
echo   }^);
echo   process.on^('uncaughtException', ^(err^) =^> {
echo     logger.error^({ err: err.message, stack: err.stack }, 'Uncaught exception'^);
echo     shutdown^('uncaughtException'^);
echo   }^);
echo }
echo.
echo bootstrap^(^).catch^(^(err^) =^> {
echo   console.error^('Fatal bootstrap error:', err^);
echo   process.exit^(1^);
echo }^);
) > "%PROJ%\src\server.js"

REM ============================================================
REM  Placeholders
REM ============================================================
echo Writing placeholder files...
break > "%PROJ%\src\bot\commands\.gitkeep"
break > "%PROJ%\src\services\.gitkeep"
break > "%PROJ%\src\models\.gitkeep"
break > "%PROJ%\scripts\.gitkeep"
break > "%PROJ%\tests\.gitkeep"

REM ============================================================
REM  README.md
REM ============================================================
echo Writing README.md...
(
echo # 24th Guard Rifles Management Bot
echo.
echo Discord-based management backend for the **24th Guard Rifles** Roblox group.
echo Node.js + Express + MongoDB + Discord.js.
echo.
echo ^> Status: Phase 1 - Project Bootstrap and Infrastructure.
echo.
echo ---
echo.
echo ## Requirements
echo.
echo - Node.js ^>= 18
echo - MongoDB (standalone mongod is sufficient - no replica set required)
echo - A Discord application with a bot token
echo.
echo ## Setup
echo.
echo 1. Install dependencies:
echo.
echo        npm install
echo.
echo 2. Configure environment:
echo.
echo        copy .env.example .env
echo.
echo    Fill in MONGODB_URI, DISCORD_TOKEN, DISCORD_CLIENT_ID.
echo.
echo 3. Ensure MongoDB is running.
echo.
echo 4. Run:
echo.
echo        npm run dev
echo.
echo 5. Health check:
echo.
echo        curl http://localhost:3000/health
echo.
echo ## Scripts
echo.
echo - npm start - run bot + HTTP server
echo - npm run dev - auto-restart
echo - npm run deploy:commands - register slash commands
echo - npm test - Jest (test suites start Phase 21)
echo.
echo ## Docker (optional)
echo.
echo     docker compose up --build
echo.
echo ## Architecture
echo.
echo     Discord / HTTP
echo           v
echo     Interaction / Route Layer
echo           v
echo     Controllers / Command Handlers
echo           v
echo     Services (business logic)
echo           v
echo     Models (Mongoose)
echo           v
echo     MongoDB
echo.
echo Business logic lives in src/services. Discord commands, REST routes, and
echo scheduled jobs all call the same service layer.
echo.
echo ## Known tradeoffs
echo.
echo - No MongoDB transactions - standalone mongod cannot support them.
echo   Idempotency is enforced via unique indexes + atomic updates.
echo - Node 18 is past upstream EOL - upgrade to Node 20 when convenient.
echo - REST auth is absent in Phase 1. Phase 20 adds authentication.
) > "%PROJ%\README.md"

echo.
echo ============================================================
echo   Scaffold complete.
echo ============================================================
echo.
echo Next steps:
echo   cd "%PROJ%"
echo   npm install
echo   copy .env.example .env   ^(then edit .env^)
echo   npm run dev
echo.
pause
endlocal