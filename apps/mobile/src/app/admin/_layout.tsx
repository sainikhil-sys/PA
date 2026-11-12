import { Stack } from "expo-router";
import { ShieldStarIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView } from "react-native";
import { EmptyState, ErrorState, Screen, Skeleton } from "@/components/ui";
import { useAdminMe } from "@/features/admin/api";
import { BiometricGate, MfaSetupNeeded, StepUpScreen } from "@/features/admin/gates";
import { useAdminToken } from "@/features/admin/token-store";
import { BackHeader } from "@/features/home/header";
import { ApiError, errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/**
 * The admin console on the phone (docs/ADMIN_CONSOLE_PROPOSAL.md 5.2). The server decides who gets in
 * (GET /api/admin/me); then the step-up code, then the optional biometric gate, then the screens.
 */
export default function AdminLayout() {
  const me = useAdminMe();
  const token = useAdminToken((s) => s.token);
  const biometricLocked = useAdminToken((s) => s.biometricLocked);

  if (me.isPending || (me.isError && !me.data)) {
    const notAdmin = me.error instanceof ApiError && me.error.status === 404;
    return (
      <Screen>
        <BackHeader title="Admin console" fallback="/settings" />
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          {me.isPending ? (
            <Skeleton rows={3} />
          ) : notAdmin ? (
            <EmptyState icon={ShieldStarIcon} title="No admin access" body="This account doesn't have an admin role." />
          ) : (
            <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
          )}
        </ScrollView>
      </Screen>
    );
  }
  if (!me.data.mfaEnrolled) return <MfaSetupNeeded />;
  if (!token) return <StepUpScreen me={me.data} />;
  if (biometricLocked) return <BiometricGate />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
