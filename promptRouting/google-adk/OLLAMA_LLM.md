# OllamaLlm — Deep Dive

A custom `BaseLlm` adapter that lets Google ADK (TypeScript) talk to a locally running Ollama model via its OpenAI-compatible HTTP API.

---

## Why this exists

The TypeScript version of `@google/adk` only has two built-in model backends:

| Backend | Matches |
|---|---|
| `Gemini` | `gemini-*`, Vertex AI endpoint paths |
| `ApigeeLlm` | `apigee/*` |

There is no LiteLLM support in the TS SDK (unlike the Python SDK). `OllamaLlm` fills this gap by subclassing `BaseLlm` and wiring up Ollama's `/v1/chat/completions` endpoint.

---

## The format mismatch problem

Google ADK speaks its own internal wire format. Ollama speaks OpenAI's wire format. They are not the same.

```
ADK internally uses:                Ollama expects:
─────────────────────               ──────────────────
Content[]                    →      messages: OAMessage[]
  role: "model" | "user"            role: "assistant" | "user" | "system" | "tool"
  parts: Part[]
    { text }                 →        { content: string }
    { functionCall }         →        { tool_calls: [...] }
    { functionResponse }     →        { role: "tool", tool_call_id, content }

GenerateContentConfig.tools  →      tools: [{ type: "function", function: {...} }]
  functionDeclarations[]

LlmResponse                  ←      OAResponse
  content.parts[].text              choices[0].message.content
  content.parts[].functionCall      choices[0].message.tool_calls[]
```

`OllamaLlm` translates in both directions on every request.

---

## Architecture

```
LlmAgent
  │
  │  calls
  ▼
OllamaLlm.generateContentAsync(LlmRequest)
  │
  ├─► toOAMessages(req)          ← converts Content[] → OAMessage[]
  ├─► toOATools(req)             ← converts FunctionDeclarations → OA tools
  │
  ├─► fetch POST /v1/chat/completions  (Ollama HTTP)
  │
  └─► oaChoiceToLlmResponse()   ← converts OA response → LlmResponse
        OR
      handleStream()             ← converts SSE chunks → partial LlmResponse
```

---

## Flow walkthrough

### 1. ADK invokes the model

When an `LlmAgent` runs, the ADK framework calls:

```typescript
ollama.generateContentAsync(llmRequest, stream?)
```

`LlmRequest` contains:
- `contents`: the full conversation history as `Content[]`
- `config.systemInstruction`: the agent's instruction string
- `config.tools`: function declarations (if any tools are attached)

### 2. Convert to OpenAI format

#### System instruction

```typescript
if (typeof sys === "string")
  → { role: "system", content: sys }
else
  → join all text parts, push as { role: "system", content }
```

#### Conversation turns

Each `Content` in `req.contents` is inspected for what kind of parts it has:

```
functionResponse parts present?
  → emit one { role: "tool", tool_call_id, content: JSON.stringify(response) }
    per response (Ollama expects one message per tool result)

functionCall parts present?
  → emit { role: "assistant", content: null, tool_calls: [...] }

plain text parts?
  → emit { role: "user"|"assistant", content: joined text }
```

#### Tools / function declarations

```typescript
for each tool config with functionDeclarations:
  → { type: "function", function: { name, description, parameters } }
```

### 3. Call Ollama

```
POST http://localhost:11434/v1/chat/completions
Content-Type: application/json

{
  "model": "phi4-mini:3.8b",
  "messages": [...],
  "tools": [...],        // omitted if empty
  "stream": false|true
}
```

### 4. Convert response back to ADK format

#### Non-streaming

```typescript
if (message.tool_calls present)
  → LlmResponse {
      content: {
        role: "model",
        parts: [{ functionCall: { id, name, args } }, ...]
      }
    }
else
  → LlmResponse {
      content: { role: "model", parts: [{ text: message.content }] }
    }
```

#### Streaming (SSE)

Each `data:` line is parsed. If `delta.content` is present, a partial `LlmResponse` is yielded:

```typescript
yield { content: { role: "model", parts: [{ text: delta }] }, partial: true }
```

---

## Pseudocode

```
class OllamaLlm extends BaseLlm:

  constructor(model, baseUrl):
    super(model)
    this.baseUrl = baseUrl

  async* generateContentAsync(req, stream):
    messages = toOAMessages(req)
    tools    = toOATools(req)

    response = POST baseUrl/v1/chat/completions {
      model, messages, tools, stream
    }

    if error:
      yield { errorCode, errorMessage }
      return

    if stream:
      for each SSE chunk:
        if chunk has delta.content:
          yield { content: { text: delta }, partial: true }
    else:
      msg = response.choices[0].message
      if msg.tool_calls:
        yield { content: { parts: [functionCall, ...] } }
      else:
        yield { content: { parts: [{ text: msg.content }] } }

  connect(req):
    throw "not supported"

  toOAMessages(req):
    msgs = []
    if systemInstruction: msgs.push({ role: "system", ... })
    for content in req.contents:
      if has functionResponse parts:
        for each: msgs.push({ role: "tool", tool_call_id, content })
      elif has functionCall parts:
        msgs.push({ role: "assistant", tool_calls: [...] })
      else:
        msgs.push({ role: user/assistant, content: text })
    return msgs

  toOATools(req):
    for each functionDeclaration in req.config.tools:
      → { type: "function", function: { name, description, parameters } }
```

