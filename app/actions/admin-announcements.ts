"use server";

import { adminAction } from "@/lib/admin/adapters";
import { archiveAnnouncementOp, cancelScheduledBroadcastOp, createAnnouncementOp, scheduleBroadcastOp, updateAnnouncementOp } from "@/lib/admin/ops/announcements";

/** Announcements and scheduled broadcasts. Each action only runs a shared op through lib/admin/op.ts. */

export const createAnnouncement = adminAction(createAnnouncementOp);
export const updateAnnouncement = adminAction(updateAnnouncementOp);
export const archiveAnnouncement = adminAction(archiveAnnouncementOp);
export const scheduleBroadcast = adminAction(scheduleBroadcastOp);
export const cancelScheduledBroadcast = adminAction(cancelScheduledBroadcastOp);
