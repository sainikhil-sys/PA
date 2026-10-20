import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { z } from "zod";
import { Sheet } from "@/components/sheet";
import { Button, Input, Txt } from "@/components/ui";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";

export const MEMORY_KINDS = [
  { value: "preference", label: "Preference" },
  { value: "fact", label: "Fact" },
  { value: "person", label: "Person" },
  { value: "project", label: "Project" },
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number]["value"];

const schema = z.object({
  content: z.string().trim().min(2, "Write at least a few words").max(500, "Keep it under 500 characters"),
  kind: z.enum(["preference", "fact", "person", "project"]),
});
export type MemoryForm = z.infer<typeof schema>;

/** Add or edit one memory. Editing changes only the text (the server keeps the kind). */
export function MemorySheet({
  open,
  mode,
  initial,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mode: "add" | "edit";
  initial?: { content: string; kind: string };
  busy: boolean;
  error: string | null;
  onSubmit: (v: MemoryForm) => void;
  onClose: () => void;
}) {
  const { control, handleSubmit, reset, formState } = useForm<MemoryForm>({
    resolver: zodResolver(schema),
    defaultValues: { content: "", kind: "preference" },
  });

  React.useEffect(() => {
    if (open) {
      const kind = MEMORY_KINDS.some((k) => k.value === initial?.kind) ? (initial!.kind as MemoryKind) : "preference";
      reset({ content: initial?.content ?? "", kind });
    }
  }, [open, initial, reset]);

  return (
    <Sheet open={open} onClose={onClose} title={mode === "add" ? "Add a memory" : "Edit memory"}>
      <Controller
        control={control}
        name="content"
        render={({ field }) => (
          <Input
            label="What should your agent remember?"
            placeholder="I prefer meetings after 10 am"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            maxLength={500}
            autoFocus
            textAlignVertical="top"
            style={{ minHeight: 96, paddingTop: space.md, paddingBottom: space.md }}
            error={formState.errors.content?.message ?? null}
          />
        )}
      />
      {mode === "add" ? (
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <View style={{ gap: space.sm }}>
              <Txt variant="label">Kind</Txt>
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {MEMORY_KINDS.map((k) => {
                  const on = field.value === k.value;
                  return (
                    <Pressable
                      key={k.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={k.label}
                      onPress={() => field.onChange(k.value)}
                      style={{
                        minHeight: TOUCH,
                        paddingHorizontal: space.lg,
                        borderRadius: radius.control,
                        borderWidth: 1,
                        borderColor: on ? color.orange : color.borderStrong,
                        backgroundColor: on ? color.surface3 : color.surface2,
                        justifyContent: "center",
                      }}
                    >
                      <Txt variant="label" style={{ fontFamily: on ? font.semibold : font.medium }}>
                        {k.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />
      ) : null}
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button label={mode === "add" ? "Save memory" : "Save changes"} variant="primary" loading={busy} onPress={handleSubmit(onSubmit)} />
        <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} />
      </View>
    </Sheet>
  );
}
