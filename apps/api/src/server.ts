import './lib/env.js';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { validateProductionConfig } from './lib/config.js';
import {
  createErrorReporter,
  installProcessErrorHandlers,
} from './lib/errorReporter.js';
import { createApiLoggerOptions } from './lib/logging.js';

const PORT = Number(process.env.PORT ?? 3000);

const config = validateProductionConfig();
const errorReporter = createErrorReporter(process.env, console);
installProcessErrorHandlers(errorReporter);

const { db } = createDb(config.databaseUrl, {
  logger: console,
  slowQueryMs: config.slowQueryMs,
});
const app = buildApp({
  db,
  logger: createApiLoggerOptions(),
  errorReporter,
  rateLimit: config.edgeRateLimit,
});

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`khaidee api on :${PORT}`);
  })
  .catch((error) => {
    errorReporter.capture(error, { source: 'startup' });
    app.log.error(error);
    process.exit(1);
  });
