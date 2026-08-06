import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * Every test file truncates and re-seeds the same Postgres, so running
     * files in parallel has them pulling the database out from under each
     * other. The suite is a few seconds either way; correctness is not
     * negotiable.
     */
    fileParallelism: false,
  },
});
