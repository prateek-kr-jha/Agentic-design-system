```TS
// file: agent-lab/router-agent.js

import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import {
  RunnablePassthrough,
  RunnableBranch,
} from "@langchain/core/runnables";

// --- LLM (Ollama) ---
const llm = new ChatOllama({
  model: "qwen2.5-coder:7b",
  temperature: 0,
});

console.log("LLM initialized:", llm.model);

// --- Sub-agents (same as Python) ---
function bookingHandler(request) {
  console.log("\n--- DELEGATING TO BOOKING HANDLER ---");
  return `Booking Handler processed request: '${request}'. Result: Simulated booking action.`;
}

function infoHandler(request) {
  console.log("\n--- DELEGATING TO INFO HANDLER ---");
  return `Info Handler processed request: '${request}'. Result: Simulated information retrieval.`;
}

function unclearHandler(request) {
  console.log("\n--- HANDLING UNCLEAR REQUEST ---");
  return `Coordinator could not delegate request: '${request}'. Please clarify.`;
}

// --- Router Prompt ---
const routerPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Analyze the user's request and determine which specialist handler should process it.
- If request is related to booking flights or hotels → output "booker"
- For general info questions → output "info"
- If unclear → output "unclear"

ONLY output ONE word: booker, info, or unclear.`,
  ],
  ["user", "{request}"],
]);

// --- Router Chain ---
const routerChain = routerPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());

// --- Branching logic ---
const branches = {
  booker: RunnablePassthrough.assign({
    output: (x) => bookingHandler(x.request),
  }),
  info: RunnablePassthrough.assign({
    output: (x) => infoHandler(x.request),
  }),
  unclear: RunnablePassthrough.assign({
    output: (x) => unclearHandler(x.request),
  }),
};

// --- Delegation ---
const delegationBranch = new RunnableBranch(
  [(x) => x.decision.trim() === "booker", branches.booker],
  [(x) => x.decision.trim() === "info", branches.info],
  branches.unclear // default
);

// --- Coordinator Agent ---
const coordinatorAgent = RunnablePassthrough.assign({
  decision: routerChain,
})
  .assign({
    request: (x) => x.request,
  })
  .pipe(delegationBranch)
  .pipe((x) => x.output);

// --- Main ---
async function main() {
  console.log("\n--- Running booking request ---");
  const resA = await coordinatorAgent.invoke({
    request: "Book me a flight to London",
  });
  console.log("Final Result A:", resA);

  console.log("\n--- Running info request ---");
  const resB = await coordinatorAgent.invoke({
    request: "What is the capital of Italy?",
  });
  console.log("Final Result B:", resB);

  console.log("\n--- Running unclear request ---");
  const resC = await coordinatorAgent.invoke({
    request: "Tell me about quantum physics",
  });
  console.log("Final Result C:", resC);
}

main();
```