const PORT = Number.parseInt(process.env.AGENT_PORT ?? "5174", 10);

const usage = () => {
  console.log("Usage:");
  console.log("  node scripts/agent-cli.js placeUnit <side> <type> <x> <y>");
  console.log("Example:");
  console.log("  node scripts/agent-cli.js placeUnit Red Infantry 0 0");
};

const run = async () => {
  const [action, side, type, x, y] = process.argv.slice(2);
  if (!action) {
    usage();
    process.exitCode = 1;
    return;
  }

  let payload = {};
  if (action === "placeUnit") {
    if (!side || !type || x === undefined || y === undefined) {
      usage();
      process.exitCode = 1;
      return;
    }
    payload = { side, type, x: Number(x), y: Number(y) };
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
