#!/usr/bin/env node
/**
 * social-cockpit MCP server.
 *
 * Exposes the scheduling API — book a post for a future slot, list/inspect/move/
 * cancel what's booked, publish one early — plus one read-only analytics tool for
 * grounding those decisions in what actually performed.
 *
 * Served over stdio with `serveStdio`, which pins one server instance per
 * connection and answers both the current stateless protocol and the older
 * `initialize` handshake from the same factory. That's why clients on either
 * protocol era work without a second code path.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { cockpit, cockpitBase } from "./cockpit.js";
import { registerScheduleTools } from "./tools/schedule.js";
import { registerSlotTools } from "./tools/slots.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import type { ScheduleSettings } from "./types.js";

function build(): McpServer {
  const server = new McpServer(
    { name: "social-cockpit", version: "1.0.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Schedule and inspect social posts through a running social-cockpit instance. " +
        "Times are interpreted in the cockpit's configured timezone unless an explicit UTC offset is given — " +
        "read the schedule://settings resource if you need to state a time back to the user. " +
        "Media files are referenced by absolute path on the cockpit machine and are not uploaded until the slot arrives.",
    }
  );

  // A resource rather than a tool: it's a small, addressable, read-only fact
  // about the instance, and it costs no tool slot in every prompt.
  server.registerResource(
    "schedule-settings",
    "schedule://settings",
    {
      title: "Scheduler settings",
      description:
        "The cockpit's scheduling timezone and whether the worker is enabled or in dry-run mode.",
      mimeType: "application/json",
    },
    async (uri) => {
      const settings = await cockpit<ScheduleSettings>("/api/schedule/settings");
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(settings, null, 2) },
        ],
      };
    }
  );

  registerScheduleTools(server);
  registerCalendarTools(server);
  registerSlotTools(server);
  registerAnalyticsTools(server);

  return server;
}

serveStdio(build, {
  onerror(error) {
    // stdout is the protocol channel; diagnostics must never go there.
    process.stderr.write(`[social-cockpit-mcp] ${error.stack ?? error.message}\n`);
  },
});

// stdout carries the protocol, so every diagnostic goes to stderr.
process.stderr.write(`[social-cockpit-mcp] ready, talking to ${cockpitBase}\n`);
