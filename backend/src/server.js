import { createApp } from './app.js';
import { config } from './shared/config/index.js';

/**
 * Entry point only: builds the app (see app.js for all the wiring) and
 * starts listening. Keeping this separate from app.js means the whole HTTP
 * app can be imported and exercised (e.g. with supertest) without ever
 * binding a real port.
 */
const app = createApp();

app.listen(config.port, () => {
  console.log(`CogniFlow API running on http://localhost:${config.port}`);
});
