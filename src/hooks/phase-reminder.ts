const PHASE_REMINDER = `<reminder>Recall Workflow Rules:
Understand → build the best path (delegated based on Agent rules, split and parallelized as much as possible) → execute → verify.
If delegating, launch the specialist in the same turn you mention it.</reminder>`;

interface MessageInfo {
    role: string;
    agent?: string;
}

interface MessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
}

interface MessageWithParts {
    info: MessageInfo;
    parts: MessagePart[];
}

export function createPhaseReminderHook() {
    return {
        'experimental.chat.messages.transform': async (_input: Record<string, never>, output: { messages: MessageWithParts[] }) => {
            for (const msg of output.messages) {
                if (msg.info?.agent === 'builder') {
                    const hasTextPart = msg.parts?.some((p) => p.type === 'text');
                    if (hasTextPart) {
                        msg.parts.push({ type: 'text', text: PHASE_REMINDER });
                        break;
                    }
                }
            }
        },
    };
}
