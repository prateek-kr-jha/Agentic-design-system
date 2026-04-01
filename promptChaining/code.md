```js
const getFeedbackTagsAndConfig = async (input) => {
    let respObj = null;
    try {
        const feedbackTagsFromFlowId = await feedbackAndVocModel.getFeedbackTagsFromFlowId(input.flowId);
        if (!feedbackTagsFromFlowId || feedbackTagsFromFlowId.length === 0) return null;

        const activeToken = await getActiveTokenDetails(input.userId, input.jwtToken);
        if (!activeToken) return null;

        const activeYcIds = process.env.APP_ENV !== 'CUSTOMER-APP-PROD' ? [7535] : [7745, 8171];
        const allowedTokenTypes = [ycTokenTypes.ATTACH, ycTokenTypes.SERVICE];
        const allowedTokenStatus = [ycTokenStatus.checkedin, ycTokenStatus.active, ycTokenStatus.fulfilled];

        if (!allowedTokenTypes.includes(activeToken.token_type_id) ||
            !allowedTokenStatus.includes(activeToken.token_status_id) ||
            !activeYcIds.includes(activeToken.yz_id)) {
            return null;
        }

        respObj = {
            cross: { action: "close_sheet", visibility: true },
            primaryCta: { action: "submit_selected_issues", title: "Submit" },
            subtitle: "Choose what's not working",
            title: "Report bike issues",
            tags: [],
            uiVersionType: "hybrid_component",
            specialInputConfig: []
        };

        const userCohortMap = { TAG_BASED: 1, HYBRID_COMPONENT: 2, SPECIAL_COMPONENT: 3 };
        const userCohort = checkUserCohortForFeedback(input.userId);

        respObj.uiVersionType =
            userCohort === userCohortMap.TAG_BASED ? 'tag_based' :
            userCohort === userCohortMap.HYBRID_COMPONENT ? 'hybrid_component' : 'special_component';

        for (const tag of feedbackTagsFromFlowId) {
            const tagDetails = {
                title: tag.feedback_str,
                id: tag.id,
                type: tag.tag_type
            };

            if (tag.tag_type === 'RECORD') {
                const s3UploadUrl = await commonHelper.generateVocS3Url(input.flowName || 'yc_token');
                if (s3UploadUrl) {
                    respObj.specialInputConfig.push({
                        title: "Record issues",
                        uploadUrl: [s3UploadUrl],
                        id: tag.id,
                        type: tag.tag_type,
                        maxDurationInSec: 60,
                        placeholder: "Tap to record"
                    });
                }
            }

            if ((userCohort === userCohortMap.HYBRID_COMPONENT && tag.tag_type !== 'RECORD') ||
                userCohort === userCohortMap.TAG_BASED) {
                respObj.tags.push(tagDetails);
            }
        }

        return respObj;

    } catch (e) {
        logger(e, "error in getFeedbackTagsAndConfig", "error");
        return null;
    }
};
```

```js
const getFeedbackTagsAndConfig = async (input) => {
  // Validate required inputs
  if (!input?.flowId || !input?.userId || !input?.jwtToken) {
    logger('Missing required input parameters', 'error');
    return null;
  }

  let respObj = null;
  try {
    const feedbackTagsFromFlowId = await feedbackAndVocModel.getFeedbackTagsFromFlowId(input.flowId);
    if (!feedbackTagsFromFlowId || feedbackTagsFromFlowId.length === 0) {
      return respObj;
    }

    const activeToken = await getActiveTokenDetails(input.userId, input.jwtToken);

    // Configure activeYcIds based on environment
    const activeYcIds = process.env.APP_ENV === 'CUSTOMER-APP-PROD' ? [7745, 8171] : [7535];
    const allowedTokenTypes = [ycTokenTypes.ATTACH, ycTokenTypes.SERVICE];
    const allowedTokenStatus = [ycTokenStatus.checkedin, ycTokenStatus.active, ycTokenStatus.fulfilled];

    // Validate token
    if (!activeToken ||
        !allowedTokenTypes.includes(activeToken.token_type_id) ||
        !allowedTokenStatus.includes(activeToken.token_status_id) ||
        !activeYcIds.includes(activeToken.yz_id)) {
      return null;
    }

    // Initialize response object
    respObj = {
      cross: { action: 'close_sheet', visibility: true },
      primaryCta: { action: 'submit_selected_issues', title: 'Submit' },
      subtitle: "Choose what's not working",
      title: "Report bike issues",
      tags: [],
      uiVersionType: 'hybrid_component',
      specialInputConfig: []
    };

    // Determine UI version type based on user cohort
    const userCohort = checkUserCohortForFeedback(input.userId);
    const userCohortMap = { TAG_BASED: 1, HYBRID_COMPONENT: 2, SPECIAL_COMPONENT: 3 };
    respObj.uiVersionType = userCohort === userCohortMap.TAG_BASED
      ? 'tag_based'
      : userCohort === userCohortMap.HYBRID_COMPONENT
        ? 'hybrid_component'
        : 'special_component';

    // Process each feedback tag
    for (const tag of feedbackTagsFromFlowId) {
      const tagDetails = {
        title: tag?.feedback_str,
        id: tag?.id,
        type: tag?.tag_type
      };

      if (tag.tag_type === 'RECORD') {
        try {
          const s3UploadUrl = await commonHelper.generateVocS3Url(input.flowName || 'yc_token');
          if (s3UploadUrl) {
            const uploadUrl = Array.isArray(s3UploadUrl) ? s3UploadUrl : [s3UploadUrl];
            const recordConfig = {
              title: "Record issues",
              uploadUrl,
              id: tag.id,
              type: tag.tag_type,
              maxDurationInSec: 60,
              placeholder: "Tap to record"
            };
            respObj.specialInputConfig.push(recordConfig);
          }
        } catch (s3Error) {
          logger(s3Error, 'Failed to generate S3 URL for RECORD tag', 'error');
          // Continue processing other tags even if S3 URL generation fails
        }
      }

      // Add tag to tags array based on cohort and tag type
      if ((userCohort === userCohortMap.HYBRID_COMPONENT && tag.tag_type !== 'RECORD') ||
          userCohort === userCohortMap.TAG_BASED) {
        respObj.tags.push(tagDetails);
      }
    }

    return respObj;
  } catch (e) {
    logger(e, 'Error in getFeedbackTagsAndConfig', 'error');
    return respObj;
  }
};
```



