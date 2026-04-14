// src/orchestrator/subagent-depth.ts — 서브에이전트 깊이 추적
import { logger } from '../shared/logger.js';

export class SubagentDepthTracker {
    private depths: Map<string, number> = new Map();
    private _maxDepth: number;

    constructor(maxDepth: number = 3) {
        this._maxDepth = maxDepth;
    }

    get maxDepth(): number {
        return this._maxDepth;
    }

    getDepth(sessionID: string): number {
        return this.depths.get(sessionID) ?? 0;
    }

    registerChild(parentSessionID: string, childSessionID: string): boolean {
        const parentDepth = this.depths.get(parentSessionID) ?? 0;
        const childDepth = parentDepth + 1;

        if (childDepth > this._maxDepth) {
            logger.warn('subagent-depth', 'Max subagent depth exceeded', {
                parentSessionID,
                childSessionID,
                childDepth,
                maxDepth: this._maxDepth,
            });
            return false;
        }

        this.depths.set(childSessionID, childDepth);
        return true;
    }

    cleanup(sessionID: string): void {
        this.depths.delete(sessionID);
    }

    cleanupAll(): void {
        this.depths.clear();
    }
}
