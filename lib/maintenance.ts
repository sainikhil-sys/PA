/**
 * Maintenance mode. Set MAINTENANCE_MODE=on in the Vercel project and redeploy: web pages show
 * /maintenance (public pages stay readable) and API routes answer 503 with code "maintenance",
 * so the app can say so instead of failing. Edge-safe: no imports.
 */
export const MAINTENANCE_MESSAGE = "Cowork is being updated and will be back shortly. Try again in a few minutes.";

export function maintenanceOn(): boolean {
  return process.env.MAINTENANCE_MODE === "on";
}

/** Pages that stay reachable during maintenance (legal pages must always be readable). */
export const MAINTENANCE_OPEN_PATHS = ["/maintenance", "/home", "/privacy", "/terms", "/help", "/delete-account"];

export function maintenanceResponse(): Response {
  return Response.json(
    { error: MAINTENANCE_MESSAGE, code: "maintenance" },
    { status: 503, headers: { "retry-after": "300", "cache-control": "no-store" } },
  );
}
