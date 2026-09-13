import type { Role } from "../../app/routes";
import { ReviewDetailView } from "./ReviewDetailView";
import { useReviewDetailController } from "./useReviewDetailController";

interface ReviewDetailPageProps {
  role: Role;
}

export default function ReviewDetailPage({ role: _role }: ReviewDetailPageProps) {
  return <ReviewDetailView controller={useReviewDetailController()} />;
}
