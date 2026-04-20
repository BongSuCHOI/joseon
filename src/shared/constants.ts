import { join } from 'path';

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';

export const HARNESS_DIR = join(HOME, '.config/opencode/harness');

// Cross-file shared constants
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ERROR_SUMMARY_LENGTH = 200;
