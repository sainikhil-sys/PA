import { router } from "expo-router";
import { CheckIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { Button, IconButton, Input, Screen, Txt } from "@/components/ui";
import { useCreateSpace } from "@/features/spaces/api";
import { CATEGORY_LABEL, SPACE_CATEGORIES, type SpaceCategory } from "@/features/spaces/types";
import { errorText } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { color, radius, space, TOUCH } from "@/theme/tokens";

type Choice<T extends string> = { value: T; title: string; detail: string };

function Choices<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Choice<T>[]; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space.xs }}>
      <Txt variant="caption">{label}</Txt>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.border, backgroundColor: pressed ? color.surface2 : color.surface })}
          >
            <View style={{ flex: 1, paddingVertical: space.sm }}>
              <Txt variant="label">{o.title}</Txt>
              <Txt variant="small">{o.detail}</Txt>
            </View>
            {on ? <CheckIcon size={18} color={color.accentText} weight="bold" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Create a Space. You become its owner. Under 18: private Spaces only (the server enforces it). */
export default function NewSpace() {
  const create = useCreateSpace();
  const teen = useMe().data?.ageGroup === "teen";
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [rules, setRules] = React.useState("");
  const [category, setCategory] = React.useState<SpaceCategory | null>(null);
  const [visibility, setVisibility] = React.useState<"public" | "private">(teen ? "private" : "public");
  const [joinPolicy, setJoinPolicy] = React.useState<"open" | "request" | "invite">(teen ? "invite" : "open");

  const submit = () =>
    create.mutate(
      { name: name.trim(), description: description.trim() || undefined, rules: rules.trim() || undefined, category: category ?? undefined, visibility, joinPolicy },
      { onSuccess: (s) => router.replace(`/space/${encodeURIComponent(s.slug)}`) },
    );

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
          <IconButton icon={XIcon} label="Close" tone="plain" onPress={() => router.back()} />
          <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            New Space
          </Txt>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Computer Science 2027" maxLength={60} />
          <Input label="What it's about (optional)" value={description} onChangeText={setDescription} multiline maxLength={500} style={{ minHeight: 90, textAlignVertical: "top", paddingTop: space.md }} />
          <Input label="Rules (optional)" value={rules} onChangeText={setRules} multiline maxLength={3000} placeholder="Be kind. No spam." style={{ minHeight: 90, textAlignVertical: "top", paddingTop: space.md }} />
          <View style={{ gap: space.xs }}>
            <Txt variant="caption">Category</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {SPACE_CATEGORIES.map((c) => {
                const on = category === c;
                return (
                  <Pressable
                    key={c}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setCategory(on ? null : c)}
                    style={({ pressed }) => ({ minHeight: 40, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.border, backgroundColor: on ? color.accent : pressed ? color.surface2 : color.surface })}
                  >
                    <Txt variant="label" style={{ color: on ? color.onAccent : color.text }}>
                      {CATEGORY_LABEL[c]}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Choices
            label="Who can find it"
            value={visibility}
            onChange={setVisibility}
            options={[
              ...(teen ? [] : [{ value: "public" as const, title: "Public", detail: "Anyone can find it and read its posts" }]),
              { value: "private" as const, title: "Private", detail: "Hidden from search; only members see it" },
            ]}
          />
          <Choices
            label="Who can join"
            value={joinPolicy}
            onChange={setJoinPolicy}
            options={[
              ...(teen ? [] : [{ value: "open" as const, title: "Anyone", detail: "Join with one tap" }]),
              { value: "request" as const, title: "Ask to join", detail: "You or a moderator approves each person" },
              { value: "invite" as const, title: "Invite only", detail: "People join with an invite link you share" },
            ]}
          />
          {teen ? <Txt variant="small">Spaces made by people under 18 are private.</Txt> : null}
          {create.isError ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {errorText(create.error)}
            </Txt>
          ) : null}
          <Button label="Create Space" variant="primary" disabled={name.trim().length < 3} loading={create.isPending} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
