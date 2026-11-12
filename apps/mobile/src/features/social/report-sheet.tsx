import { CheckIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Input, Txt } from "@/components/ui";
import { errorText } from "@/lib/api";
import { color, radius, space, TOUCH } from "@/theme/tokens";
import { useFeedReport } from "@/features/feed/api";
import { useReport } from "./api";
import { REPORT_REASONS, type ReportReason } from "./types";

/** Report a person, message or group. Reports go to Cowork's moderators, never to the person. */
/** Posts and comments go to the feed's report queue; people, messages and chats to Chats'. */
export function ReportSheet({ target, onClose }: { target: { userId?: string; messageId?: string; threadId?: string; postId?: string; commentId?: string; label: string } | null; onClose: () => void }) {
  const chatReport = useReport();
  const feedReport = useFeedReport();
  const isFeed = Boolean(target?.postId || target?.commentId);
  const report = isFeed ? feedReport : chatReport;
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [details, setDetails] = React.useState("");
  const close = () => {
    setReason(null);
    setDetails("");
    chatReport.reset();
    feedReport.reset();
    onClose();
  };
  return (
    <Sheet open={Boolean(target)} onClose={close} title={report.isSuccess ? "Report sent" : `Report ${target?.label ?? ""}`}>
      {report.isSuccess ? (
        <>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <CheckIcon size={20} color={color.success} />
            <Txt variant="bodyMuted" style={{ flex: 1 }}>
              {"Thanks. Cowork's moderators will review it. The person isn't told who reported them. You can also block them from their profile or the chat details."}
            </Txt>
          </View>
          <Button label="Done" variant="primary" onPress={close} />
        </>
      ) : (
        <>
          <Txt variant="small">Why are you reporting this? The reported message text is kept for the review even if it is deleted later.</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: space.xs }}>
            {REPORT_REASONS.map((r) => {
              const on = reason === r.key;
              return (
                <Pressable
                  key={r.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setReason(r.key)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: TOUCH - 4, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.border, backgroundColor: pressed ? color.surface2 : color.bg })}
                >
                  <Txt variant="label" style={{ flex: 1 }}>
                    {r.label}
                  </Txt>
                  {on ? <CheckIcon size={18} color={color.accentText} weight="bold" /> : null}
                </Pressable>
              );
            })}
          </View>
          <Input placeholder="Anything else moderators should know (optional)" value={details} onChangeText={setDetails} maxLength={1000} multiline />
          {report.isError ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {errorText(report.error)}
            </Txt>
          ) : null}
          <Button
            label="Send report"
            variant="primary"
            disabled={!reason}
            loading={report.isPending}
            onPress={() => {
              if (!target || !reason) return;
              const extra = details.trim() || undefined;
              if (isFeed) feedReport.mutate({ postId: target.postId, commentId: target.commentId, reason, details: extra });
              else chatReport.mutate({ userId: target.userId, messageId: target.messageId, threadId: target.threadId, reason, details: extra });
            }}
          />
        </>
      )}
    </Sheet>
  );
}
