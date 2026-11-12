import { adminRoute } from "@/lib/admin/adapters";
import { setUserDisabledOp } from "@/lib/admin/ops/legacy";

export const dynamic = "force-dynamic";

/** Body: { disabled: boolean }. Suspending also signs the person out everywhere. */
export const POST = adminRoute(setUserDisabledOp, "POST");
