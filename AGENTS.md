# Codex instructions

## Usage and scope discipline

- Treat the user's token and usage budget as a hard constraint. Complete the requested scope with the fewest necessary tool calls, reads, and validations.
- Do not over-engineer setup, planning, baseline, or harness phases. Build only what the requested phase requires.
- Run one proportional, focused validation pass after implementation. Do not repeat expensive builds, browser captures, broad checks, or visual reviews unless a subsequent code change could invalidate them.
- When work is divided into phases, implement only the phase the user requested. Do not begin later phases or optional improvements.
- If a check is known to fail for unrelated reasons, report it once and do not rerun it unless the current change plausibly affects that failure.

## Explicit user preference: stop unnecessary verification

- Stop once implementation and the necessary checks are complete. The user strongly objects to wasting credits on extra verification.
- Do not repeatedly launch Electron, reconnect UI automation, or retry optional visual checks after the relevant tests and build pass.
- If an optional visual check is unavailable or fails, report the limitation and finish. Retry only if the user requests it or a concrete unresolved issue makes the check necessary.
- Acknowledge and persist explicit workflow preferences instead of merely promising to remember them.
