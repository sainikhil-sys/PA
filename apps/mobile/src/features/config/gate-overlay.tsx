import { router, usePathname } from "expo-router";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useAdminMe } from "@/features/admin/api";
import { queryClient } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { color } from "@/theme/tokens";
import { MaintenanceScreen, UpdateRequiredScreen } from "./gate-screens";
import type { Gate } from "./logic";

/**
 * Covers the app with the update or maintenance screen. During maintenance the server still lets role
 * holders in, so an admin can open the console (the admin area is never covered by maintenance) to
 * turn it off. A required update covers everything.
 */
export function GateOverlay({ gate }: { gate: Gate }) {
  const pathname = usePathname();
  const signedIn = useSession((s) => s.status === "signedIn");
  const maintenance = gate.kind === "maintenance";
  const admin = useAdminMe(signedIn && maintenance);
  if (gate.kind === "none" || !gateCovers(gate, pathname)) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: color.bg }]}>
      {gate.kind === "update" ? (
        <UpdateRequiredScreen message={gate.message} storeUrl={gate.storeUrl} />
      ) : (
        <MaintenanceScreen
          message={gate.message}
          endsAt={gate.endsAt}
          onRetry={() => void queryClient.invalidateQueries()}
          onOpenAdmin={admin.isSuccess ? () => router.push("/admin") : undefined}
        />
      )}
    </View>
  );
}

/** True when the overlay covers the screen, so the app underneath is hidden from screen readers. */
export function gateCovers(gate: Gate, pathname: string): boolean {
  if (gate.kind === "none") return false;
  return !(gate.kind === "maintenance" && pathname.startsWith("/admin"));
}
