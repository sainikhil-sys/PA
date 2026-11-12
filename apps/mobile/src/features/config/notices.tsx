import { router, type Href } from "expo-router";
import { ArrowCircleUpIcon, InfoIcon, WarningCircleIcon, WarningIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { Linking, Pressable, View } from "react-native";
import { Button, IconButton, Txt } from "@/components/ui";
import { color, radius, space } from "@/theme/tokens";
import type { Announcement } from "./logic";
import { useClientConfigStore } from "./store";
import { useHomeNotices } from "./use-client-config";

function severityIcon(a: Announcement) {
  if (a.severity === "critical") return <WarningCircleIcon size={20} color={color.danger} />;
  if (a.severity === "warning") return <WarningIcon size={20} color={color.warning} />;
  return <InfoIcon size={20} color={color.accentText} />;
}

/** In-app paths only (the server checks this too); anything else is ignored. */
function openHref(href: string | null) {
  if (href && /^\/(?!\/)/.test(href)) router.push(href as Href);
}

function AnnouncementView({ a, compact }: { a: Announcement; compact: boolean }) {
  const dismiss = useClientConfigStore((s) => s.dismissAnnouncement);
  const body = (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, padding: compact ? space.md : space.lg }}>
      <View style={{ paddingTop: 2 }}>{severityIcon(a)}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label">{a.title}</Txt>
        <Txt variant="small" numberOfLines={compact ? 3 : undefined}>
          {a.body}
        </Txt>
        {a.href ? (
          <Txt variant="small" style={{ color: color.accentText }}>
            Open
          </Txt>
        ) : null}
      </View>
      {a.dismissible ? <IconButton icon={XIcon} tone="plain" label={`Hide "${a.title}"`} onPress={() => dismiss(a.id)} /> : null}
    </View>
  );
  const frame = { backgroundColor: color.surface, borderRadius: compact ? radius.control : radius.card, borderWidth: 1, borderColor: a.severity === "critical" ? color.danger : color.border };
  if (!a.href) return <View style={frame}>{body}</View>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${a.title}. ${a.body}`} onPress={() => openHref(a.href)} style={({ pressed }) => [frame, pressed && { backgroundColor: color.surface2 }]}>
      {body}
    </Pressable>
  );
}

/** Banners go at the top of Home, Home cards in the Today section; both come from /api/config. */
export function AnnouncementBanners() {
  const { announcements } = useHomeNotices();
  const list = announcements.filter((a) => a.placement === "banner");
  if (!list.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {list.map((a) => (
        <AnnouncementView key={a.id} a={a} compact />
      ))}
    </View>
  );
}

export function HomeNoticeCards() {
  const { update, announcements } = useHomeNotices();
  const dismissUpdate = useClientConfigStore((s) => s.dismissUpdate);
  const cards = announcements.filter((a) => a.placement === "home_card");
  if (!update && !cards.length) return null;
  const storeUrl = update?.storeUrl ?? null;
  return (
    <View style={{ gap: space.md }}>
      {update ? (
        <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
            <ArrowCircleUpIcon size={22} color={color.accentText} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">{update.latestVersion ? `Cowork ${update.latestVersion} is available` : "A new version of Cowork is available"}</Txt>
              <Txt variant="small">{update.message || "Update from the Play Store when it suits you."}</Txt>
            </View>
            <IconButton icon={XIcon} tone="plain" label="Hide this update notice" onPress={dismissUpdate} />
          </View>
          {storeUrl && /^(https:\/\/|market:\/\/)/i.test(storeUrl) ? <Button label="Get the update" compact onPress={() => void Linking.openURL(storeUrl).catch(() => {})} /> : null}
        </View>
      ) : null}
      {cards.map((a) => (
        <AnnouncementView key={a.id} a={a} compact={false} />
      ))}
    </View>
  );
}
