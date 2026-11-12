import { ClipboardTextIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { Button, EmptyState, ErrorState, Skeleton, Txt } from "@/components/ui";
import { useAudit } from "@/features/admin/api";
import { AdminScreen, RequirePermission, shortDateTime } from "@/features/admin/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

const OUTCOME: Record<string, string> = { success: "Done", denied: "Refused", failed: "Failed" };

export default function AdminAudit() {
  return (
    <RequirePermission permission="audit.read" title="Audit log">
      <Audit />
    </RequirePermission>
  );
}

/** Read only, newest first. Filters, the chain check and export are on the website console. */
function Audit() {
  const [page, setPage] = React.useState(1);
  const audit = useAudit(page);
  const d = audit.data;

  return (
    <AdminScreen title="Audit log" onRefresh={() => void audit.refetch()} refreshing={audit.isRefetching}>
      {audit.isPending ? (
        <Skeleton rows={6} />
      ) : audit.isError && !d ? (
        <ErrorState message={errorText(audit.error)} onRetry={() => void audit.refetch()} />
      ) : !d?.rows.length ? (
        <EmptyState icon={ClipboardTextIcon} title="Nothing here yet" body="Admin actions are recorded here as they happen." />
      ) : (
        <Group>
          {d.rows.map((r) => (
            <View key={r.seq} style={{ padding: space.lg, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                <Txt variant="label" style={{ flexShrink: 1 }}>
                  {r.action}
                </Txt>
                <Txt variant="small" style={r.outcome === "success" ? undefined : { color: color.danger }}>
                  {OUTCOME[r.outcome] ?? r.outcome}
                </Txt>
              </View>
              <Txt variant="small" numberOfLines={2}>
                {[r.actorEmail ?? "Deleted account", r.actorRole, shortDateTime(r.createdAt)].filter(Boolean).join("  ·  ")}
              </Txt>
              {r.reason ? (
                <Txt variant="small" numberOfLines={3}>
                  {r.reason}
                </Txt>
              ) : null}
            </View>
          ))}
        </Group>
      )}
      {d && (page > 1 || d.hasMore) ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <Button label="Newer" compact disabled={page <= 1 || audit.isFetching} onPress={() => setPage((p) => Math.max(1, p - 1))} />
          <Txt variant="small">{`Page ${page}`}</Txt>
          <Button label="Older" compact disabled={!d.hasMore || audit.isFetching} onPress={() => setPage((p) => p + 1)} />
        </View>
      ) : null}
      <Txt variant="small">Filters, the integrity check and export are on the website console.</Txt>
    </AdminScreen>
  );
}
