#!/usr/bin/env -S node --experimental-strip-types
import { CapyClient } from "./client.ts";
import { readConfig, taskKeyFromRequest } from "./config.ts";
import { Lifecycle } from "./lifecycle.ts";
import { StateStore } from "./state.ts";
import { EndBudget } from "./budget.ts";

const PROTOCOL = "agent-browser.plugin.v1";
const NAME = "capy";
const CAPABILITIES = ["browser.provider", "command.run"];

interface Message {
  protocol?: string;
  type?: string;
  request?: unknown;
}

async function handle(message: Message) {
  if (message.type === "plugin.manifest") {
    return { protocol: PROTOCOL, success: true, manifest: { name: NAME, capabilities: CAPABILITIES, description: "Baizhi Cloud Browser remote CDP provider" } };
  }

  if (message.type === "browser.close") {
    // The upstream protocol provides no close reason. This callback is also
    // invoked by implicit relaunch after a CDP disconnect; never stop a Session here.
    return { protocol: PROTOCOL, success: true };
  }

  if (message.type === "browser.launch") {
    try {
      const config = readConfig();
      const taskKey = taskKeyFromRequest(message.request);
      const lifecycle = new Lifecycle(config, new StateStore(config.stateDir), new CapyClient(config));
      const browser = await lifecycle.launch(taskKey);
      return { protocol: PROTOCOL, success: true, browser };
    } catch (error) {
      // Keep error text generic: upstream output must not disclose API responses,
      // bearer credentials, CDP URLs, or internal file paths.
      return { protocol: PROTOCOL, success: false, error: safeFailure(error) };
    }
  }

  if (message.type === "capy.session.end" || message.type === "capy.session.inspect") {
    const budget = message.type === "capy.session.end" ? new EndBudget() : undefined;
    try {
      const config = readConfig();
      const request = asRecord(message.request);
      const taskKey = typeof request.session === "string" ? request.session : "";
      if (!taskKey) throw new Error("A task session name is required");
      const lifecycle = new Lifecycle(config, new StateStore(config.stateDir), new CapyClient(config));
      if (message.type === "capy.session.end") {
        const report = await lifecycle.end(taskKey, request.confirm_existing === true, budget);
        const success = Boolean(report.end_accepted && report.released && report.billing_final && !report.review_required);
        return {
          protocol: PROTOCOL, success, data: report,
          ...(success ? {} : { error: `Baizhi Cloud Browser end incomplete: facts_obtained=${report.facts_obtained}, stop_outcome=${report.stop_outcome}, accepted=${report.end_accepted}, release=${report.release_status}, billing=${report.billing_status}, charge_stop_at=${report.charge_stop_at ?? "unknown"}, review_required=${report.review_required}, budget_exhausted=${report.budget_exhausted}. ${report.next_action}` }),
        };
      }
      const report = await lifecycle.inspect(taskKey);
      return { protocol: PROTOCOL, success: true, data: report ? { session_id: report.session_id, status: report.status, billing_status: report.billing?.status ?? "unknown", charge_stop_at: report.billing?.charge_stop_at ?? report.charge_stop_at ?? null } : { message: "No Session is saved for this task name" } };
    } catch (error) {
      return { protocol: PROTOCOL, success: false, error: safeFailure(error) };
    } finally {
      budget?.dispose();
    }
  }

  return { protocol: PROTOCOL, success: false, error: "Unsupported plugin request" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "request failed";
  if (message.includes("required") || message.includes("invalid") || message.includes("owned") || message.includes("ended") || message.includes("refusing") || message.includes("configuration changed") || message.includes("unbound") || message.includes("HTTPS") || message.includes("userinfo")) return message;
  return "Baizhi Cloud Browser provider request failed; inspect the Session using its task name and retry only the same operation";
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let result: unknown;
  try { result = await handle(JSON.parse(input) as Message); }
  catch { result = { protocol: PROTOCOL, success: false, error: "Invalid plugin request" }; }
  process.stdout.write(JSON.stringify(result));
}

void main();
