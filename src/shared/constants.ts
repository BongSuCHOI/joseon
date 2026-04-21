import { join } from 'path';

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';

// HARNESS_DIR_ROOT override: tests can set this env var before first import
// to redirect all harness file I/O to a temp directory.
export const HARNESS_DIR = process.env.HARNESS_DIR_ROOT
    ? join(process.env.HARNESS_DIR_ROOT, 'harness')
    : join(HOME, '.config/opencode/harness');

// Cross-file shared constants
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ERROR_SUMMARY_LENGTH = 200;
