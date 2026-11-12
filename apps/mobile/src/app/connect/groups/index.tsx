import { router } from "expo-router";
import { PlusIcon, UsersThreeIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Card, EmptyState, Input, Row, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useConnect } from "@/features/connect/connect-store";
import { activeMembers, useGroups } from "@/features/connect/groups";
import { MAX_GROUP_NAME, MAX_MEMBERS } from "@/features/connect/groups-logic";
import { PeopleChecklist, useConnectedPeople, useConnectFeatures, useToggleList } from "@/features/connect/groups-ui";
import { Group, SubHeader } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";

function InviteCard({ id }: { id: string }) {
  const g = useGroups((s) => s.groups.find((x) => x.id === id));
  const members = useGroups((s) => s.members[id]);
  const accept = useGroups((s) => s.accept);
  const decline = useGroups((s) => s.decline);
  const owner = useConnect((s) => s.peers.find((p) => p.key === g?.owner)?.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!g) return null;
  const others = activeMembers(members).filter((m) => m.peer !== g.owner);
  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="heading">{g.name}</Txt>
      <Txt variant="small">
        {owner ?? "Someone"} invited you.{others.length ? ` Also in it: ${others.map((m) => m.name).join(", ")}.` : ""} Members can see your name and send you messages while connected.
      </Txt>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Join"
          variant="primary"
          compact
          loading={busy}
          style={{ flex: 1 }}
          accessibilityLabel={`Join ${g.name}`}
          onPress={async () => {
            setBusy(true);
            setError(null);
            const err = await accept(id);
            setBusy(false);
            if (err) setError(err);
            else router.push(`/connect/groups/${encodeURIComponent(id)}`);
          }}
        />
        <Button label="Decline" compact style={{ flex: 1 }} accessibilityLabel={`Decline ${g.name}`} onPress={() => void decline(id)} />
      </View>
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}

/** Offline groups: made from people connected now; each message goes to each member separately. */
export default function GroupsScreen() {
  useConnectFeatures();
  const { groups, members, loaded, create } = useGroups();
  const people = useConnectedPeople();
  const { selected, toggle, setSelected } = useToggleList();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invites = groups.filter((g) => g.myState === "invited");
  const mine = groups.filter((g) => g.myState !== "invited" && g.myState !== "declined");

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await create(name, selected);
    setBusy(false);
    if (r.error || !r.id) return setError(r.error ?? "Could not create the group.");
    setOpen(false);
    setName("");
    setSelected([]);
    router.push(`/connect/groups/${encodeURIComponent(r.id)}`);
  };

  return (
    <Screen>
      <SubHeader title="Groups" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">
          Group chats with people near you, with no internet. Each message goes to each member over their own encrypted connection, so members who are not connected at that moment do not get it.
        </Txt>

        <Button label="New group" icon={PlusIcon} variant="primary" onPress={() => setOpen(true)} />

        {invites.length ? (
          <View style={{ gap: space.sm }}>
            <SectionHeader title="Invitations" />
            {invites.map((g) => (
              <InviteCard key={g.id} id={g.id} />
            ))}
          </View>
        ) : null}

        <View>
          <SectionHeader title="Your groups" />
          {!loaded ? (
            <Skeleton rows={3} />
          ) : mine.length ? (
            <Group>
              {mine.map((g) => {
                const count = activeMembers(members[g.id]).length + 1;
                const detail = g.myState === "left" ? "You left" : `${count} ${count === 1 ? "person" : "people"}${g.mine ? " · You made it" : ""}`;
                return <Row key={g.id} icon={UsersThreeIcon} title={g.name} detail={detail} onPress={() => router.push(`/connect/groups/${encodeURIComponent(g.id)}`)} />;
              })}
            </Group>
          ) : (
            <EmptyState icon={UsersThreeIcon} title="No groups yet" body="Connect with people nearby, then make a group with them. Groups and their messages stay on this phone." />
          )}
        </View>
      </ScrollView>

      <Sheet open={open} onClose={() => setOpen(false)} title="New group">
        <Input label="Group name" value={name} onChangeText={setName} maxLength={MAX_GROUP_NAME} placeholder="For example, Study group" />
        {people.length ? (
          <ScrollView style={{ maxHeight: 280 }}>
            <PeopleChecklist people={people} selected={selected} onToggle={toggle} max={MAX_MEMBERS - 1} />
          </ScrollView>
        ) : (
          <Txt variant="small">Nobody is connected right now. Connect with people on the Connect screen first, then come back.</Txt>
        )}
        <Txt variant="small">Each person is asked to join. Only people who accept become members.</Txt>
        {error ? (
          <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        <Button label={selected.length ? `Create and invite ${selected.length}` : "Create"} variant="primary" loading={busy} disabled={!name.trim() || !selected.length} onPress={() => void submit()} />
      </Sheet>
    </Screen>
  );
}
