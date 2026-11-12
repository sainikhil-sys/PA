import { ChatsCircleIcon } from "phosphor-react-native";
import * as React from "react";
import { Switch, View } from "react-native";
import { Button, Input, Txt } from "@/components/ui";
import { errorText } from "@/lib/api";
import { color, radius, space } from "@/theme/tokens";
import { useSaveProfile } from "./api";

/** Mirrors the server's handle rules (lib/social/rules.ts) so mistakes show before sending. */
export function handleHint(raw: string): string | null {
  const h = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!h) return null;
  if (h.length < 3) return "Use at least 3 characters.";
  if (h.length > 24) return "Use at most 24 characters.";
  if (!/^[a-z0-9._]+$/.test(h)) return "Use only letters, numbers, dots and underscores.";
  if (!/^[a-z0-9]/.test(h) || /[._]$/.test(h)) return "Start and end with a letter or number.";
  if (/[._]{2}/.test(h)) return "Don't put two dots or underscores next to each other.";
  return null;
}

export function SwitchRow({ title, detail, value, onChange, disabled }: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Txt variant="label">{title}</Txt>
        <Txt variant="small">{detail}</Txt>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: color.accent, false: color.surface3 }}
        thumbColor={color.bg}
        ios_backgroundColor={color.surface3}
      />
    </View>
  );
}

/** First visit to Chats: pick a handle and the name people see. Nothing is shared before this. */
export function JoinChats({ suggestion }: { suggestion?: { handle: string; displayName: string } }) {
  const save = useSaveProfile();
  const [handle, setHandle] = React.useState(suggestion?.handle ?? "");
  const [name, setName] = React.useState(suggestion?.displayName ?? "");
  const [searchable, setSearchable] = React.useState(true);
  const hint = handleHint(handle);
  const canSave = !hint && handle.trim().length >= 3 && name.trim().length > 0;

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ alignItems: "center", gap: space.sm, paddingTop: space.lg }}>
        <View style={{ width: 56, height: 56, borderRadius: radius.card, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
          <ChatsCircleIcon size={28} color={color.accentText} />
        </View>
        <Txt variant="title" style={{ textAlign: "center" }}>
          Message your friends
        </Txt>
        <Txt variant="small" style={{ textAlign: "center", maxWidth: 320 }}>
          Choose a handle so friends can find you. People see your handle and name, never your email address. Your assistant chats stay separate and private.
        </Txt>
      </View>
      <Input label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} placeholder="asha.rao" error={hint} maxLength={25} />
      <Input label="Name people see" value={name} onChangeText={setName} placeholder="Asha Rao" maxLength={60} />
      <SwitchRow title="Let people find me by handle" detail="Off: only people you add can find you." value={searchable} onChange={setSearchable} />
      {save.isError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {errorText(save.error)}
        </Txt>
      ) : null}
      <Button label="Start using Chats" variant="primary" disabled={!canSave} loading={save.isPending} onPress={() => save.mutate({ handle: handle.trim(), displayName: name.trim(), searchable })} />
    </View>
  );
}
