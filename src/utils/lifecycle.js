const { closeDb } = require('../db/connection');
const logger = require('./logger');

// Stop accepting HTTP first, then polling/schedulers, then SQLite.
async function shutdown({ server, stopBot } = {}) {
  if (!server) return;
  server.closeIdleConnections?.();
  const serverClosed = new Promise((resolve) => server.close(resolve));
  if (typeof stopBot === 'function') {
    await stopBot().catch((err) => logger.error('bot_shutdown_failed', { error: err.message }));
  }
  await serverClosed;
  closeDb();
}

module.exports = { shutdown };
