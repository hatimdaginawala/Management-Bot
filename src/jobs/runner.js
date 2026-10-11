import cron from 'node-cron';
import config from '../config/index.js';
import logger from '../config/logger.js';
import * as robloxSyncJob from './robloxSync.job.js';
import * as quotaEvaluationJob from './quotaEvaluation.job.js';
import * as weeklyReportJob from './weeklyReport.job.js';
import * as expirationJob from './expiration.job.js';
import * as removalSweepJob from './removalSweep.job.js';
import * as cleanupJob from './cleanup.job.js';

/**
 * Job runner.
 *
 * Registers cron tasks and exposes a controlled interface for:
 *   - starting the scheduler (called from server.js bootstrap)
 *   - stopping the scheduler (called on graceful shutdown)
 *   - running a job manually (used by /sync roblox, /report generate)
 *
 * Every job execution is wrapped in try/catch so an uncaught rejection
 * inside a job cannot take down the process.
 *
 * Only one instance of each job may run at a time. Overlapping triggers
 * are skipped with a warning.
 */

const running = new Set(); // names of jobs currently executing
const scheduledTasks = new Map(); // name -> cron task
let schedulerStarted = false;

/**
 * Registered jobs. Schedule values come from config (`env`), so
 * operators can change frequency without touching code.
 *
 * `needsClient` marks jobs that require a Discord client passed to run().
 */
const JOB_REGISTRY = [
  {
    name: robloxSyncJob.name,
    schedule: config.cron.robloxSync,
    needsClient: false,
    run: (ctx) => robloxSyncJob.run(ctx),
  },
  {
    name: quotaEvaluationJob.name,
    schedule: config.cron.quotaEvaluation,
    needsClient: true,
    run: (ctx) => quotaEvaluationJob.run(ctx),
  },
  {
    name: weeklyReportJob.name,
    schedule: config.cron.weeklyReport,
    needsClient: true,
    run: (ctx) => weeklyReportJob.run(ctx),
  },
  {
    name: expirationJob.name,
    schedule: config.cron.expirationSweep,
    needsClient: true,   // ← was false
    run: (ctx) => expirationJob.run(ctx),
  },
  {
    name: removalSweepJob.name,
    schedule: config.cron.removalSweep,
    needsClient: true,
    run: (ctx) => removalSweepJob.run(ctx),
  },
  {
    name: cleanupJob.name,
    schedule: config.cron.cleanup,
    needsClient: false,
    run: (ctx) => cleanupJob.run(ctx),
  },
];

/**
 * Start the scheduler.
 * @param {object} opts
 * @param {import('discord.js').Client} [opts.client]  Discord client
 *   that will be passed to jobs whose `needsClient` is true.
 */
export function startScheduler({ client = null } = {}) {
  if (schedulerStarted) {
    logger.warn('Scheduler already started — ignoring');
    return;
  }
  schedulerStarted = true;

  for (const job of JOB_REGISTRY) {
    if (!cron.validate(job.schedule)) {
      logger.error(
        { job: job.name, schedule: job.schedule },
        'Invalid cron expression — job not registered'
      );
      continue;
    }

    const task = cron.schedule(
      job.schedule,
      () => executeJob(job, { client, triggeredBy: 'system' }),
      {
        scheduled: true,
        timezone: config.timezone,
      }
    );

    scheduledTasks.set(job.name, task);
    logger.info(
      { job: job.name, schedule: job.schedule, timezone: config.timezone },
      'Job registered'
    );
  }

  logger.info({ count: scheduledTasks.size }, 'Scheduler started');
}

/**
 * Stop all scheduled jobs. Called during graceful shutdown.
 */
export function stopScheduler() {
  if (!schedulerStarted) return;
  for (const [name, task] of scheduledTasks.entries()) {
    try {
      task.stop();
      logger.debug({ job: name }, 'Job stopped');
    } catch (err) {
      logger.warn({ job: name, err: err.message }, 'Failed to stop job');
    }
  }
  scheduledTasks.clear();
  schedulerStarted = false;
  logger.info('Scheduler stopped');
}

/**
 * Execute a job by name. Used by `runJobByName` and cron.
 * Wrapped in try/catch and a running-set check.
 */
async function executeJob(job, context) {
  if (running.has(job.name)) {
    logger.warn({ job: job.name }, 'Job already running — skipping trigger');
    return { skipped: true, reason: 'already-running' };
  }
  running.add(job.name);

  const startedAt = Date.now();
  try {
    logger.info({ job: job.name }, 'Job starting');
    const result = await job.run(context);
    const ms = Date.now() - startedAt;
    logger.info({ job: job.name, ms }, 'Job completed');
    return result;
    } catch (err) {
    logger.error(
      { job: job.name, err: err.message, stack: err.stack },
      'Job failed'
    );

    // Report to the audit channel (best-effort).
    if (context.client) {
      const { reportError } = await import('../utils/errorReporter.js');
      await reportError(context.client, err, {
        source: 'job',
        job: job.name,
      });
    }

    return { error: err.message };
  } finally {
    running.delete(job.name);
  }
}

/**
 * Run a job on demand by name. Used by manual commands.
 *
 * Returns { started: true } immediately — the job runs in the
 * background, and callers should poll for results via service APIs.
 *
 * Rationale: `/sync roblox` should not block the interaction for
 * potentially 30+ seconds. The service-layer SyncLog provides status.
 */
export function runJobByName(name, context = {}) {
  const job = JOB_REGISTRY.find((j) => j.name === name);
  if (!job) {
    throw new Error(`Unknown job: ${name}`);
  }
  // Fire and forget — errors are logged inside executeJob.
  // eslint-disable-next-line no-floating-promises
  executeJob(job, context);
  return { started: true, name };
}

/**
 * Synchronous variant for tests: awaits the job and returns the result.
 * Also usable by server-side scripts that need a guaranteed-complete run.
 */
export async function runJobSync(name, context = {}) {
  const job = JOB_REGISTRY.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return executeJob(job, context);
}

/** Test-only: list the registry names. */
export function listRegisteredJobs() {
  return JOB_REGISTRY.map((j) => ({
    name: j.name,
    schedule: j.schedule,
    needsClient: j.needsClient,
  }));
}