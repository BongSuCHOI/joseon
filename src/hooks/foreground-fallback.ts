import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { HARNESS_DIR, getProjectKey, readJsonFile, MAX_ERROR_SUMMARY_LENGTH } from '../shared/index.js';

type AgentSessionInfo = {
    agent: string;
    chain: string[];
};

type SessionPromptContext = {
    sessionID: string;
    agent: string;
    model?: unknown;
    provider?: unknown;
    message?: unknown;
};

    type ForegroundFallbackSessionState = AgentSessionInfo & {
    currentModel?: string;
    lastPrompt?: SessionPromptContext;
    lastFailureKey?: string;
};

type ForegroundFallbackAgentState = {
    cursor: number;
    updated_at: string;
    last_session_id?: string;
    last_failure?: string;
};

type ForegroundFallbackFile = {
    agents: Record<string, ForegroundFallbackAgentState>;
};

type HookContext = {
    worktree: string;
    agentsByName: Record<string, { _fallbackChain?: string[]; config: { model?: string } }>;
    fallbackEnabled: boolean;
    client?: unknown;
};

const RETRYABLE_MODEL_FAILURE_PATTERNS: RegExp[] = [
    /rate limit/i,
    /too many requests/i,
    /temporarily unavailable/i,
    /service unavailable/i,
    /model.*unavailable/i,
    /overloaded/i,
    /timeout/i,
];

function errorToString(error: unknown): string {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function normalizeModelID(model: unknown): string | undefined {
    if (!model) return undefined;
    if (typeof model === 'string') return model;
    if (typeof model === 'object') {
        const typed = model as { providerID?: unknown; modelID?: unknown; id?: unknown };
        if (typeof typed.providerID === 'string' && typed.providerID.length > 0 && typeof typed.modelID === 'string' && typed.modelID.length > 0) {
            return `${typed.providerID}/${typed.modelID}`;
        }
        if (typeof typed.modelID === 'string' && typed.modelID.length > 0) return typed.modelID;
        if (typeof typed.id === 'string' && typed.id.length > 0) return typed.id;
    }
    return undefined;
}

function splitModelReference(modelID: string): { providerID?: string; modelID?: string } {
    const slashIndex = modelID.indexOf('/');
    if (slashIndex <= 0 || slashIndex === modelID.length - 1) return { modelID };
    return {
        providerID: modelID.slice(0, slashIndex),
        modelID: modelID.slice(slashIndex + 1),
    };
}

function getSessionModel(properties: Record<string, unknown> | undefined): string | undefined {
    if (!properties) return undefined;
    if (properties.model !== undefined) return normalizeModelID(properties.model);
    if (properties.info !== undefined) return normalizeModelID(properties.info);
    return normalizeModelID({ providerID: properties.providerID, modelID: properties.modelID });
}

function normalizeModelParts(model: unknown, provider: unknown): { providerID?: string; modelID?: string } {
    if (typeof model === 'object' && model) {
        const typed = model as { providerID?: unknown; modelID?: unknown; id?: unknown };
        const providerID = typeof typed.providerID === 'string' ? typed.providerID : undefined;
        const modelID = typeof typed.modelID === 'string' ? typed.modelID : (typeof typed.id === 'string' ? typed.id : undefined);
        if (providerID || modelID) return { providerID, modelID };
    }

    if (typeof provider === 'object' && provider) {
        const typedProvider = provider as { providerID?: unknown; id?: unknown };
        const providerID = typeof typedProvider.providerID === 'string' ? typedProvider.providerID : (typeof typedProvider.id === 'string' ? typedProvider.id : undefined);
        if (providerID) {
            const modelID = normalizeModelID(model);
            if (modelID) return { providerID, modelID };
        }
    }

    return { modelID: normalizeModelID(model) };
}

async function getRuntimeSessionMessages(session: Record<string, unknown> | undefined): Promise<unknown[]> {
    if (!session) return [];

    const extractMessages = (result: unknown): unknown[] => {
        if (Array.isArray(result)) return result;
        if (result && typeof result === 'object') {
            const typed = result as { messages?: unknown[]; items?: unknown[]; data?: unknown[] };
            if (Array.isArray(typed.messages)) return typed.messages;
            if (Array.isArray(typed.items)) return typed.items;
            if (Array.isArray(typed.data)) return typed.data;
        }
        return [];
    };

    const directMessages = session.messages;
    if (Array.isArray(directMessages)) return directMessages;

    if (typeof directMessages === 'function') {
        try {
            return extractMessages(await Promise.resolve((directMessages as () => unknown)()));
        } catch {
            // runtime shape differs; fall back to prompt context
        }
    }

    if (directMessages && typeof directMessages === 'object') {
        return extractMessages(directMessages);
    }

    if (typeof session.getMessages === 'function') {
        try {
            return extractMessages(await Promise.resolve((session.getMessages as () => unknown)()));
        } catch {
            // runtime shape differs; fall back to prompt context
        }
    }

    return [];
}

function getMessageRole(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const typed = message as { role?: unknown; info?: { role?: unknown } };
    if (typeof typed.role === 'string') return typed.role;
    if (typeof typed.info?.role === 'string') return typed.info.role;
    return undefined;
}

function getMessageParts(message: unknown): unknown[] | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const typed = message as { parts?: unknown; message?: { parts?: unknown }; content?: unknown; text?: unknown };
    if (Array.isArray(typed.parts)) return typed.parts;
    if (Array.isArray(typed.message?.parts)) return typed.message.parts;
    if (typeof typed.text === 'string') return [{ type: 'text', text: typed.text }];
    if (typeof typed.content === 'string') return [{ type: 'text', text: typed.content }];
    return undefined;
}

