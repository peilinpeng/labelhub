import type { Role } from "../../app/routes";
import { ReviewerWorkspaceView } from "./ReviewerWorkspaceView";
import { useReviewerWorkspaceController } from "./useReviewerWorkspaceController";

interface ReviewerWorkspaceProps {
  role: Role;
}

export default function ReviewerWorkspace({ role: _role }: ReviewerWorkspaceProps) {
  return <ReviewerWorkspaceView controller={useReviewerWorkspaceController()} />;
}
