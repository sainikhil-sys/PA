import "server-only";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth/policy";
import { getOwner } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";

/** Admin-only pages answer 404 to everyone else, so the console's existence isn't revealed. */
export async function requireAdmin(): Promise<User> {
  const user = await getOwner();
  if (!user || !isAdmin(user.email)) notFound();
  return user;
}
