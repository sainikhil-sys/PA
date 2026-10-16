import { z } from "zod";

/** Structured outputs returned by agents. Agents have NO tools: they only return these. */

export const emailClassificationSchema = z.object({
  category: z
    .string()
    .transform((s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_"))
    .pipe(z.enum(["URGENT", "REPLY_NEEDED", "FYI", "NEWSLETTER", "SPAM"])),
  summary: z
    .string()
    .min(1)
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, 200)),
  priority: z.coerce.number().int().min(1).max(5),
  // z.coerce.boolean() would turn "false" into true; accept common model spellings explicitly.
  action_required: z.preprocess(
    (v) => (typeof v === "string" ? ["true", "yes", "1"].includes(v.trim().toLowerCase()) : v),
    z.boolean(),
  ),
});
export type EmailClassification = z.infer<typeof emailClassificationSchema>;

export const briefingSchema = z.object({
  headline: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  priorities: z.array(z.string().min(1).max(200)).max(6).default([]),
});
export type BriefingDraft = z.infer<typeof briefingSchema>;
