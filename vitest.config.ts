import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ['tests/cli/**/*.test.ts', 'tests/aso-web/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@aso/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@aso/security': path.resolve(__dirname, 'packages/security/src/index.ts'),
      '@aso/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@aso/core': path.resolve(__dirname, 'packages/aso-core/src/index.ts'),
      '@aso/execution-protocol': path.resolve(__dirname, 'packages/execution-protocol/src/index.ts'),
      '@aso/provider-adapters': path.resolve(__dirname, 'packages/provider-adapters/src/index.ts'),
    },
  },
});
