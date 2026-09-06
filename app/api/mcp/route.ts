import { NextRequest, NextResponse } from "next/server";
import {
  ApiContext,
  enforceRateLimit,
  refund,
  reserve,
  resolveKey,
} from "@/lib/api/gateway";
import { findTool, MCP_TOOLS } from "@/lib/mcp/tools";
import { CloudaError, toCloudaError } from "@/lib/core/errors";
import { recordUsage } from "@/lib/core/metrics";
import { offload } from "@/lib/core/offload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Model Context Protocol endpoint.
 *
 * The REST API is for code a developer writes. This is for the model itself:
 * an MCP client is pointed at this URL once, reads the tool list, and from
 * then on the agent can search the web the way it calls any other tool — no
 * client library, no glue code, no guessing at parameter names.
 *
 * Transport is the "Streamable HTTP" shape: a single POST carrying one
 * JSON-RPC message, answered with one JSON-RPC response. No SSE stream is
 * opened, because nothing here is long-running enough to need progress
 * notifications and a serverless function is the wrong place to hold a stream
 * open.
 *
 * Authentication is the same Bearer key as everywhere else, so a key's
 * capabilities, credit cap and domain policy apply identically whether it is
 * used from curl or from an agent.
 */

const PROTOCOL_VERSION = "2025-06-18";
/** Versions we can speak, newest first. */
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "clouda",
  title: "Clouda Web Intelligence",
  version: "1.0.0",
};

/** JSON-RPC error codes: the four standard ones plus our own range. */
const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Application errors are reported as tool results, not transport errors. */
  unauthorized: -32001,
} as const;

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } },
    { status: 200 }
  );
}

function rpcResult(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status: 200 });
}

/**
 * A tool that failed is reported inside the result with `isError`, not as a
 * JSON-RPC error. That distinction matters: a transport error tells the client
 * the call never happened, while `isError` hands the model a message it can
 * read and act on — "that key lacks the citations capability" is something an
 * agent can work around, if it is told.
 */
function toolFailure(id: string | number | null, message: string) {
  return rpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  ctx: ApiContext
) {
  const name = typeof params.name === "string" ? params.name : "";
  const tool = findTool(name);
  if (!tool) {
    return toolFailure(id, `Bilinmeyen araç: ${name || "(isim yok)"}`);
  }

  if (tool.capability && !ctx.capabilities.includes(tool.capability)) {
    return toolFailure(
      id,
      `Bu anahtarda "${tool.capability}" özelliği açık değil. Clouda panelinden etkinleştirilebilir.`
    );
  }

  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

  const started = Date.now();
  let reserved = 0;

  try {
    await enforceRateLimit(ctx);
    await reserve(ctx, tool.estimate);
    reserved = tool.estimate;

    const { text, credits } = await tool.run(args, ctx);
    const remaining = await refund(ctx, reserved - credits);
    reserved = 0;

    const latencyMs = Date.now() - started;
    offload(() =>
      recordUsage({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        operation: "search",
        query: `mcp:${name}`,
        resultCount: 0,
        creditsUsed: credits,
        provider: "mcp",
        latencyMs,
        success: true,
      })
    );

    return rpcResult(id, {
      content: [{ type: "text", text }],
      // Structured alongside the prose, so a client that wants to meter usage
      // does not have to parse it back out of the text.
      structuredContent: { credits_used: credits, credits_remaining: remaining, took_ms: latencyMs },
    });
  } catch (err) {
    if (reserved > 0) await refund(ctx, reserved).catch(() => {});
    const error = toCloudaError(err);

    offload(() =>
      recordUsage({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        operation: "search",
        query: `mcp:${name}`,
        resultCount: 0,
        creditsUsed: 0,
        provider: "mcp",
        latencyMs: Date.now() - started,
        success: false,
        errorCode: error.code,
      })
    );

    return toolFailure(id, `${error.code}: ${error.message}`);
  }
}

export async function POST(req: NextRequest) {
  let message: RpcRequest;
  try {
    message = (await req.json()) as RpcRequest;
  } catch {
    return rpcError(null, RPC.parseError, "Gövde geçerli JSON değil.");
  }

  const id = message.id ?? null;
  const method = message.method ?? "";
  const params = message.params ?? {};

  if (message.jsonrpc && message.jsonrpc !== "2.0") {
    return rpcError(id, RPC.invalidRequest, "Yalnızca JSON-RPC 2.0 destekleniyor.");
  }

  // `initialize` and the tool listing are answered without a key so a client
  // can discover the server before it has one configured; anything that costs
  // credits authenticates.
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      return rpcResult(id, {
        protocolVersion: asked && SUPPORTED_PROTOCOLS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Clouda, yapay zeka ajanlarına canlı web erişimi verir. Güncel bilgi gerektiğinde " +
          "clouda_search, olan biteni öğrenmek için clouda_news, elindeki adresleri okumak " +
          "için clouda_extract, doğrulanabilir cevap için clouda_answer kullan. " +
          "clouda_rerank ve clouda_chunk ağ kullanmaz ve kendi metinlerin üzerinde çalışır. " +
          "Authorization: Bearer cld_live_... başlığı gerekir.",
      });
    }

    // Notifications carry no id and expect no response body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: true,
            openWorldHint: tool.name !== "clouda_rerank" && tool.name !== "clouda_chunk",
          },
        })),
      });

    case "resources/list":
      return rpcResult(id, { resources: [] });

    case "prompts/list":
      return rpcResult(id, { prompts: [] });

    case "tools/call": {
      let ctx: ApiContext;
      try {
        ctx = await resolveKey(req);
      } catch (err) {
        const error = err instanceof CloudaError ? err : toCloudaError(err);
        return rpcError(id, RPC.unauthorized, error.message, { code: error.code });
      }
      return callTool(id, params, ctx);
    }

    default:
      return rpcError(id, RPC.methodNotFound, `Desteklenmeyen metot: ${method}`);
  }
}

/** A GET makes the endpoint self-describing for anyone who opens it. */
export async function GET() {
  return NextResponse.json({
    server: SERVER_INFO,
    protocol: { preferred: PROTOCOL_VERSION, supported: SUPPORTED_PROTOCOLS },
    transport: "streamable-http (POST, JSON-RPC 2.0)",
    authentication: "Authorization: Bearer cld_live_...",
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      capability: t.capability ?? "her zaman açık",
      max_credits: t.estimate,
    })),
  });
}