---

## How to implement from scratch

### Step 1 — Subclass `BaseLlm`

```typescript
import { BaseLlm } from "@google/adk";

class OllamaLlm extends BaseLlm {
  constructor({ model, baseUrl }) {
    super({ model });          // model name stored as this.model
    this.baseUrl = baseUrl;
  }
}
```

### Step 2 — Implement `generateContentAsync`

This is the only required method for non-live usage. It is an async generator
that must yield at least one `LlmResponse`.

```typescript
async *generateContentAsync(req, stream = false) {
  // 1. build OpenAI body
  // 2. fetch
  // 3. parse and yield LlmResponse
}
```

### Step 3 — Stub `connect`

Required by the abstract class. Throw if live mode is not needed.

```typescript
async connect(_req) {
  throw new Error("not supported");
}
```

### Step 4 — Use it

Pass the instance directly into `LlmAgent.model`. No registry needed.

```typescript
const llm = new OllamaLlm({ model: "phi4-mini:3.8b" });

const agent = new LlmAgent({
  name: "MyAgent",
  model: llm,           // ← BaseLlm instance, not a string
  instruction: "...",
});
```

### Step 5 — Optional registry

If you want to use a string model name (e.g. `"ollama/phi4-mini:3.8b"`):

```typescript
import { LLMRegistry } from "@google/adk";

OllamaLlm.supportedModels = [/ollama\/.*/];
LLMRegistry.register(OllamaLlm);

// Now this works:
new LlmAgent({ model: "ollama/phi4-mini:3.8b", ... });
```

Note: when registered this way, `LLMRegistry.newLlm()` calls
`new OllamaLlm({ model: "ollama/phi4-mini:3.8b" })`. The constructor
must strip the prefix to get the real Ollama model name.

---

## Extending capabilities

### Add headers (auth, custom routing)

```typescript
constructor({ model, baseUrl, headers }) {
  super({ model });
  this.baseUrl = baseUrl;
  this.headers = headers ?? {};
}

// in fetch call:
headers: { "Content-Type": "application/json", ...this.headers }
```

### Temperature / sampling params

Pass through from `req.config`:

```typescript
const body = {
  model: this.model,
  messages,
  stream,
  temperature: req.config?.temperature,
  top_p:       req.config?.topP,
  max_tokens:  req.config?.maxOutputTokens,
};
```

### Custom function / tool calling

Add a post-processing step that inspects the model output and
re-routes to a local `FunctionTool`:

```typescript
// after getting LlmResponse with functionCall parts:
const tool = toolsDict[functionCall.name];
const result = await tool.runAsync({ args: functionCall.args });
// inject result back into next turn as functionResponse
```

The ADK framework already handles this loop automatically when
`tools` are attached to `LlmAgent` — your `OllamaLlm` just needs
to correctly emit `functionCall` parts.

### Retry / fallback

```typescript
async *generateContentAsync(req, stream = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      yield* this.doGenerate(req, stream);
      return;
    } catch (err) {
      if (attempt === 2) yield { errorCode: "MAX_RETRIES", errorMessage: String(err) };
    }
  }
}
```

### Multi-model routing

Create a router class that delegates to different `OllamaLlm` instances
based on task type:

```typescript
class RouterLlm extends BaseLlm {
  private fast = new OllamaLlm({ model: "phi4-mini:3.8b" });
  private smart = new OllamaLlm({ model: "llama3.3:70b" });

  async *generateContentAsync(req, stream) {
    const isComplex = req.contents.length > 5;
    yield* isComplex
      ? this.smart.generateContentAsync(req, stream)
      : this.fast.generateContentAsync(req, stream);
  }
}
```

### Live / streaming connection (Ollama does not support this natively)

Implement `connect()` to return a `BaseLlmConnection` using a polling
loop over the `/v1/chat/completions` streaming endpoint:

```typescript
async connect(req) {
  return new OllamaConnection(req, this.baseUrl, this.model);
}

class OllamaConnection implements BaseLlmConnection {
  async sendContent(content) { /* buffer */ }
  async *receive() { /* poll and yield */ }
  async close() { /* cleanup */ }
}
```

---

## File layout

```
google-adk/
├── agent.ts          ← defines rootAgent using OllamaLlm
├── ollama_llm.ts     ← OllamaLlm class (this adapter)
├── package.json
└── OLLAMA_LLM.md     ← this file
```

---

## Quick reference

| What | Where in code |
|---|---|
| Model → messages | `toOAMessages()` |
| Tools → OA tools | `toOATools()` |
| OA response → ADK | `oaChoiceToLlmResponse()` |
| SSE streaming | `handleStream()` |
| Error surface | `yield { errorCode, errorMessage }` |
| Live mode | `connect()` — throws (not supported) |
