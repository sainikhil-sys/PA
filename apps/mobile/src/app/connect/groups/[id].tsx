import { router, useLocalSearchParams } from "expo-router";
import { DotsThreeIcon, PaperPlaneRightIcon, UsersThreeIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, KeyboardAvoidingView, ScrollView, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, EmptyState, IconButton, Input, Screen, Txt } from "@/components/ui";
import { linkForPeer, useConnect } from "@/features/connect/connect-store";
import type { GroupMessageRow, MemberRow } from "@/features/connect/groups-db";
import { activeMembers, useGroups } from "@/features/connect/groups";
import { deliverySummary, MAX_GROUP_TEXT, MAX_MEMBERS } from "@/features/connect/groups-logic";
import { PeopleChecklist, useConnectedPeople, useConnectFeatures, useToggleList } from "@/features/connect/groups-ui";
import { SubHeader } from "@/features/settings/parts";
import { color, radius, space } from "@/theme/tokens";

function parseMissed(s: string): string[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function Bubble({ m }: { m: GroupMessageRow }) {
  if (!m.sender && !m.outgoing) {
    return (
      <Txt variant="small" style={{ textAlign: "center", marginVertical: space.sm }}>
        {m.text}
      </Txt>
    );
  }
  const mine = m.outgoing === 1;
  const missed = parseMissed(m.missed);
  const summary = mine ? deliverySummary(m.total, missed) : "";
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", marginVertical: space.xs }}>
      {!mine ? (
        <Txt variant="small" style={{ marginBottom: 2 }}>
          {m.senderName}
        </Txt>
      ) : null}
      <View style={{ backgroundColor: mine ? color.surface3 : color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, paddingHorizontal: space.md, paddingVertical: space.sm }}>
        <Txt selectable>{m.text}</Txt>
      </View>
      {mine ? (
        <Txt variant="small" style={{ alignSelf: "flex-end", marginTop: 2, color: missed.length ? color.danger : color.subtle }}>
          {summary}
        </Txt>
      ) : null}
    </View>
  );
}

function MemberLine({ m, links }: { m: MemberRow; links: Parameters<typeof linkForPeer>[0] }) {
  const live = Boolean(linkForPeer(links, m.peer));
  const state = m.state === "invited" ? "Invited, has not answered" : m.state === "declined" ? "Declined" : m.state === "left" ? "Left" : live ? "Connected" : "Not connected";
  return (
    <View style={{ minHeight: 48, justifyContent: "center" }} accessible accessibilityLabel={`${m.name}, ${state}`}>
      <Txt variant="label">{m.name}</Txt>
      <Txt variant="small" style={m.state === "member" && live ? { color: color.success } : undefined}>
        {state}
      </Txt>
    </View>
  );
}

