import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

import {
  RunnableParallel,
  RunnablePassthrough,
} from "@langchain/core/runnables"; // gemma4:e4b qwen3.5:latest glm-5:cloud

const llm = new ChatOllama({
  model: "gemma4:e4b",
  temperature: 0.7,
});

const summarizeChain = ChatPromptTemplate.fromMessages([
  ["system", "Summarize the following topic concisely"],
  ["human", "{topic}"],
])
  .pipe(llm)
  .pipe(new StringOutputParser());

const questionsChain = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Identify 5-10 key terms from the following topic, separated by commas:",
  ],
  ["human", "{topic}"],
])
  .pipe(llm)
  .pipe(new StringOutputParser());

const termsChain = ChatPromptTemplate.fromMessages([
  [
    "system",
    "Identify 5-10 key terms from the following topic, separated by commas:",
  ],
  ["human", "{topic}"],
])
  .pipe(llm)
  .pipe(new StringOutputParser());

const mapChain = RunnableParallel.from({
  summary: summarizeChain,
  questions: questionsChain,
  key_terms: termsChain,
  topic: new RunnablePassthrough(),
});

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

async function runParallelExample(topic: string) {
  console.log(`\n--- Running for: ${topic} ---`);

  try {
    const response = await fullParallelChain.invoke({topic});
    console.log("\n--- Final Response ---");
    console.log(response);
  } catch (err) {
    console.error("Error: ", err);
  }
}

runParallelExample("The history of space exploration");
