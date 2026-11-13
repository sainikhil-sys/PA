"use server";

import { adminAction } from "@/lib/admin/adapters";
import { revealAnonymousAuthorOp } from "@/lib/admin/ops/anonymous";

/** Reveal the account behind a reported anonymous post or comment (anonymous.reveal; audited). */
export const revealAnonymousAuthor = adminAction(revealAnonymousAuthorOp);