/** One offline group chat. */
export default function GroupChat() {
  useConnectFeatures();
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGroups((s) => s.groups.find((x) => x.id === id));
  const loaded = useGroups((s) => s.loaded);
  const members = useGroups((s) => s.members[id]);
  const messages = useGroups((s) => s.messages[id]);
  const actions = useGroups();
  const links = useConnect((s) => s.links);
  const people = useConnectedPeople();
  const { selected, toggle, setSelected } = useToggleList();
  const [draft, setDraft] = React.useState("");
  const [menu, setMenu] = React.useState(false);
  const [sheet, setSheet] = React.useState<"members" | "add" | "leave" | "delete" | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (id) void actions.loadMessages(id);
    // loadMessages is stable; reload only when the group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const data = React.useMemo(() => [...(messages ?? [])].reverse(), [messages]);
  const active = activeMembers(members);
  const connected = active.filter((m) => linkForPeer({ links }, m.peer)).length;
  const canPost = g?.myState === "member";
  const addable = people.filter((p) => !(members ?? []).some((m) => m.peer === p.peerKey && (m.state === "member" || m.state === "invited")));

  if (!g) {
    return (
      <Screen>
        <SubHeader title="Group" />
        {loaded ? <EmptyState icon={UsersThreeIcon} title="This group is not on this phone" body="It may have been deleted." /> : null}
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SubHeader title={g.name} right={<IconButton icon={DotsThreeIcon} label="Group options" tone="plain" onPress={() => setMenu(true)} />} />
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Txt variant="small">
            {g.myState === "left"
              ? "You left this group."
              : g.myState === "invited"
                ? "You have not joined yet. Go back to Groups to join."
                : active.length
                  ? `${active.length + 1} people · ${connected} of ${active.length} connected now`
                  : "Waiting for people to accept the invitation"}
          </Txt>
        </View>

        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble m={item} />}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
          ListEmptyComponent={
            <Txt variant="small" style={{ textAlign: "center", transform: [{ scaleY: -1 }] }}>
              No messages yet. Messages reach members who are connected when you send.
            </Txt>
          }
        />

        {note ? (
          <Txt variant="small" style={{ color: color.danger, paddingHorizontal: space.lg }} accessibilityLiveRegion="polite">
            {note}
          </Txt>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: color.border }}>
          <View style={{ flex: 1 }}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder={canPost ? "Message the group" : "You cannot post here"}
              editable={canPost}
              multiline
              maxLength={MAX_GROUP_TEXT}
              accessibilityLabel="Message the group"
              style={{ maxHeight: 140, paddingVertical: space.md }}
            />
          </View>
          <IconButton
            icon={PaperPlaneRightIcon}
            label="Send to group"
            tone="accent"
            disabled={!canPost || !draft.trim()}
            onPress={() => {
              void actions.send(id, draft);
              setDraft("");
            }}
          />
        </View>
      </KeyboardAvoidingView>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <Button
          label="Members"
          onPress={() => {
            setMenu(false);
            setSheet("members");
          }}
        />
        {g.mine && g.myState === "member" ? (
          <Button
            label="Add people"
            onPress={() => {
              setMenu(false);
              setSelected([]);
              setSheet("add");
            }}
          />
        ) : null}
        {g.myState === "member" ? (
          <Button
            label="Leave group"
            variant="danger"
            onPress={() => {
              setMenu(false);
              setSheet("leave");
            }}
          />
        ) : null}
        <Button
          label="Delete group from this phone"
          variant="danger"
          onPress={() => {
            setMenu(false);
            setSheet("delete");
          }}
        />
      </Sheet>

      <Sheet open={sheet === "members"} onClose={() => setSheet(null)} title="Members">
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={{ minHeight: 48, justifyContent: "center" }}>
            <Txt variant="label">You</Txt>
            <Txt variant="small">{g.mine ? "Made this group" : "Member"}</Txt>
          </View>
          {(members ?? []).map((m) => (
            <MemberLine key={m.peer} m={m} links={{ links }} />
          ))}
        </ScrollView>
        <Txt variant="small">Only the person who made the group can add people. Up to {MAX_MEMBERS} people.</Txt>
      </Sheet>

      <Sheet open={sheet === "add"} onClose={() => setSheet(null)} title="Add people">
        {addable.length ? (
          <ScrollView style={{ maxHeight: 300 }}>
            <PeopleChecklist people={addable} selected={selected} onToggle={toggle} max={Math.max(0, MAX_MEMBERS - 1 - (members ?? []).filter((m) => m.state === "member" || m.state === "invited").length)} />
          </ScrollView>
        ) : (
          <Txt variant="small">Everyone connected right now is already in this group or invited.</Txt>
        )}
        <Button
          label="Invite"
          variant="primary"
          disabled={!selected.length}
          onPress={async () => {
            const missed = await actions.invite(id, selected);
            setSheet(null);
            setNote(missed.length ? `Could not invite ${missed.join(", ")}.` : null);
          }}
        />
      </Sheet>

      <ConfirmSheet
        open={sheet === "leave"}
        title={`Leave ${g.name}?`}
        body="Members who are connected now are told. You stop receiving messages from this group. The history stays on this phone until you delete it."
        confirmLabel="Leave group"
        destructive
        onConfirm={async () => {
          await actions.leave(id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <ConfirmSheet
        open={sheet === "delete"}
        title="Delete this group?"
        body="The group and its messages are removed from this phone. If you are still a member, you leave it first. Other members keep their copies."
        confirmLabel="Delete group"
        destructive
        onConfirm={async () => {
          await actions.remove(id);
          setSheet(null);
          if (router.canGoBack()) router.back();
          else router.replace("/connect/groups");
        }}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}
