import { router } from "expo-router";
import { MagnifyingGlassIcon, PlusIcon, UsersFourIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, EmptyState, IconButton, Input, Row, Screen, Txt } from "@/components/ui";
import { useCommunities, useCommunityActions } from "@/features/connect/social-api";
import { Choices, Loaded } from "@/features/connect/social-ui";
import { Group, SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** Communities: public inside Cowork (any signed-in person can find and join them). */
export default function CommunitiesScreen() {
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<"all" | "mine">("all");
  const list = useCommunities(query, scope === "mine");
  const a = useCommunityActions();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [kind, setKind] = React.useState<"campus" | "interest">("interest");

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Screen>
      <SubHeader title="Communities" right={<IconButton icon={PlusIcon} label="New community" onPress={() => setOpen(true)} />} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">Communities are public inside Cowork: anyone signed in can find them, see their events and join. Member lists are not shown.</Txt>
        <Input value={q} onChangeText={setQ} placeholder="Search communities" accessibilityLabel="Search communities" returnKeyType="search" />
        <Choices
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Joined" },
          ]}
        />
        <Loaded q={list}>
          {(items) =>
            items.length ? (
              <Group>
                {items.map((c) => (
                  <Row
                    key={c.id}
                    icon={UsersFourIcon}
                    title={c.name}
                    detail={`${c.kind === "campus" ? "Campus" : "Interest"} · ${c.members} ${c.members === 1 ? "member" : "members"}${c.joined ? " · Joined" : ""}`}
                    onPress={() => router.push(`/connect/social/community/${c.id}`)}
                  />
                ))}
              </Group>
            ) : (
              <EmptyState icon={MagnifyingGlassIcon} title={query ? "No matches" : "No communities yet"} body={query ? "Try another word, or start this community." : "Start one for your campus or an interest."} />
            )
          }
        </Loaded>
      </ScrollView>
      <Sheet open={open} onClose={() => setOpen(false)} title="New community">
        <Choices
          value={kind}
          onChange={setKind}
          options={[
            { value: "interest", label: "Interest" },
            { value: "campus", label: "Campus" },
          ]}
        />
        <Input label="Name" value={name} onChangeText={setName} maxLength={60} placeholder={kind === "campus" ? "University name" : "Climbing, chess, design"} />
        <Input label="About (optional)" value={about} onChangeText={setAbout} maxLength={500} multiline />
        <Txt variant="small">Anyone signed in to Cowork can see and join it.</Txt>
        {a.create.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.create.error)}</Txt> : null}
        <Button
          label="Create community"
          variant="primary"
          disabled={name.trim().length < 3}
          loading={a.create.isPending}
          onPress={() =>
            a.create.mutate(
              { name: name.trim(), description: about.trim(), kind },
              {
                onSuccess: (r) => {
                  setOpen(false);
                  setName("");
                  setAbout("");
                  router.push(`/connect/social/community/${r.id}`);
                },
              },
            )
          }
        />
      </Sheet>
    </Screen>
  );
}
