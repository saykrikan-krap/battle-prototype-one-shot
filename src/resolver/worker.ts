import { resolveBattle } from "./logic";
import type { BattleInput, ResolveOutput } from "../schema/types";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<BattleInput>) => {
  try {
    const output: ResolveOutput = resolveBattle(event.data);
    ctx.postMessage({ type: "result", output });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ctx.postMessage({ type: "error", message });
  }
};
