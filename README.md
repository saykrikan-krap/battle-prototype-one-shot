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
- Agent setup hook: `window.battlePrototype.placeUnit({ side: "Red", type: "Infantry", x: 0, y: 0 })`.
