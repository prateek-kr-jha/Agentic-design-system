```TS
import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import {
  RunnableParallel,
  RunnablePassthrough,
} from "@langchain/core/runnables";

// --- LLM (Ollama local model) ---
const llm = new ChatOllama({
  model: "qwen2.5-coder:7b", // change if needed
  temperature: 0.7,
});

// --- Chains ---

const summarizeChain =
  ChatPromptTemplate.fromMessages([
    ["system", "Summarize the following topic concisely:"],
    ["human", "{topic}"],
  ])
    .pipe(llm)
    .pipe(new StringOutputParser());

const questionsChain =
  ChatPromptTemplate.fromMessages([
    ["system", "Generate three interesting questions about the following topic:"],
    ["human", "{topic}"],
  ])
    .pipe(llm)
    .pipe(new StringOutputParser());

const termsChain =
  ChatPromptTemplate.fromMessages([
    ["system", "Identify 5-10 key terms from the following topic, separated by commas:"],
    ["human", "{topic}"],
  ])
    .pipe(llm)
    .pipe(new StringOutputParser());

// --- Parallel execution ---
const mapChain = RunnableParallel.from({
  summary: summarizeChain,
  questions: questionsChain,
  key_terms: termsChain,
  topic: new RunnablePassthrough(),
});

// --- Final synthesis ---
const synthesisPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Based on the following information:
Summary: {summary}
Related Questions: {questions}
Key Terms: {key_terms}
Synthesize a comprehensive answer.`,
  ],
  ["human", "Original topic: {topic}"],
]);

const fullParallelChain = mapChain
  .pipe(synthesisPrompt)
  .pipe(llm)
  .pipe(new StringOutputParser());

// --- Run ---
async function runParallelExample(topic) {
  console.log(`\n--- Running for: ${topic} ---`);

  try {
    const response = await fullParallelChain.invoke(topic);
    console.log("\n--- Final Response ---");
    console.log(response);
  } catch (err) {
    console.error("Error:", err);
  }
}

// --- Test ---
runParallelExample("The history of space exploration");
```