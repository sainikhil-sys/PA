import { KeyIcon, ProhibitIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Button, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { fingerprint } from "@/features/connect/identity";
import { useBlockActions, useBlocks } from "@/features/connect/social-api";
import { useKeyActions, useMyKeys } from "@/features/connect/social-keys";
import { Loaded } from "@/features/connect/social-ui";
import { Group, SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** Blocked people, and the Connect key registry (so people in your circles recognise you offline). */
export default function SafetyScreen() {
  const blocks = useBlocks();
  const b = useBlockActions();
  const keys = useMyKeys();
  const k = useKeyActions();

  return (
    <Screen>
      <SubHeader title="Safety and keys" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <View>
          <SectionHeader title="Blocked" />
          <Txt variant="small" style={{ marginBottom: space.sm }}>
            {"People you block cannot invite you to circles or see your presence in rooms, and their posts are hidden from you. They are not told. Block someone from a circle's Members tab."}
          </Txt>
          <Loaded q={blocks}>
            {(items) =>
              items.length ? (
                <Group>
                  {items.map((x) => (
                    <Row key={x.userId} icon={ProhibitIcon} title={x.name} right={<Button label="Unblock" compact variant="ghost" onPress={() => b.unblock.mutate(x.userId)} />} />
                  ))}
                </Group>
              ) : (
                <Txt variant="small">You have not blocked anyone.</Txt>
              )
            }
          </Loaded>
          {b.unblock.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(b.unblock.error)}</Txt> : null}
        </View>

        <View>
          <SectionHeader title="Recognise me offline" />
          <Txt variant="small" style={{ marginBottom: space.sm }}>
            {"Registers this phone's Connect key with your Cowork account, so people in your circles see your account name when you connect nearby. The phone proves it holds the key; the private key never leaves it. Only members of your circles can look it up."}
          </Txt>
          <Loaded q={keys}>
            {(d) => (
              <View style={{ gap: space.sm }}>
                {d.items.length ? (
                  <Group>
                    {d.items.map((x) => (
                      <Row
                        key={x.publicKey}
                        icon={KeyIcon}
                        title={x.publicKey === d.thisPhone ? "This phone" : x.label || "Another phone"}
                        detail={`Key ${fingerprint(x.publicKey)}`}
                        right={<Button label="Remove" compact variant="ghost" onPress={() => k.remove.mutate(x.publicKey)} />}
                      />
                    ))}
                  </Group>
                ) : null}
                {!d.registered ? (
                  d.serverKey ? (
                    <Button label="Register this phone" variant="primary" loading={k.register.isPending} onPress={() => k.register.mutate("Android phone")} />
                  ) : (
                    <Txt variant="small">Registration is not set up on the server yet.</Txt>
                  )
                ) : (
                  <Txt variant="small">This phone is registered.</Txt>
                )}
              </View>
            )}
          </Loaded>
          {k.register.error || k.remove.error ? (
            <Txt variant="small" style={{ color: color.danger }}>
              {k.register.error instanceof Error && !("status" in k.register.error) ? k.register.error.message : errorText(k.register.error ?? k.remove.error)}
            </Txt>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
