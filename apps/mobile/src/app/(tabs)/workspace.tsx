import { router, type Href } from "expo-router";
import { CalendarDotsIcon, CaretRightIcon, CheckSquareIcon, FileTextIcon, LinkSimpleIcon, NotebookIcon, NotePencilIcon, PlusSquareIcon, SealCheckIcon, UploadSimpleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { CountBadge, Divider, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { useMe, useTasks } from "@/lib/queries";
import { color, radius, space } from "@/theme/tokens";

type Place = { key: string; icon: Icon; title: string; detail: string; href: Href; count?: number };

/** Workspace: everything you keep and plan, in one place. Counts come from your real data. */
export default function WorkspaceTab() {
  const bottom = useTabBarSpace();
  const tasks = useTasks();
  const me = useMe();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([tasks.refetch(), me.refetch()]);
    setRefreshing(false);
  }, [tasks, me]);

  const open = tasks.data?.length;
  const pending = me.data?.pendingApprovals ?? 0;
  const groups: { title: string; items: Place[] }[] = [
    {
      title: "Capture",
      items: [
        { key: "new-task", icon: PlusSquareIcon, title: "New task", detail: "In plain words, like \"call the bank tomorrow 10am\"", href: "/tasks?add=1" },
        { key: "new-note", icon: NotePencilIcon, title: "New note", detail: "Your assistant can search it", href: "/notes/new" },
        { key: "link", icon: LinkSimpleIcon, title: "Save a link", detail: "Keep a page with its title and summary", href: "/notes?link=1" },
        { key: "upload", icon: UploadSimpleIcon, title: "Add a document", detail: "PDF, Word, text or Markdown, up to 4 MB", href: "/settings/documents" },
      ],
    },
    {
      title: "Plan",
      items: [
        { key: "tasks", icon: CheckSquareIcon, title: "Tasks", detail: open === undefined ? "Your open tasks" : open === 1 ? "1 open task" : `${open} open tasks`, href: "/tasks" },
        { key: "agenda", icon: CalendarDotsIcon, title: "Next 7 days", detail: "Calendar events, scheduled tasks and meeting notes", href: "/agenda" },
        { key: "approvals", icon: SealCheckIcon, title: "Approvals", detail: pending ? "Waiting for your decision" : "Nothing waiting", href: "/approvals", count: pending },
      ],
    },
    {
      title: "Keep",
      items: [
        { key: "notes", icon: NotebookIcon, title: "Notes and links", detail: "Searchable by your agent in chat", href: "/notes" },
        { key: "docs", icon: FileTextIcon, title: "Documents", detail: "Files your agent can search", href: "/settings/documents" },
      ],
    },
  ];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: bottom, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
      >
        <View style={{ gap: space.xs }}>
          <Txt variant="display" accessibilityRole="header">
            Workspace
          </Txt>
          <Txt variant="small">Tasks, plans and everything you keep.</Txt>
        </View>
        {groups.map((g) => (
          <View key={g.title}>
            <SectionHeader title={g.title} />
            <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, overflow: "hidden" }}>
              {g.items.map((p, i) => (
                <View key={p.key}>
                  {i > 0 ? <Divider style={{ marginLeft: 52 }} /> : null}
                  <Row
                    icon={p.icon}
                    title={p.title}
                    detail={p.detail}
                    onPress={() => router.push(p.href)}
                    right={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                        {p.count ? <CountBadge count={p.count} /> : null}
                        <CaretRightIcon size={18} color={color.subtle} />
                      </View>
                    }
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
