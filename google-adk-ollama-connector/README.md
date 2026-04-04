# adk-ollama

Google ADK connector for Ollama - use Ollama models with Google's Agent Development Kit.

## Installation

```bash
npm install adk-ollama
```

## Peer Dependencies

```bash
npm install @google/adk @google/genai
```

## Quick Start

```typescript
import { Ollama } from "adk-ollama";
import { LlmAgent } from "@google/adk";

const llm = new Ollama({ model: "llama3" });

const agent = new LlmAgent({
  name: "my-agent",
  model: llm,
  description: "Agent powered by Ollama",
});
```

## API

### `Ollama`

```typescript
new Ollama(config: OllamaConfig)
```

#### `OllamaConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `model` | `string` | - | Ollama model name (e.g., "llama3", "phi4-mini:3.8b") |
| `baseUrl` | `string` | `http://localhost:11434` | Ollama server URL |
| `timeout` | `number` | `300000` (5 min) | Request timeout in milliseconds |

### Alias

`OllamaLlm` is deprecated - use `Ollama` instead.

## License

MIT
