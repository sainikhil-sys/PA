import * as Haptics from "expo-haptics";
import { ArrowsClockwiseIcon, CheckIcon, FlagIcon, PlusIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, TextInput, View } from "react-native";
import { IconButton, Txt } from "@/components/ui";
import type { TaskSummary } from "@/lib/types";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";
import { PRIORITY_LABEL, whenLabel } from "./dates";

/** Rounded-square checkbox with a full 48dp touch target. */
export function TaskCheckbox({ checked, title, onPress, disabled }: { checked: boolean; title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      accessibilityLabel={checked ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={{ width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: checked ? color.accent : pressed ? color.muted : color.subtle,
            backgroundColor: checked ? color.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? <CheckIcon size={14} color={color.onAccent} weight="bold" /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Small text tag beside a task (status, recurrence, priority). Never relies on color alone. */
function Tag({ label, icon, strong }: { label: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {icon}
      <Txt variant="small" style={strong ? { color: color.text, fontFamily: font.medium } : undefined}>
        {label}
      </Txt>
    </View>
  );
}

/** One open task: checkbox, title, when, priority, recurrence and review status. Tapping the row opens it. */
export function TaskRow({ task, onToggle, onOpen }: { task: TaskSummary; onToggle: () => void; onOpen: () => void }) {
  const when = whenLabel(task);
  const tags: React.ReactNode[] = [];
  if (when) tags.push(<Tag key="when" label={when} />);
  if (task.priority >= 2)
    tags.push(<Tag key="p" label={PRIORITY_LABEL[task.priority] ?? "High"} strong={task.priority === 3} icon={<FlagIcon size={13} color={task.priority === 3 ? color.accent : color.muted} weight={task.priority === 3 ? "fill" : "regular"} />} />);
  if (task.recurring) tags.push(<Tag key="r" label="Recurring" icon={<ArrowsClockwiseIcon size={13} color={color.muted} />} />);
  if (task.status === "needs_review") tags.push(<Tag key="s" label="Needs review" strong />);
  else if (task.status === "in_progress") tags.push(<Tag key="s" label="In progress" />);

  const a11y = [task.title, when, task.priority === 3 ? "High priority" : task.priority === 2 ? "Medium priority" : null, task.recurring ? "Recurring" : null, task.status === "needs_review" ? "Needs review" : null]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", paddingLeft: space.xs }}>
      <TaskCheckbox checked={false} title={task.title} onPress={onToggle} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the task"
        onPress={onOpen}
        style={({ pressed }) => [{ flex: 1, minHeight: TOUCH, justifyContent: "center", paddingVertical: space.sm + 2, paddingRight: space.lg, borderRadius: radius.control }, pressed && { opacity: 0.7 }]}
      >
        <Txt variant="body" numberOfLines={2}>
          {task.title}
        </Txt>
        {tags.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 2, marginTop: 2 }}>{tags}</View> : null}
      </Pressable>
    </View>
  );
}

/** Natural-language add bar: "call mom tomorrow 6pm #family". */
export function QuickAddBar({ value, onChangeText, onSubmit, busy, inputRef }: { value: string; onChangeText: (v: string) => void; onSubmit: () => void; busy: boolean; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>> }) {
  const canSend = value.trim().length > 0 && !busy;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => canSend && onSubmit()}
        placeholder="Add a task, like call mom tomorrow 6pm"
        placeholderTextColor={color.subtle}
        selectionColor={color.accent}
        cursorColor={color.accent}
        accessibilityLabel="New task"
        accessibilityHint="Type a task with an optional date, time, #tag or !high"
        returnKeyType="done"
        submitBehavior="submit"
        maxLength={300}
        editable={!busy}
        maxFontSizeMultiplier={1.6}
        style={{
          flex: 1,
          minHeight: TOUCH,
          borderRadius: radius.control,
          borderWidth: 1,
          borderColor: color.borderStrong,
          backgroundColor: color.surface,
          color: color.text,
          paddingHorizontal: space.lg,
          fontFamily: font.regular,
          fontSize: 16,
        }}
      />
      <IconButton icon={PlusIcon} label="Add task" tone={canSend ? "accent" : "default"} onPress={onSubmit} disabled={!canSend} />
    </View>
  );
}

/** A row of rounded-rectangle options (never pills). Behaves as a radio group. */
export function Segmented<T extends string | number | null>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${label}: ${o.label}`}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              minHeight: TOUCH,
              minWidth: 64,
              flexGrow: 1,
              paddingHorizontal: space.md,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: on ? color.accent : color.borderStrong,
              backgroundColor: on ? color.surface3 : color.surface2,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Txt variant="label" style={{ color: on ? color.text : color.muted, fontFamily: on ? font.semibold : font.medium }}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
