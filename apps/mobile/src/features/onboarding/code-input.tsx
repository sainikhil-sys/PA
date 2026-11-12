import * as React from "react";
import { Pressable, TextInput, View } from "react-native";
import { Txt } from "@/components/ui";
import { color, font, radius, space } from "@/theme/tokens";

export const CODE_LENGTH = 6;

/**
 * One number-pad TextInput drawn as six boxes, so SMS/email autofill, paste and the keyboard's
 * suggestion strip all work. Only digits are kept.
 */
export function CodeInput({ value, onChange, disabled, error }: { value: string; onChange: (code: string) => void; disabled?: boolean; error?: boolean }) {
  const ref = React.useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = React.useState(false);

  // Android drops focus while the input is not editable; put the keyboard back once it is again.
  const wasDisabled = React.useRef(disabled);
  React.useEffect(() => {
    if (wasDisabled.current && !disabled) ref.current?.focus();
    wasDisabled.current = disabled;
  }, [disabled]);

  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} style={{ position: "relative" }}>
      <View style={{ flexDirection: "row", gap: space.sm }} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = focused && !disabled && (i === value.length || (i === CODE_LENGTH - 1 && value.length === CODE_LENGTH));
          return (
            <View
              key={i}
              style={{
                flex: 1,
                aspectRatio: 0.86,
                minHeight: 52,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: error ? color.danger : active ? color.accent : color.borderStrong,
                backgroundColor: color.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Txt style={{ fontFamily: font.semibold, fontSize: 24, lineHeight: 30 }}>{value[i] ?? ""}</Txt>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        caretHidden
        accessibilityLabel={`6-digit code, ${value.length} of ${CODE_LENGTH} entered`}
        accessibilityHint="Enter the code from your email"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, color: "transparent" }}
      />
    </Pressable>
  );
}
