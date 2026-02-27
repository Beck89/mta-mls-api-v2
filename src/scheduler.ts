/**
 * In-process scheduler for background maintenance tasks.
 * 
 * Tasks:
 *   - refresh-suggestions: Rebuilds the search_suggestions typeahead table
 *     every 6 hours to reflect new/expired listings.
 * 
 * Uses setInterval — no external dependencies required.
 * Runs the first refresh shortly after startup (5 min delay) to avoid
 * hammering the DB during the initial boot sequence.
 */

import { FastifyBaseLogger } from 'fastify';
import { refreshSuggestions } from './db/refresh-suggestions.js';

// How often to refresh suggestions (default: 30 minutes)
// The refresh takes ~30-60s, so running every 10 min would mean near-continuous rebuilds.
// 30 min keeps typeahead fresh within one replication cycle lag.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// Delay before the first run after startup (2 minutes)
// Gives the server time to fully boot and warm up before hitting the DB
const INITIAL_DELAY_MS = 2 * 60 * 1000;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let initialDelayTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

async function runRefreshSuggestions(logger: FastifyBaseLogger) {
  if (isRunning) {
    logger.warn('scheduler: refresh-suggestions already running, skipping this cycle');
    return;
  }

  isRunning = true;
  const start = Date.now();
  logger.info('scheduler: starting refresh-suggestions...');

  try {
    await refreshSuggestions();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.info(`scheduler: refresh-suggestions completed in ${elapsed}s`);
  } catch (err) {
    logger.error(err, 'scheduler: refresh-suggestions failed');
  } finally {
    isRunning = false;
  }
}

export function startScheduler(logger: FastifyBaseLogger) {
  logger.info(
    `scheduler: refresh-suggestions will run in ${INITIAL_DELAY_MS / 60000} min, then every ${REFRESH_INTERVAL_MS / 60000} min`
  );

  // Initial delayed run — avoids running at the exact moment of startup
  initialDelayTimer = setTimeout(async () => {
    await runRefreshSuggestions(logger);

    // Then run on the regular interval
    refreshTimer = setInterval(() => {
      runRefreshSuggestions(logger);
    }, REFRESH_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}

export function stopScheduler() {
  if (initialDelayTimer) {
    clearTimeout(initialDelayTimer);
    initialDelayTimer = null;
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
