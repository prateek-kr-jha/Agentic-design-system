import {
  LlmAgent,
  SequentialAgent,
  ParallelAgent
} from '@google/adk';

import { Ollama } from 'adk-ollama';

const model = new Ollama({
    model: 'gemma4:e4b',
    baseUrl: "http://localhost:11434",
})

/**
 * --- Research Agents (Parallel) ---
 */

const renewableEnergyAgent = new LlmAgent({
  name: "RenewableEnergyResearcher",
  model,
  instruction: `
You are an AI Research Assistant specializing in energy.
Research the latest advancements in renewable energy sources.
Summarize key findings concisely (1-2 sentences).
Output ONLY the summary.
`,
  outputKey: "renewable_energy_result",
});

const evAgent = new LlmAgent({
  name: "EVResearcher",
  model,
  instruction: `
You are an AI Research Assistant specializing in transportation.
Research the latest developments in electric vehicle technology.
Summarize key findings concisely (1-2 sentences).
Output ONLY the summary.
`,
  outputKey: "ev_technology_result",
});

const carbonCaptureAgent = new LlmAgent({
  name: "CarbonCaptureResearcher",
  model,
  instruction: `
You are an AI Research Assistant specializing in climate solutions.
Research the current state of carbon capture methods.
Summarize key findings concisely (1-2 sentences).
Output ONLY the summary.
`,
  outputKey: "carbon_capture_result",
});

/**
 * --- Parallel Agent ---
 */
const parallelResearchAgent = new ParallelAgent({
  name: "ParallelWebResearchAgent",
  subAgents: [
    renewableEnergyAgent,
    evAgent,
    carbonCaptureAgent,
  ],
});

/**
 * --- Merger Agent ---
 */
const mergerAgent = new LlmAgent({
  name: "SynthesisAgent",
  model,
  instruction: `
Combine the provided research inputs into a structured report.
Do NOT add external knowledge.

Inputs:
- Renewable Energy: {renewable_energy_result}
- EV: {ev_technology_result}
- Carbon Capture: {carbon_capture_result}

Output format:

## Summary of Recent Sustainable Technology Advancements

### Renewable Energy Findings
{renewable_energy_result}

### Electric Vehicle Findings
{ev_technology_result}

### Carbon Capture Findings
{carbon_capture_result}

### Overall Conclusion
Provide a brief (1-2 sentence) conclusion connecting the findings.

Output ONLY the structured report.
`,
});

/**
 * --- Sequential Pipeline ---
 */
export const rootAgent = new SequentialAgent({
  name: "ResearchAndSynthesisPipeline",
  description: "Runs parallel research and merges results",
  subAgents: [parallelResearchAgent, mergerAgent],
});