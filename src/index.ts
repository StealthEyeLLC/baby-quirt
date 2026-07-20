/** Baby Quirt daemon entry point. */

import { loadRuntimeConfig } from './config.js';
import { BabyQuirtServer } from './server.js';

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const server = new BabyQuirtServer(config);

  const shutdown = async (signal: string) => {
    console.log(`[baby-quirt] received ${signal}, shutting down`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.start();
}

main().catch((err) => {
  console.error('[baby-quirt] fatal:', err);
  process.exit(1);
});
