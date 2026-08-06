import './lib/env.js';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';

const PORT = Number(process.env.PORT ?? 3000);

const { db } = createDb();
const app = buildApp({ db, logger: true });

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`khaidee api on :${PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
