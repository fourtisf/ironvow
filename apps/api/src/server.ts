import { buildApp } from './app.js';
import { backfillMusterFields, backfillOpeningPurse } from './lib/backfill.js';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';

const app = await buildApp();
const config = env();

/*
 * Runs once, ever, across every instance. Wrapped because a database that is
 * still coming up must not stop the server from starting: the row is only
 * written on success, so the next boot tries again.
 */
try {
  await backfillOpeningPurse(app.log);
} catch (err) {
  app.log.warn({ err }, 'opening-purse backfill did not run; will retry next boot');
}

try {
  await backfillMusterFields(app.log);
} catch (err) {
  app.log.warn({ err }, 'muster-field backfill did not run; will retry next boot');
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
