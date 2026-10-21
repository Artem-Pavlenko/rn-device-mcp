#!/usr/bin/env node
/**
 * rn-device-mcp: the iOS Simulator and Android devices as MCP tools, so an assistant can
 * look at the screen, read logs, open deep links and install builds while you work on a
 * React Native app. stdio transport; diagnostics go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { run } from "./exec.js";
import { createTools } from "./tools.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "rn-device-mcp", version: "0.1.0" });

  for (const tool of createTools({ runner: run })) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false },
      },
      async (args: unknown) => {
        try {
          return await tool.handler(args as never);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`rn-device-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
