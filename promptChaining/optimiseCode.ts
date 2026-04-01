import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableMap } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import * as z from "zod";


const llm = new ChatOllama({
  model: "qwen3-coder-next:cloud",
  temperature: 0,
  maxRetries: 2,
  repeatPenalty: 1.1,
    maxTokens: 300, 
});

let code = `const getFeedbackTagsAndConfig = async (input) => {
    let respObj = null;
    try {
        const feedbackTagsFromFlowId = await feedbackAndVocModel.getFeedbackTagsFromFlowId(input.flowId);
        if(!feedbackTagsFromFlowId || feedbackTagsFromFlowId.length == 0) {
            return respObj;
        }
        
        const activeToken = await getActiveTokenDetails(input.userId, input.jwtToken);

        let activeYcIds = [7745, 8171];
        if(process.env.APP_ENV !== 'CUSTOMER-APP-PROD') {
            activeYcIds = [7535];
        }
        const allowedTokenTypes = [ycTokenTypes.ATTACH, ycTokenTypes.SERVICE];
        const allowedTokeStatus = [ycTokenStatus.checkedin, ycTokenStatus.active, ycTokenStatus.fulfilled];
        
        
        if(!activeToken || !allowedTokeStatus.includes(activeToken.token_status_id) || !allowedTokenTypes.includes(activeToken.token_type_id) || !activeYcIds.includes(activeToken.yz_id)) {
            return null;
        }

		

        respObj = {
            cross: {
                "action": "close_sheet",
                "visibility": true
            },
            primaryCta: {
                "action": "submit_selected_issues",
                "title": "Submit"
            },
            subtitle: "Choose what's not working",
            title: "Report bike issues",
            tags: [],
            uiVersionType: "hybrid_component",
            specialInputConfig: []
        }
        
        const userCohortMap = {
            TAG_BASED: 1,
            HYBRID_COMPONENT: 2,
            SPECIAL_COMPONENT: 3
        }

        const userCohort = checkUserCohortForFeedback(input.userId);

        respObj.uiVersionType = userCohort == userCohortMap.TAG_BASED
            ? 'tag_based' : (userCohort == userCohortMap.HYBRID_COMPONENT
                ? 'hybrid_component' : 'special_component');
        for (let i = 0; i < feedbackTagsFromFlowId.length; i++) {
            const tag_details = {
                "title": feedbackTagsFromFlowId[i]?.feedback_str,
                "id": feedbackTagsFromFlowId[i]?.id,
                "type": feedbackTagsFromFlowId[i]?.tag_type
            }

            if (feedbackTagsFromFlowId[i].tag_type == 'RECORD') {
                // IMP: if a case comes where multiple files have to be uploaded: ask can same url be used to upload multiple files with different file names
                const s3UploadUrl = await commonHelper.generateVocS3Url(input.flowName ? input.flowName : 'yc_token');
                const uploadUrl = [];
                if (s3UploadUrl && s3UploadUrl.length) {
                    uploadUrl.push(s3UploadUrl);
                    const recordConfig = {
                        title: "Record issues",
                        uploadUrl,
                        id: feedbackTagsFromFlowId[i]?.id,
                        type: feedbackTagsFromFlowId[i].tag_type,
                        maxDurationInSec: 60,
                        placeholder: "Tap to record"
                    }
                    respObj.specialInputConfig.push(recordConfig);
                }

            }
            if ((userCohort == userCohortMap.HYBRID_COMPONENT && feedbackTagsFromFlowId[i].tag_type != 'RECORD')|| userCohort == userCohortMap.TAG_BASED) {
                respObj.tags.push(tag_details);
            }
        }

        return respObj;

    } catch (e) {
        logger(e, "error in getFeedbackTagsAndConfig", "error");
        return respObj;
    }
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
.pipe(llm)
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