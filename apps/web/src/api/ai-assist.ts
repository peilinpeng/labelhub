import type {
  AiAssistActionRequest,
  AiAssistActionResponse,
  AiAssistSuggestion,
  ListAiAssistSuggestionsResponse,
} from "@labelhub/contracts";
import { apiGet, apiPost } from "./client";

export async function listAiAssistSuggestions(submissionId: string): Promise<AiAssistSuggestion[]> {
  const res = await apiGet<ListAiAssistSuggestionsResponse>(
    `/api/v1/review/submissions/${submissionId}/ai-assist/suggestions`,
  );
  return res.suggestions;
}

export async function submitAiAssistAction(
  submissionId: string,
  suggestionId: string,
  request: AiAssistActionRequest,
): Promise<AiAssistActionResponse> {
  return apiPost<AiAssistActionResponse>(
    `/api/v1/review/submissions/${submissionId}/ai-assist/${suggestionId}/actions`,
    request,
  );
}
