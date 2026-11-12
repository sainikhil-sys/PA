import { router } from "expo-router";
import { AddressBookIcon, CalendarDotsIcon, IdentificationCardIcon, ImageIcon, PlusIcon, ShieldCheckIcon, UsersFourIcon, UsersThreeIcon } from "phosphor-react-native";
import * as React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Card, EmptyState, IconButton, Input, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useCircleActions, useCircles, useInvites } from "@/features/connect/social-api";
import { Loaded } from "@/features/connect/social-ui";
import { Group, SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** Connect's online side: circles, communities, events, business cards. Needs the internet. */
export default function SocialHome() {
  const circles = useCircles();
  const invites = useInvites();
  const a = useCircleActions();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [code, setCode] = React.useState("");

  return (
    <Screen>
      <SubHeader title="Circles" right={<IconButton icon={PlusIcon} label="New circle" onPress={() => setCreateOpen(true)} />} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={circles.isRefetching}
            onRefresh={() => {
              void circles.refetch();
              void invites.refetch();
            }}
            tintColor={color.muted}
          />
        }
      >
        <Txt variant="bodyMuted">Private groups of Cowork accounts, plus public communities and events. These parts work online through the Cowork server.</Txt>

        {invites.data?.length ? (
          <View style={{ gap: space.sm }}>
            <SectionHeader title="Invites" />
            {invites.data.map((inv) => (
              <Card key={inv.id} style={{ gap: space.md }}>
                <Txt variant="label">
                  {inv.invitedBy} invited you to {inv.circleName}
                </Txt>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    label="Join"
                    variant="primary"
                    compact
                    style={{ flex: 1 }}
                    loading={a.respond.isPending && a.respond.variables?.id === inv.id}
                    onPress={() => a.respond.mutate({ id: inv.id, action: "accept" }, { onSuccess: (r) => r.circleId && router.push(`/connect/social/circle/${r.circleId}`) })}
                  />
                  <Button label="Decline" compact style={{ flex: 1 }} onPress={() => a.respond.mutate({ id: inv.id, action: "decline" })} />
                </View>
              </Card>
            ))}
            {a.respond.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.respond.error)}</Txt> : null}
          </View>
        ) : null}

        <View>
          <SectionHeader title="Your circles" action={<Button label="Join with code" variant="ghost" compact onPress={() => setJoinOpen(true)} />} />
          <Loaded q={circles}>
            {(items) =>
              items.length ? (
                <Group>
                  {items.map((c) => (
                    <Row
                      key={c.id}
                      icon={UsersThreeIcon}
                      title={c.name}
                      detail={`${c.members} ${c.members === 1 ? "member" : "members"}${c.role === "owner" ? " · You own this circle" : ""}`}
                      onPress={() => router.push(`/connect/social/circle/${c.id}`)}
                    />
                  ))}
                </Group>
              ) : (
                <EmptyState icon={UsersThreeIcon} title="No circles yet" body="Make a circle for friends, a study group or a team, then invite people by email or share its code." action={<Button label="New circle" variant="primary" onPress={() => setCreateOpen(true)} />} />
              )
            }
          </Loaded>
        </View>

        <View>
          <SectionHeader title="More" />
          <Group>
            <Row icon={UsersFourIcon} title="Communities" detail="Public groups for a campus or an interest" onPress={() => router.push("/connect/social/communities")} />
            <Row icon={CalendarDotsIcon} title="Upcoming events" detail="From your circles and communities" onPress={() => router.push("/connect/social/events")} />
            <Row icon={IdentificationCardIcon} title="Your business card" detail="Share by link, or with someone connected nearby" onPress={() => router.push("/connect/social/card")} />
            <Row icon={AddressBookIcon} title="Cards you received" detail="Kept on this phone" onPress={() => router.push("/connect/social/cards")} />
            <Row icon={ImageIcon} title="Meme captions" detail="AI writes the text; your phone draws the layout" onPress={() => router.push("/connect/social/memes")} />
            <Row icon={ShieldCheckIcon} title="Safety and keys" detail="Blocked people, and recognising friends offline" onPress={() => router.push("/connect/social/safety")} />
          </Group>
        </View>
      </ScrollView>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="New circle">
        <Input label="Name" value={name} onChangeText={setName} maxLength={60} autoFocus />
        <Input label="About (optional)" value={about} onChangeText={setAbout} maxLength={300} multiline />
        {a.create.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.create.error)}</Txt> : null}
        <Button
          label="Create circle"
          variant="primary"
          disabled={!name.trim()}
          loading={a.create.isPending}
          onPress={() =>
            a.create.mutate(
              { name: name.trim(), description: about.trim() },
              {
                onSuccess: (r) => {
                  setCreateOpen(false);
                  setName("");
                  setAbout("");
                  router.push(`/connect/social/circle/${r.id}`);
                },
              },
            )
          }
        />
      </Sheet>

      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with a code">
        <Input label="Invite code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={14} autoFocus />
        <Txt variant="small">{"The circle's owner can see the code on the circle's Members tab."}</Txt>
        {a.join.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.join.error)}</Txt> : null}
        <Button
          label="Join"
          variant="primary"
          disabled={code.trim().length < 10}
          loading={a.join.isPending}
          onPress={() =>
            a.join.mutate(code.trim(), {
              onSuccess: (r) => {
                setJoinOpen(false);
                setCode("");
                router.push(`/connect/social/circle/${r.id}`);
              },
            })
          }
        />
      </Sheet>
    </Screen>
  );
}
