import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import { ChatCircleIcon, CheckSquareIcon, LinkSimpleIcon, MicrophoneIcon, NotePencilIcon, UploadSimpleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Screen, SectionHeader, Txt } from "@/components/ui";
import { setChatIntent } from "@/lib/intent";
import { color, elevation, radius, space, TOUCH } from "@/theme/tokens";
import { useTabBarSpace } from "@/features/navigation/tab-bar";

type Action = { key: string; icon: Icon; title: string; detail: string; go: () => void };

function open(href: Href) {
  router.push(href);
}

/** Create tab: start something new. Every entry opens a working flow; agents and automations join here later. */
export default function CreateTab() {
  const bottom = useTabBarSpace();
  const actions: { section: string; items: Action[] }[] = [
    {
      section: "Ask",
      items: [
        { key: "chat", icon: ChatCircleIcon, title: "New chat", detail: "Ask, plan or write with your agent", go: () => open("/chat/new") },
        {
          key: "voice",
          icon: MicrophoneIcon,
          title: "Talk",
          detail: "Speak instead of typing",
          go: () => {
            setChatIntent({ listen: true });
            open("/chat/new");
          },
        },
      ],
    },
    {
      section: "Capture",
      items: [
        { key: "task", icon: CheckSquareIcon, title: "New task", detail: "In plain words, like \"call the bank tomorrow 10am\"", go: () => open("/tasks?add=1") },
        { key: "note", icon: NotePencilIcon, title: "New note", detail: "Your agent can search it in chat", go: () => open("/notes/new") },
        { key: "link", icon: LinkSimpleIcon, title: "Save a link", detail: "Keep a page with its title and summary", go: () => open("/notes?link=1") },
        { key: "doc", icon: UploadSimpleIcon, title: "Add a document", detail: "PDF, Word, text or Markdown, up to 4 MB", go: () => open("/settings/documents") },
      ],
    },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: bottom, gap: space.xl }}>
        <View style={{ gap: space.xs }}>
          <Txt variant="display" accessibilityRole="header">
            Create
          </Txt>
          <Txt variant="small">Start a chat, or capture something for later.</Txt>
        </View>
        {actions.map((group) => (
          <View key={group.section}>
            <SectionHeader title={group.section} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
              {group.items.map((a) => (
                <ActionTile key={a.key} action={a} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function ActionTile({ action }: { action: Action }) {
  const IconCmp = action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.detail}`}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        action.go();
      }}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        minHeight: TOUCH * 2.6,
        padding: space.lg,
        gap: space.sm,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: pressed ? color.borderStrong : color.border,
        backgroundColor: pressed ? color.surface2 : color.surface,
        ...elevation.card,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
        <IconCmp size={20} color={color.accentText} />
      </View>
      <Txt variant="label">{action.title}</Txt>
      <Txt variant="small" numberOfLines={2}>
        {action.detail}
      </Txt>
    </Pressable>
  );
}
