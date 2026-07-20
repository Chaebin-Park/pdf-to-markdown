# Frontend result polling verification

## Scope and acceptance criteria

This check covers the frontend's `/result/{jobId}` polling state machine without requiring a running backend. It must:

- continue from HTTP 202 with `RUNNING` to a `DONE` result;
- preserve the backend's `ERROR` result fields;
- exercise the 30-minute timeout behavior with injected time and no wall-clock delay;
- stop fetching and sleeping once cancellation is observed;
- pass the focused tests, production frontend build, and whitespace validation.

## Commands and evidence

Run from `frontend/`:

```text
npm test
npm run build
git diff --check
```

Evidence captured on 2026-07-20:

- `npm test`: 4 tests passed, 0 failed.
- `npm run build`: TypeScript compilation and Vite production build passed.
- `git diff --check`: passed with no output.

The tests use Node's built-in test runner and Node's TypeScript type stripping; no dependency was added.
