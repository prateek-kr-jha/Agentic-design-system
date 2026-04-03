import { BaseLlm } from "@google/adk";
import type { BaseLlmConnection } from "@google/adk";
import type { LlmRequest } from "@google/adk";
import type { LlmResponse } from "@google/adk";
import type { Content, Part } from "@google/genai";

// ── OpenAI-compatible wire types ──────────────────────────────────────────

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAToolCall[];
  tool_call_id?: string;
}

interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OATool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OAChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OAToolCall[];
  };
  finish_reason: string;
}

interface OAResponse {
  choices: OAChoice[];
}

// ── OllamaLlm ─────────────────────────────────────────────────────────────

export interface OllamaLlmParams {
  /** Ollama model name, e.g. "phi4-mini:3.8b" */
  model: string;
  /** Ollama base URL. Defaults to http://localhost:11434 */
  baseUrl?: string;
}

/**
 * A Google ADK BaseLlm implementation that routes requests to a local
 * Ollama instance via its OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Usage:
 *   const llm = new OllamaLlm({ model: "phi4-mini:3.8b" });
 *   const agent = new LlmAgent({ model: llm, ... });
 */
export class OllamaLlm extends BaseLlm {
  /** Register with LLMRegistry under the "ollama/" prefix (optional). */
  static readonly supportedModels: Array<string | RegExp> = [/ollama\/.*/];

  private readonly baseUrl: string;

  constructor({ model, baseUrl }: OllamaLlmParams) {
    super({ model });
    this.baseUrl = (baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  }

  // ── Core generation ──────────────────────────────────────────────────────

  async *generateContentAsync(
    req: LlmRequest,
    stream = false
  ): AsyncGenerator<LlmResponse, void> {
    const messages = this.toOAMessages(req);
    const tools = this.toOATools(req);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream,
    };
    if (tools.length > 0) body.tools = tools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      yield { errorCode: "FETCH_ERROR", errorMessage: String(err) };
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      yield { errorCode: String(res.status), errorMessage: text };
      return;
    }

    if (stream) {
      yield* this.handleStream(res);
    } else {
      const data = (await res.json()) as OAResponse;
      const choice = data.choices?.[0];
      if (!choice) {
        yield { errorCode: "NO_RESPONSE", errorMessage: "Empty choices from Ollama" };
        return;
      }
      yield this.oaChoiceToLlmResponse(choice.message);
    }
  }

  /** Live/connect mode is not supported for Ollama. */
  async connect(_req: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("OllamaLlm does not support live/connect mode.");
  }

  // ── Conversion: Google → OpenAI ──────────────────────────────────────────

  private toOAMessages(req: LlmRequest): OAMessage[] {
    const msgs: OAMessage[] = [];

    // System instruction
    const sys = req.config?.systemInstruction;
    if (sys) {
      if (typeof sys === "string") {
        msgs.push({ role: "system", content: sys });
      } else {
        const text = (sys as Content).parts
          ?.map((p: Part) => p.text ?? "")
          .join("\n");
        if (text) msgs.push({ role: "system", content: text });
      }
    }

    for (const content of req.contents) {
      const parts = content.parts ?? [];
      const fnCalls = parts.filter((p) => p.functionCall);
      const fnResps = parts.filter((p) => p.functionResponse);
      const textParts = parts.filter((p) => p.text);

      if (fnResps.length > 0) {
        // Function responses → tool messages (one per response)
        for (const p of fnResps) {
          msgs.push({
            role: "tool",
            tool_call_id: p.functionResponse!.id ?? p.functionResponse!.name,
            content: JSON.stringify(p.functionResponse!.response ?? {}),
          });
        }
      } else if (fnCalls.length > 0) {
        // Function calls → assistant message with tool_calls array
        msgs.push({
          role: "assistant",
          content: textParts.map((p) => p.text ?? "").join("") || null,
          tool_calls: fnCalls.map((p) => ({
            id: p.functionCall!.id ?? p.functionCall!.name,
            type: "function" as const,
            function: {
              name: p.functionCall!.name,
              arguments: JSON.stringify(p.functionCall!.args ?? {}),
            },
          })),
        });
      } else {
        // Plain text message
        msgs.push({
          role: content.role === "model" ? "assistant" : "user",
          content: textParts.map((p) => p.text ?? "").join(""),
        });
      }
    }

    return msgs;
  }

  private toOATools(req: LlmRequest): OATool[] {
    const tools: OATool[] = [];
    for (const toolCfg of req.config?.tools ?? []) {
      if ("functionDeclarations" in toolCfg) {
        const decls = (
          toolCfg as {
            functionDeclarations?: {
              name: string;
              description?: string;
              parameters?: unknown;
            }[];
          }
        ).functionDeclarations ?? [];
        for (const decl of decls) {
          tools.push({
            type: "function",
            function: {
              name: decl.name,
              description: decl.description,
              parameters: decl.parameters as Record<string, unknown>,
            },
          });
        }
      }
    }
    return tools;
  }

  // ── Conversion: OpenAI → Google ──────────────────────────────────────────

  private oaChoiceToLlmResponse(msg: OAChoice["message"]): LlmResponse {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const parts: Part[] = msg.tool_calls.map((tc) => ({
        functionCall: {
          id: tc.id,
          name: tc.function.name,
          args: this.safeParseJson(tc.function.arguments),
        },
      }));
      if (msg.content) parts.unshift({ text: msg.content });
      return { content: { role: "model", parts } };
    }
    return {
      content: { role: "model", parts: [{ text: msg.content ?? "" }] },
    };
  }

  // ── Streaming ────────────────────────────────────────────────────────────

  private async *handleStream(res: Response): AsyncGenerator<LlmResponse, void> {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;

        try {
          const chunk = JSON.parse(raw) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            yield {
              content: { role: "model", parts: [{ text }] },
              partial: true,
            };
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  private safeParseJson(s: string): Record<string, unknown> {
    try {
      return JSON.parse(s || "{}");
    } catch {
      return {};
    }
  }
}
