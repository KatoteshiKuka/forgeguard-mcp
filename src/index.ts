import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerBrainTools } from './brain/register-brain-tools.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await serveStdio(() => {
    const server = buildServer(config);
    registerBrainTools(server, config);
    return server;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[forgeguard] fatal: ${message}\n`);
  process.exitCode = 1;
});
