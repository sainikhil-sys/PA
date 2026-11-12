import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarBlankIcon, CaretRightIcon, ShieldCheckIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Screen, Txt } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { keys } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { color, radius, space, TOUCH } from "@/theme/tokens";

const longDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
/** YYYY-MM-DD from the picked calendar day (local), never shifted by time zone. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Cowork is for people 13 and older. Asked once, for accounts that haven't given it yet (the server
 * says so with `birthDateSet: false`; older servers don't send it and this never shows). Teens
 * (13 to 17) get protective defaults on the server. Under 13: the server deletes the account and the
 * app signs out.
 */
export function BirthdateGate() {
  const qc = useQueryClient();
  const signOut = useSession((s) => s.signOut);
  const [date, setDate] = React.useState<Date | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refused, setRefused] = React.useState<string | null>(null);

  const pick = () => {
    const today = new Date();
    DateTimePickerAndroid.open({
      value: date ?? new Date(today.getFullYear() - 20, 0, 1),
      mode: "date",
      maximumDate: today,
      minimumDate: new Date(1900, 0, 1),
      onValueChange: (_e, d) => {
        if (d) {
          setDate(d);
          setError(null);
        }
      },
    });
  };

  const save = async () => {
    if (!date) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ ageGroup: "teen" | "adult" }>("/api/mobile/me/birthdate", { method: "PUT", body: { birthDate: isoDay(date) } });
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      // 403: under 13. The server has already removed the account.
      if (e instanceof ApiError && e.status === 403) setRefused(e.message);
      else setError(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (refused) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ flex: 1, padding: space.xl, justifyContent: "center", gap: space.lg }}>
          <Txt variant="title" accessibilityRole="header">
            Cowork is for people 13 and older
          </Txt>
          <Txt variant="bodyMuted">{refused}</Txt>
          <Button label="Close" variant="primary" onPress={() => void signOut()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.xl, gap: space.xl }}>
        <View style={{ gap: space.sm, marginTop: space.xxl }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
            <ShieldCheckIcon size={24} color={color.accentText} />
          </View>
          <Txt variant="title" accessibilityRole="header">
            Your date of birth
          </Txt>
          <Txt variant="bodyMuted">
            {"Cowork is for people 13 and older. We ask once so we can set the right privacy protections for your age. It's never shown to anyone."}
          </Txt>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={date ? `Date of birth, ${longDate(date)}. Change` : "Choose your date of birth"}
          onPress={pick}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            minHeight: TOUCH + 8,
            paddingHorizontal: space.lg,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: color.borderStrong,
            backgroundColor: pressed ? color.surface2 : color.surface,
          })}
        >
          <CalendarBlankIcon size={20} color={color.muted} />
          <Txt variant="body" style={{ flex: 1, color: date ? color.text : color.subtle }}>
            {date ? longDate(date) : "Choose a date"}
          </Txt>
          <CaretRightIcon size={18} color={color.subtle} />
        </Pressable>

        {error ? (
          <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}

        <View style={{ flex: 1 }} />
        <Button label="Continue" variant="primary" disabled={!date} onPress={() => setConfirm(true)} />
      </ScrollView>

      <ConfirmSheet
        open={confirm}
        title="Is this right?"
        body={date ? `${longDate(date)}. You can't change it later, so check it before you save.` : ""}
        confirmLabel="Save date of birth"
        busy={busy}
        onConfirm={() => void save()}
        onClose={() => setConfirm(false)}
      />
    </Screen>
  );
}