async function getLatestUserMessageParts(client: unknown, fallbackMessage?: unknown): Promise<unknown[] | undefined> {
    const fallbackParts = getMessageParts(fallbackMessage);
    if (fallbackParts && fallbackParts.length > 0) return fallbackParts;

    const messages = await getRuntimeSessionMessages(client as Record<string, unknown> | undefined);
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (getMessageRole(message) !== 'user') continue;
        const parts = getMessageParts(message);
        if (parts && parts.length > 0) return parts;
    }

    return undefined;
}

function findModelIndex(chain: string[], currentModel: string): number {
    const exactIndex = chain.indexOf(currentModel);
    if (exactIndex >= 0) return exactIndex;

    const modelID = currentModel.includes('/') ? currentModel.split('/').pop() : currentModel;
    if (!modelID) return -1;

    return chain.findIndex((candidate) => candidate === modelID || candidate.endsWith(`/${modelID}`));
}

function preferModelReference(existing: string | undefined, incoming: string | undefined): string | undefined {
    if (!incoming) return existing;
    if (!existing) return incoming;
    if (incoming.includes('/')) return incoming;
    if (existing.includes('/') && existing.endsWith(`/${incoming}`)) return existing;
    return incoming;
}

function getRuntimeSessionClient(client: unknown): Record<string, unknown> | undefined {
    const session = (client as { session?: Record<string, unknown> } | undefined)?.session;
    return session && typeof session === 'object' ? session : undefined;
}

async function invokeRuntimeMethod(target: Record<string, unknown> | undefined, names: string[], argsList: unknown[][]): Promise<boolean> {
    if (!target) return false;
    for (const name of names) {
        const fn = target[name];
        if (typeof fn !== 'function') continue;
        for (const args of argsList) {
            try {
                await Promise.resolve((fn as (...callArgs: unknown[]) => unknown)(...args));
                return true;
            } catch {
                // try the next runtime shape
            }
        }
    }
    return false;
}

