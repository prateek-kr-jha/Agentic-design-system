import { LlmAgent, ParallelAgent, SequentialAgent } from "@google/adk";
import { Ollama } from "adk-ollama";

/**
 * Shared Ollama model instance.
 * The BaseLlm instance is stateless and safe to reuse across agents.
 */
const model = new Ollama({
  model: "deepseek-v3.2:cloud",
  baseUrl: "http://localhost:11434",
});

/**
 * Research Agents
 */

const researcherAgent1 = new LlmAgent({
  name: "RenewableEnergyResearcher",
  model,
  instruction: `Summarize the latest renewable energy advancements in 1-2 sentences. Use only your training knowledge.`,
  outputKey: "renewable_energy_result",
});

const researcherAgent2 = new LlmAgent({
  name: "EVResearcher",
  model,
  instruction: `Summarize the latest EV technology developments in 1-2 sentences. Use only your training knowledge.`,
  outputKey: "ev_technology_result",
});

const researcherAgent3 = new LlmAgent({
  name: "CarbonCaptureResearcher",
  model,
  instruction: `Summarize current carbon capture methods in 1-2 sentences. Use only your training knowledge.`,
  outputKey: "carbon_capture_result",
});

/**
 * Parallel
 */
const parallelResearchAgent = new ParallelAgent({
  name: "ParallelWebResearchAgent",
  subAgents: [researcherAgent1, researcherAgent2, researcherAgent3],
});

/**
 * Merger
 */
const mergerAgent = new LlmAgent({
  name: "SynthesisAgent",
  model,
  instruction: `
Combine the provided research inputs into a structured report.
Do NOT add external knowledge — only use what is given.

Inputs:
- Renewable Energy: {renewable_energy_result}
- EV: {ev_technology_result}
- Carbon Capture: {carbon_capture_result}

Output format:

## Summary

### Renewable Energy
...

### EV
...

### Carbon Capture
...

### Conclusion
`,
});

/**
 * Pipeline
 */
export const rootAgent = new SequentialAgent({
  name: "ResearchAndSynthesisPipeline",
  subAgents: [parallelResearchAgent, mergerAgent],
});