```javascript
/**
 * Fetches feedback tags and UI configuration for the feedback flow.
 * Validates user, token, and flow context before constructing the response.
 * Supports cohort-based UI rendering (tag_based, hybrid_component, special_component).
 */
const getFeedbackTagsAndConfig = async (input) => {
    try {
        // ✅ Validate required inputs early
        if (
            !input?.flowId ||
            !input?.userId ||
            !input?.jwtToken ||
            !input?.flowName
        ) {
            return null;
        }

        // 📥 Fetch feedback tags associated with the flow
        const feedbackTagsFromFlowId = await feedbackAndVocModel.getFeedbackTagsFromFlowId(input.flowId);
        if (!feedbackTagsFromFlowId || feedbackTagsFromFlowId.length === 0) {
            return null;
        }

        // 🔐 Validate active token (user + JWT + environment-specific YC IDs)
        const activeToken = await getActiveTokenDetails(input.userId, input.jwtToken);
        if (!activeToken) return null;

        const activeYcIds = process.env.APP_ENV !== 'CUSTOMER-APP-PROD' ? [7535] : [7745, 8171];
        const allowedTokenTypes = [ycTokenTypes.ATTACH, ycTokenTypes.SERVICE];
        const allowedTokenStatus = [ycTokenStatus.checkedin, ycTokenStatus.active, ycTokenStatus.fulfilled];

        if (
            !allowedTokenStatus.includes(activeToken.token_status_id) ||
            !allowedTokenTypes.includes(activeToken.token_type_id) ||
            !activeYcIds.includes(activeToken.yz_id)
        ) {
            return null;
        }

        // 👥 Determine user cohort (with fallback for safety)
        const userCohortMap = {
            TAG_BASED: 1,
            HYBRID_COMPONENT: 2,
            SPECIAL_COMPONENT: 3
        };

        let userCohort;
        try {
            userCohort = checkUserCohortForFeedback(input.userId);
        } catch {
            userCohort = userCohortMap.HYBRID_COMPONENT; // fallback to hybrid
        }

        // 🎨 Map cohort to UI version type
        const uiVersionType =
            userCohort === userCohortMap.TAG_BASED
                ? 'tag_based'
                : userCohort === userCohortMap.HYBRID_COMPONENT
                    ? 'hybrid_component'
                    : 'special_component';

        // 🧱 Initialize response object (with all required fields)
        const respObj = {
            cross: { action: "close_sheet", visibility: true },
            primaryCta: { action: "submit_selected_issues", title: "Submit" },
            subtitle: "Choose what's not working",
            title: "Report bike issues",
            tags: [],
            uiVersionType,
            specialInputConfig: [] // ✅ Pre-initialized to avoid undefined errors
        };

        // 📋 Process each feedback tag
        for (const tag of feedbackTagsFromFlowId) {
            if (!tag) continue;

            const tag_details = {
                title: tag.feedback_str ?? null,
                id: tag.id ?? null,
                type: tag.tag_type ?? null
            };

            // 🎙️ Handle RECORD-type tags (e.g., audio/video recording)
            if (tag.tag_type === 'RECORD') {
                try {
                    const s3UploadUrl = await commonHelper.generateVocS3Url(input.flowName);
                    // Safely normalize to array (handles both string and array responses)
                    const uploadUrl = Array.isArray(s3UploadUrl) ? s3UploadUrl : [s3UploadUrl];

                    if (uploadUrl.length > 0) {
                        respObj.specialInputConfig.push({
                            title: "Record issues",
                            uploadUrl,
                            id: tag.id,
                            type: tag.tag_type,
                            maxDurationInSec: 60,
                            placeholder: "Tap to record"
                        });
                    }
                } catch {
                    // Skip record config on error (non-critical)
                }
            }

            // 🧩 Add tag to UI if allowed by cohort
            if (
                (userCohort === userCohortMap.HYBRID_COMPONENT && tag.tag_type !== 'RECORD') ||
                userCohort === userCohortMap.TAG_BASED
            ) {
                respObj.tags.push(tag_details);
            }
        }

        return respObj;
    } catch (e) {
        logger(e, "error in getFeedbackTagsAndConfig", "error");
        return null;
    }
};
```