import { BaseLlm } from "@google/adk";
import type { BaseLlmConnection } from "@google/adk";
import type { LlmRequest } from "@google/adk";
import type { LlmResponse } from "@google/adk";
import type { Content, Part } from "@google/genai";

// ── OpenAI-compatible API types ───────────────────────────────────────────

/** OpenAI-compatible message format. */
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI-compatible tool call (function calling). */
interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** OpenAI-compatible tool definition. */
interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI chat completion choice. */
interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

/** OpenAI chat completion response. */
interface OpenAIResponse {
  choices: OpenAIChoice[];
}

/** SSE chunk from streaming response. */
interface OpenAIChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Configuration options for the Ollama LLM.
 */
export interface OllamaConfig {
  /** Ollama model name (e.g., "phi4-mini:3.8b", "llama3") */
  model: string;
  /** Ollama server URL. Defaults to http://localhost:11434 */
  baseUrl?: string;
  /** Request timeout in ms. Default: 300000 (5 minutes) */
  timeout?: number;
}

/**
 * Google ADK LLM that connects to a local Ollama instance.
 *
 * Works with any Ollama model via the OpenAI-compatible /v1/chat/completions API.
 *
 * @example
 * ```ts
 * import { Ollama } from "adk-ollama";
 * import { LlmAgent } from "@google/adk";
 *
 * const llm = new Ollama({ model: "llama3" });
 * const agent = new LlmAgent({ model: llm, ... });
 * ```
 */
export class Ollama extends BaseLlm {
  /**
   * Registers this LLM under the "ollama/" prefix in the ADK model registry.
   * This allows using "ollama/llama3" as model string in LlmAgent.
   */
  static readonly supportedModels: Array<string | RegExp> = [/ollama\/.*/];

  /** Base URL of the Ollama server. */
  private readonly baseUrl: string;

  /** Request timeout in milliseconds. */
  private readonly timeout: number;

  constructor(config: OllamaConfig) {
    super({ model: config.model });
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.timeout = config.timeout ?? 300000;
  }

  // ── Main generation API ─────────────────────────────────────────────────

  async *generateContentAsync(
    request: LlmRequest,
    stream = false
  ): AsyncGenerator<LlmResponse, void> {
    const messages = this.convertToOpenAI(request);
    const tools = this.extractTools(request);

    const body = this.buildRequestBody({ messages, tools, stream });

    const [response, error] = await this.callAPI(body);
    if (error || !response) {
      if (error) yield error;
      return;
    }

    if (stream) {
      yield* this.handleStreamingResponse(response);
    } else {
      yield this.handleNonStreamingResponse(response);
    }
  }

