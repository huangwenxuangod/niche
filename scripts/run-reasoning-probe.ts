import { runReasoningCapabilityProbe } from "../lib/agent/reasoning-probe";

async function main() {
  const result = await runReasoningCapabilityProbe();
  console.log(JSON.stringify(result, null, 2));
}

void main();
