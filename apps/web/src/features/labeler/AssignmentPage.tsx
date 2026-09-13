import type { Role } from "../../app/routes";
import { AssignmentPageView } from "./AssignmentPageView";
import { useAssignmentController } from "./useAssignmentController";

interface AssignmentPageProps {
  role: Role;
}

export default function AssignmentPage({ role: _role }: AssignmentPageProps) {
  return <AssignmentPageView controller={useAssignmentController()} />;
}
