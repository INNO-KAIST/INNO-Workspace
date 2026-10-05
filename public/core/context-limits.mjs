// Largest required task context (request+conversation+checkpoint, UTF-8 bytes) that a
// single execution delivers. Kept dependency-free so task validation and context
// assembly share it without an import cycle.
export const FULL_CONTEXT_HARD_MAX_BYTES = 384_000;
// Placeholders the assembler sends when a section is empty.
export const EMPTY_CHECKPOINT_TEXT = '- No checkpoint.';
export const EMPTY_CONVERSATION_TEXT = '- No additional messages.';
// How one conversation message is written in full (index is zero-based).
export const messageLine = (index, role, content) => `[Message #${index + 1}] ${role}: ${content}`;
