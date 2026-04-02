import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableMap } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import * as z from "zod";


const llm = new ChatOllama({
  model: "glm-4.6:cloud",// phi3.5:3.8b 
  temperature: 0,
  maxRetries: 2,
  repeatPenalty: 1.1,
    maxTokens: 300, 
});

const codeLLm = new ChatOllama({
  model: "glm-4.6:cloud",
  temperature: 0,
  maxRetries: 2,
  repeatPenalty: 1.1,
    maxTokens: 300, 
});

let code = `function x(a, b) {
    let y = 0;
    for(let i = 0; i < b; i++) {
        y += a;
    }

    return y;
}`;


const promptSummarise = ChatPromptTemplate.fromTemplate(
    `Summarise. and list bugs
    Return ONLY the final answer.
Do NOT explain your reasoning.
Be concise.
    '''code'''
    {code}
    '''`
);

const promptOptimsie = ChatPromptTemplate.fromTemplate(
    `"Optimise code and fix listed bugs: Code Summary {specifications}"
    Return ONLY the final answer.
Do NOT explain your reasoning.
Be concise.
    - give minimal most optimized code
    - proper error handling
    - add what changes you made
    '''code'''
    {code}
    '''`
);

const promptImproveReadadbility = ChatPromptTemplate.fromTemplate(
    `"improve readabilty"
add what changed that you reived in prompt as it is
Add code summary at the end of the code
    '''code'''
    {code}
    '''`
);



const summariseChain = promptSummarise.pipe(llm).pipe(new StringOutputParser());
const optimiseChain = RunnableMap.from({
    specifications: summariseChain,
    code: (input) => input.code
})
.pipe(promptOptimsie)
.pipe(codeLLm)
.pipe(new StringOutputParser());

const fullChain = RunnableMap.from({
    code: optimiseChain
})
  .pipe(promptImproveReadadbility)
  .pipe(llm)
  .pipe(new StringOutputParser());

const result = await fullChain.invoke({
    code
});
console.log(result);