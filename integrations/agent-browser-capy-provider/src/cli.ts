#!/usr/bin/env -S node --experimental-strip-types
import { CapyClient } from "./client.ts";
import { readConfig } from "./config.ts";
import { Lifecycle } from "./lifecycle.ts";
import { StateStore } from "./state.ts";
import { EndBudget } from "./budget.ts";

async function main() {
  const [action, taskKey, ...flags] = process.argv.slice(2);
  if (!taskKey || !["end"].includes(action ?? "")) {
    throw new Error("Usage: capy-agent-browser-session end <agent-browser-session> [--confirm-existing]");
  }
  const budget = new EndBudget();
  try {
    const config = readConfig();
    const lifecycle = new Lifecycle(config, new StateStore(config.stateDir), new CapyClient(config));
    const report = await lifecycle.end(taskKey, flags.includes("--confirm-existing"), budget);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.end_accepted || !report.released || !report.billing_final || report.review_required) process.exitCode = 2;
  } finally {
    budget.dispose();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Baizhi Cloud Browser Session operation failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
