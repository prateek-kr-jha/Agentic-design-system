```TS
import { LlmAgent, ParallelAgent, SequentialAgent } from "google-adk";
import { google_search } from "google-adk/tools";

// 🔁 Replace Gemini with Ollama model
const OLLAMA_MODEL = "qwen2.5-coder:7b";

// Optional: base config if SDK supports it
const BASE_CONFIG = {
  baseUrl: "http://localhost:11434",
};

/**
 * 1. Researcher Agents (Parallel)
 */

const researcherAgent1 = new LlmAgent({
  name: "RenewableEnergyResearcher",
  model: OLLAMA_MODEL,
  ...BASE_CONFIG,
  instruction: `You are an AI Research Assistant specializing in energy.
Research the latest advancements in 'renewable energy sources'.
Use the Google Search tool provided.
Summarize your key findings concisely (1-2 sentences).
Output *only* the summary.`,
  tools: [google_search],
  outputKey: "renewable_energy_result",
});

const researcherAgent2 = new LlmAgent({
  name: "EVResearcher",
  model: OLLAMA_MODEL,
  ...BASE_CONFIG,
  instruction: `You are an AI Research Assistant specializing in transportation.
Research the latest developments in 'electric vehicle technology'.
Use the Google Search tool provided.
Summarize your key findings concisely (1-2 sentences).
Output *only* the summary.`,
  tools: [google_search],
  outputKey: "ev_technology_result",
});

const researcherAgent3 = new LlmAgent({
  name: "CarbonCaptureResearcher",
  model: OLLAMA_MODEL,
  ...BASE_CONFIG,
  instruction: `You are an AI Research Assistant specializing in climate solutions.
Research the current state of 'carbon capture methods'.
Use the Google Search tool provided.
Summarize your key findings concisely (1-2 sentences).
Output *only* the summary.`,
  tools: [google_search],
  outputKey: "carbon_capture_result",
});

/**
 * 2. Parallel Agent
 */
const parallelResearchAgent = new ParallelAgent({
  name: "ParallelWebResearchAgent",
  subAgents: [researcherAgent1, researcherAgent2, researcherAgent3],
});

/**
 * 3. Merger Agent
 */
const mergerAgent = new LlmAgent({
  name: "SynthesisAgent",
  model: OLLAMA_MODEL,
  ...BASE_CONFIG,
  instruction: `You are an AI Assistant responsible for combining research findings into a structured report.

ONLY use the provided inputs. Do NOT add external knowledge.

Inputs:
- Renewable Energy: {renewable_energy_result}
- EV: {ev_technology_result}
- Carbon Capture: {carbon_capture_result}

Output format:

## Summary of Recent Sustainable Technology Advancements

### Renewable Energy Findings
...

### Electric Vehicle Findings
...

### Carbon Capture Findings
...

### Overall Conclusion
(1-2 sentences only)

Return ONLY the report.`,
});

/**
 * 4. Sequential Orchestrator
 */
export const rootAgent = new SequentialAgent({
  name: "ResearchAndSynthesisPipeline",
  subAgents: [parallelResearchAgent, mergerAgent],
});
```