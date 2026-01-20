import { readFile } from "node:fs/promises";

const PORT = Number.parseInt(process.env.AGENT_PORT ?? "5174", 10);

const usage = () => {
  console.log("Usage:");
  console.log("  node scripts/agent-cli.js placeUnit <side> <type> <x> <y>");
  console.log("  node scripts/agent-cli.js placeUnits <json | @file>");
  console.log("Example:");
  console.log("  node scripts/agent-cli.js placeUnit Red Infantry 0 0");
  console.log(
    "  node scripts/agent-cli.js placeUnits '[{\"side\":\"Red\",\"type\":\"Infantry\",\"x\":0,\"y\":0}]'"
  );
};

const parseJsonArg = async (value) => {
  if (!value) {
    throw new Error("Missing JSON argument.");
  }
  if (value.startsWith("@")) {
    const contents = await readFile(value.slice(1), "utf8");
    return JSON.parse(contents);
  }
  return JSON.parse(value);
};

const run = async () => {
  const args = process.argv.slice(2);
  const action = args[0];
  if (!action) {
    usage();
    process.exitCode = 1;
    return;
  }

  let payload = {};
  if (action === "placeUnit") {
    const [side, type, x, y] = args.slice(1);
    if (!side || !type || x === undefined || y === undefined) {
      usage();
      process.exitCode = 1;
      return;
    }
    payload = { side, type, x: Number(x), y: Number(y) };
  } else if (action === "placeUnits") {
    const jsonArg = args[1];
    try {
      const parsed = await parseJsonArg(jsonArg);
      if (Array.isArray(parsed)) {
        payload = { units: parsed };
      } else {
        payload = parsed;
      }
    } catch (error) {
      console.error("Invalid JSON for placeUnits.");
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`Unknown action: ${action}`);
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`http://localhost:${PORT}/agent/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });
  const json = await response.json();
  console.log(JSON.stringify(json, null, 2));
};

run().catch((error) => {
  console.error("Agent CLI error:", error);
  process.exitCode = 1;
});
