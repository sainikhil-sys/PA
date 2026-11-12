import { adminRoute } from "@/lib/admin/adapters";
import { auditExportOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Owner only. Body: the audit filters. Returns { filename, csv, rows, truncated }; the export is audited. */
export const POST = adminRoute(auditExportOp, "POST");
