import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { config, hasApiKey } from './config.js';

const app = createApp();
const clientDir = fileURLToPath(new URL('../../../client/', import.meta.url));
if (existsSync(`${clientDir}/index.html`) && import.meta.url.includes('/dist/')) {
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(`${clientDir}/index.html`));
}
app.listen(config.port, '127.0.0.1', () => {
  console.log(`JEV ARENA backend: http://127.0.0.1:${config.port} · Jev ${hasApiKey() ? 'configured' : 'key missing'}`);
});
