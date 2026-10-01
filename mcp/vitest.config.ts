import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // Contracts come from the server's vendored shared copy (as reviewer-core).
      {
        find: '@devdigest/shared',
        replacement: path.resolve(__dirname, '../server/src/vendor/shared'),
      },
      // One zod instance: without this, the shared files would resolve `zod`
      // from server/node_modules when it exists. The regex leaves the SDK's
      // `zod/v3` and `zod/v4` imports to zod's own exports map.
      { find: /^zod$/, replacement: path.resolve(__dirname, 'node_modules/zod') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
