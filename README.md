# battle-prototype-one-shot

Throwaway prototype to validate a tick-based battle resolver and replay UI.

## Run

```bash
npm install
npm run dev
```

## Agent Commands

Run the lightweight command server in a second terminal:

```bash
node scripts/agent-server.js
```

Send a placement command from the CLI:

```bash
node scripts/agent-cli.js placeUnit Red Infantry 0 0
```

Send a batch of placements in one call:

```bash
node scripts/agent-cli.js placeUnits '[{"side":"Red","type":"Infantry","x":0,"y":0},{"side":"Blue","type":"Infantry","x":11,"y":7}]'
```

You can also load a JSON file with `@`:

```bash
node scripts/agent-cli.js placeUnits @units.json
```

Note: commands are delivered live to connected clients; refreshing the app clears setup state.

## Notes

- Resolver runs in a web worker (`src/resolver/worker.ts`).
- Shared contracts live in `src/schema`.
- UI lives in `src/replayer`.
