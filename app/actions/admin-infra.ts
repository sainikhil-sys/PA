"use server";

import { adminAction } from "@/lib/admin/adapters";
import { infraProbesOp } from "@/lib/admin/ops/infra";

/** Measures the live probes again ("Measure again" on Infrastructure). Read only. */
export const measureInfra = adminAction(infraProbesOp);
