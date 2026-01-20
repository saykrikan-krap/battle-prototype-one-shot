# battle-prototype-one-shot

Throwaway prototype to validate a tick-based battle resolver and replay UI.

## Run

```bash
npm install
npm run dev
```

## Notes

- Resolver runs in a web worker (`src/resolver/worker.ts`).
- Shared contracts live in `src/schema`.
- UI lives in `src/replayer`.
