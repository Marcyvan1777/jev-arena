import { defineConfig } from 'vitest/config';
// JEV_RECORD=0 keeps tests from writing fight logs into ./results.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', env: { JEV_RECORD: '0' } } });