export function isRetryableModelFailure(message: string): boolean {
    return RETRYABLE_MODEL_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function createForegroundFallbackController(worktree: string, enabled = true) {
    const projectKey = getProjectKey(worktree);
    const stateDir = join(HARNESS_DIR, 'projects', projectKey);
    const statePath = join(stateDir, 'foreground-fallback.json');
    const sessions = new Map<string, ForegroundFallbackSessionState>();
    const advancedSessions = new Set<string>();

    function loadState(): ForegroundFallbackFile {
        const parsed = readJsonFile<ForegroundFallbackFile | null>(statePath, null);
        if (!parsed || typeof parsed !== 'object' || !parsed.agents) return { agents: {} };
        return { agents: parsed.agents ?? {} };
    }

    function saveState(state: ForegroundFallbackFile): void {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(statePath, JSON.stringify(state, null, 2));
    }

    function getAgentState(state: ForegroundFallbackFile, agent: string): ForegroundFallbackAgentState {
        if (!state.agents[agent]) {
            state.agents[agent] = { cursor: 0, updated_at: new Date().toISOString() };
        }
        return state.agents[agent];
    }

    function resolveModel(agent: string, baseModel: string | undefined, chain: string[] | undefined): string | undefined {
        if (!enabled) return baseModel;
        if (!chain || chain.length === 0) return baseModel;

        const state = loadState();
        const agentState = getAgentState(state, agent);
        const cursor = Math.min(agentState.cursor, chain.length - 1);
        return chain[cursor] ?? baseModel;
    }

    function getSessionState(sessionID: string): ForegroundFallbackSessionState | undefined {
        return sessions.get(sessionID);
    }

    function recordSession(sessionID: string, agent: string, chain: string[], currentModel?: string, prompt?: SessionPromptContext): void {
        sessions.set(sessionID, { agent, chain, currentModel, lastPrompt: prompt, lastFailureKey: undefined });
        advancedSessions.delete(sessionID);
    }

    function syncSessionModel(sessionID: string, model?: string): void {
        if (!model) return;
        const session = sessions.get(sessionID);
        if (!session) return;
        const nextModel = preferModelReference(session.currentModel, model);
        if (session.currentModel !== nextModel) {
            session.lastFailureKey = undefined;
        }
        session.currentModel = nextModel;
    }

    function syncSessionPrompt(sessionID: string, prompt: SessionPromptContext, model?: string): void {
        const session = sessions.get(sessionID);
        if (!session) return;
        session.lastPrompt = prompt;
        if (model) session.currentModel = model;
    }

    function advanceOnFailure(sessionID: string, message: string): boolean {
        if (!enabled) return false;
        if (!isRetryableModelFailure(message)) return false;

        const session = sessions.get(sessionID);
        if (!session || advancedSessions.has(sessionID) || session.chain.length <= 1) return false;

        const state = loadState();
        const agentState = getAgentState(state, session.agent);
        const nextCursor = Math.min(agentState.cursor + 1, session.chain.length - 1);
        if (nextCursor === agentState.cursor) return false;

        agentState.cursor = nextCursor;
        agentState.updated_at = new Date().toISOString();
        agentState.last_session_id = sessionID;
        agentState.last_failure = message.slice(0, MAX_ERROR_SUMMARY_LENGTH);
        saveState(state);
        advancedSessions.add(sessionID);
        return true;
    }

    async function recoverSession(sessionID: string, message: string, client?: unknown): Promise<boolean> {
        if (!enabled) return false;
        if (!isRetryableModelFailure(message)) return false;

        const session = getSessionState(sessionID);
        if (!session || session.chain.length <= 1) return false;

        const currentModel = session.currentModel ?? normalizeModelID(session.lastPrompt?.model) ?? session.chain[0];
        const currentIndex = currentModel ? findModelIndex(session.chain, currentModel) : -1;
        const state = loadState();
        const agentState = getAgentState(state, session.agent);
        const resolvedIndex = currentIndex >= 0 ? currentIndex : Math.min(agentState.cursor, session.chain.length - 1);
        const nextCursor = Math.min(resolvedIndex + 1, session.chain.length - 1);
        if (nextCursor <= resolvedIndex) return false;

        const nextModel = session.chain[nextCursor];
        const failureKey = `${session.agent}:${nextModel ?? currentModel ?? ''}:${message}`;
        if (session.lastFailureKey === failureKey) return false;

        const finalizeRecovery = (): void => {
            session.currentModel = nextModel;
            session.lastFailureKey = failureKey;
            agentState.cursor = nextCursor;
            agentState.updated_at = new Date().toISOString();
            agentState.last_session_id = sessionID;
            agentState.last_failure = message.slice(0, MAX_ERROR_SUMMARY_LENGTH);
            saveState(state);
        };

        const sessionClient = getRuntimeSessionClient(client);
        if (!sessionClient) {
            finalizeRecovery();
            return true;
        }

        await invokeRuntimeMethod(sessionClient, ['abort'], [[{ sessionID }], [sessionID]]);
        const provider = session.lastPrompt?.provider;
        const baseModelParts = normalizeModelParts(session.lastPrompt?.model, provider);
        const nextModelParts = nextModel ? splitModelReference(nextModel) : {};
        const promptPayload: Record<string, unknown> = {
            sessionID,
            agent: session.agent,
            modelID: nextModelParts.modelID ?? nextModel,
            model: {
                ...baseModelParts,
                ...(provider && typeof provider === 'object' ? provider as Record<string, unknown> : {}),
                ...nextModelParts,
            },
            provider,
            parts: await getLatestUserMessageParts(sessionClient, session.lastPrompt?.message),
        };

        const promptSucceeded = await invokeRuntimeMethod(sessionClient, ['prompt_async', 'promptAsync'], [[promptPayload], [sessionID, promptPayload], [{ sessionID, ...promptPayload }]]);
        if (!promptSucceeded) return false;

        finalizeRecovery();
        return true;
    }

    function clearSession(sessionID?: string): void {
        if (!sessionID) return;
        sessions.delete(sessionID);
        advancedSessions.delete(sessionID);
    }

    return {
        resolveModel,
        recordSession,
        syncSessionModel,
        syncSessionPrompt,
        advanceOnFailure,
        recoverSession,
        clearSession,
        getSessionState,
        statePath,
        projectKey,
    };
}

export function createForegroundFallbackHook(context: HookContext, controller: ReturnType<typeof createForegroundFallbackController>) {
    return {
        'chat.params': async (input: { sessionID: string; agent: string; model?: unknown; provider?: unknown; message?: unknown }) => {
            if (!context.fallbackEnabled) return;

            const agent = context.agentsByName[input.agent];
            const chain = agent?._fallbackChain;
            if (!agent || !chain || chain.length === 0) return;

            controller.recordSession(input.sessionID, input.agent, chain, normalizeModelID(input.model), {
                sessionID: input.sessionID,
                agent: input.agent,
                model: input.model,
                provider: input.provider,
                message: input.message,
            });
        },

        event: async (input: { event: { type: string; properties?: Record<string, unknown> } }) => {
            const sessionID = String((input.event.properties as { sessionID?: string } | undefined)?.sessionID ?? '');

            if (input.event.type === 'session.idle' || input.event.type === 'session.deleted') {
                controller.clearSession(sessionID || undefined);
                return;
            }

            if (input.event.type === 'message.updated' || input.event.type === 'session.status') {
                const model = getSessionModel(input.event.properties);
                if (sessionID && model) {
                    controller.syncSessionModel(sessionID, model);
                }
                return;
            }

            if (input.event.type !== 'session.error') return;

            const error = errorToString((input.event.properties as { error?: unknown } | undefined)?.error);
            if (sessionID && error) {
                await controller.recoverSession(sessionID, error, context.client);
            }
        },
    };
}