  /** @throws Error - Ollama does not support live/connect mode. */
  async connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("Ollama does not support live/connect mode.");
  }

  // ── Request building ───────────────────────────────────────────────────

  /**
   * Converts a Google ADK LlmRequest to OpenAI message format.
   * @param request - The incoming LlmRequest from Google ADK
   * @returns Array of OpenAI-compatible messages
   */
  private convertToOpenAI(request: LlmRequest): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];
    this.appendSystemInstruction(request, messages);
    this.convertContents(request, messages);
    return messages;
  }

  /**
   * Extracts and appends the system instruction to messages.
   * @param request - The incoming LlmRequest
   * @param messages - Array to append system message to
   */
  private appendSystemInstruction(
    request: LlmRequest,
    messages: OpenAIMessage[]
  ): void {
    const instruction = request.config?.systemInstruction;
    if (!instruction) return;

    if (typeof instruction === "string") {
      messages.push({ role: "system", content: instruction });
      return;
    }

    const text = (instruction as Content).parts
      ?.map((p: Part) => p.text ?? "")
      .join("\n");
    if (text) messages.push({ role: "system", content: text });
  }

  /**
   * Converts request contents to OpenAI message format.
   * Handles text, function calls, and function responses.
   * @param request - The incoming LlmRequest
   * @param messages - Array to append converted messages to
   */
  private convertContents(request: LlmRequest, messages: OpenAIMessage[]): void {
    for (const content of request.contents) {
      const parts = content.parts ?? [];
      const functionCalls = parts.filter((p) => p.functionCall);
      const functionResponses = parts.filter((p) => p.functionResponse);
      const textParts = parts.filter((p) => p.text);

      if (functionResponses.length > 0) {
        this.appendToolResponses(functionResponses, messages);
      } else if (functionCalls.length > 0) {
        this.appendAssistantMessage(functionCalls, textParts, messages);
      } else {
        this.appendUserMessage(content.role ?? "user", textParts, messages);
      }
    }
  }

  /**
   * Appends tool response messages (function execution results).
   * @param responses - Function response parts from the request
   * @param messages - Array to append tool messages to
   */
  private appendToolResponses(
    responses: Part[],
    messages: OpenAIMessage[]
  ): void {
    for (const part of responses) {
      const fn = part.functionResponse;
      if (!fn) continue;
      messages.push({
        role: "tool",
        tool_call_id: fn.id ?? fn.name ?? "",
        content: JSON.stringify(fn.response ?? {}),
      });
    }
  }

  /**
   * Appends assistant message with tool calls.
   * @param fnCalls - Function call parts from the request
   * @param textParts - Optional text parts accompanying the function calls
   * @param messages - Array to append assistant message to
   */
  private appendAssistantMessage(
    fnCalls: Part[],
    textParts: Part[],
    messages: OpenAIMessage[]
  ): void {
    const toolCalls = fnCalls.map((p) => {
      const fc = p.functionCall;
      return {
        id: fc?.id ?? fc?.name ?? "",
        type: "function" as const,
        function: {
          name: fc?.name ?? "",
          arguments: JSON.stringify(fc?.args ?? {}),
        },
      };
    });

    messages.push({
      role: "assistant",
      content: textParts.map((p) => p.text ?? "").join("") || null,
      tool_calls: toolCalls,
    });
  }

  /**
   * Appends a user message.
   * @param role - Content role (maps "model" to "assistant")
   * @param textParts - Text parts to include in the message
   * @param messages - Array to append user message to
   */
  private appendUserMessage(
    role: string,
    textParts: Part[],
    messages: OpenAIMessage[]
  ): void {
    messages.push({
      role: role === "model" ? "assistant" : "user" as const,
      content: textParts.map((p) => p.text ?? "").join(""),
    });
  }

  /**
   * Extracts tool definitions from the request config.
   * @param request - The incoming LlmRequest
   * @returns Array of OpenAI-compatible tool definitions
   */
  private extractTools(request: LlmRequest): OpenAITool[] {
    const tools: OpenAITool[] = [];

    for (const toolConfig of request.config?.tools ?? []) {
      if (!("functionDeclarations" in toolConfig)) continue;

      const declarations = (toolConfig as { functionDeclarations?: unknown[] })
        .functionDeclarations ?? [];

      for (const decl of declarations) {
        const d = decl as { name: string; description?: string; parameters?: unknown };
        tools.push({
          type: "function",
          function: {
            name: d.name,
            description: d.description,
            parameters: d.parameters as Record<string, unknown>,
          },
        });
      }
    }

    return tools;
  }

  /**
   * Builds the request body for the Ollama API.
   * @param params - Messages, tools, and streaming flag
   * @returns Request body object
   */
  private buildRequestBody(params: {
    messages: OpenAIMessage[];
    tools: OpenAITool[];
    stream: boolean;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: params.messages,
      stream: params.stream,
    };

    if (params.tools.length > 0) {
      body.tools = params.tools;
    }

    return body;
  }

  // ── API calls ───────────────────────────────────────────────────────────

  /**
   * Makes an API call to the Ollama /v1/chat/completions endpoint.
   * @param body - The request body
   * @returns Tuple of [Response, error?] or [null, error]
   */
  private async callAPI(
    body: Record<string, unknown>
  ): Promise<[Response, LlmResponse?] | [null, LlmResponse]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return [response];
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === "AbortError" || error instanceof DOMException) {
        return [null, { errorCode: "TIMEOUT", errorMessage: `Request timed out after ${this.timeout}ms` }];
      }
      return [null, { errorCode: "FETCH_ERROR", errorMessage }];
    }
  }

  /**
   * Handles non-streaming responses from Ollama.
   * @param response - The fetch Response object
   * @returns LlmResponse with content or error
   */
  private async handleNonStreamingResponse(
    response: Response
  ): Promise<LlmResponse> {
    if (!response.ok) {
      const text = await response.text();
      return { errorCode: String(response.status), errorMessage: text };
    }

    try {
      const data = (await response.json()) as OpenAIResponse;
      const choice = data.choices?.[0];

      if (!choice) {
        return { errorCode: "NO_RESPONSE", errorMessage: "Empty response from Ollama" };
      }

      return this.convertFromOpenAI(choice.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to parse response";
      return { errorCode: "PARSE_ERROR", errorMessage: message };
    }
  }

  /**
   * Handles streaming responses from Ollama (Server-Sent Events).
   * @param response - The fetch Response object
   * @yields LlmResponse chunks with partial=true
   */
  private async *handleStreamingResponse(
    response: Response
  ): AsyncGenerator<LlmResponse, void> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        let readResult: { done: boolean; value?: Uint8Array };
        try {
          readResult = await reader.read();
        } catch (readError) {
          const message = readError instanceof Error ? readError.message : "Stream read failed";
          yield { errorCode: "STREAM_ERROR", errorMessage: message };
          break;
        }

        const { done, value } = readResult;
        if (done) break;
        if (!value) continue;

        try {
          buffer += decoder.decode(value, { stream: true });
        } catch (decodeError) {
          const message = decodeError instanceof Error ? decodeError.message : "Decode failed";
          yield { errorCode: "DECODE_ERROR", errorMessage: message };
          break;
        }

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const chunk = this.parseSSEChunk(line);
          if (chunk) {
            yield {
              content: { role: "model", parts: [{ text: chunk }] },
              partial: true,
            };
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /**
   * Parses a single SSE line into text content.
   * @param line - A single line from the SSE stream
   * @returns Extracted text content or null if invalid
   */
  private parseSSEChunk(line: string): string | null {
    if (!line.startsWith("data: ")) return null;

    const raw = line.slice(6).trim();
    if (raw === "[DONE]") return null;

    try {
      const chunk = JSON.parse(raw) as OpenAIChunk;
      return chunk.choices?.[0]?.delta?.content ?? null;
    } catch {
      return null;
    }
  }

  // ── Response conversion ────────────────────────────────────────────────

  /**
   * Converts OpenAI message format back to Google ADK LlmResponse.
   * @param message - The OpenAI message from Ollama
   * @returns Google ADK LlmResponse
   */
  private convertFromOpenAI(message: OpenAIChoice["message"]): LlmResponse {
    if (message.tool_calls && message.tool_calls.length > 0) {
      const parts: Part[] = message.tool_calls.map((tc) => ({
        functionCall: {
          id: tc.id,
          name: tc.function.name,
          args: this.parseJSON(tc.function.arguments),
        },
      }));

      if (message.content) {
        parts.unshift({ text: message.content });
      }

      return { content: { role: "model", parts } };
    }

    return {
      content: { role: "model", parts: [{ text: message.content ?? "" }] },
    };
  }

  /**
   * Safely parses JSON string, returning empty object on failure.
   * @param str - JSON string to parse
   * @returns Parsed object or empty object if parsing fails
   */
  private parseJSON(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str || "{}");
    } catch {
      return {};
    }
  }
}

/**
 * @deprecated Use `Ollama` instead. This alias is provided for backwards compatibility.
 */
export const OllamaLlm = Ollama;
