import { appendFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR } from './constants.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

function getCurrentLevel(): LogLevel {
    const env = process.env.HARNESS_LOG_LEVEL?.toLowerCase();
    if (env && env in LEVEL_PRIORITY) return env as LogLevel;
    return 'info';
}

function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getCurrentLevel()];
}

const LOG_FILE = join(HARNESS_DIR, 'logs', 'harness.jsonl');

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry: Record<string, unknown> = {
        level,
        module,
        msg: message,
        ts: new Date().toISOString(),
    };
    if (data) entry.data = data;

    try {
        appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    } catch {
        // file write failure is not fatal
    }

    const prefix = `[harness:${module}] ${level.toUpperCase()}: ${message}`;
    if (data) {
        process.stderr.write(`${prefix} ${JSON.stringify(data)}\n`);
    } else {
        process.stderr.write(`${prefix}\n`);
    }
}

export const logger = {
    debug: (module: string, message: string, data?: Record<string, unknown>) => log('debug', module, message, data),
    info: (module: string, message: string, data?: Record<string, unknown>) => log('info', module, message, data),
    warn: (module: string, message: string, data?: Record<string, unknown>) => log('warn', module, message, data),
    error: (module: string, message: string, data?: Record<string, unknown>) => log('error', module, message, data),
};
