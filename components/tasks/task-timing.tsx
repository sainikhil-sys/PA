"use client";

import { formatInTimeZone } from "date-fns-tz";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, inputClass } from "@/components/ui/input";
import { DURATION_PRESETS, formatMinutes, fromLocalInput, matchReminderPreset, reminderPresets, toLocalInput } from "@/lib/tasks/timing";
import type { TaskRow } from "./task-bits";

type Patch = { scheduledAt?: string | null; durationMinutes?: number | null; remindAt?: string | null };

/** The drawer's "When" section: start time, duration and reminder, all in the owner's timezone. */
export function TaskTimingFields({
  task,
  timezone,
  disabled,
  onSave,
}: {
  task: Pick<TaskRow, "id" | "scheduledAt" | "dueDate" | "durationMinutes" | "remindAt" | "reminderSentAt">;
  timezone: string;
  disabled?: boolean;
  onSave: (patch: Patch) => void;
}) {
  const [customDuration, setCustomDuration] = React.useState(false);
  const [customReminder, setCustomReminder] = React.useState(false);
  const presets = React.useMemo(
    () => reminderPresets({ scheduledAt: task.scheduledAt ? new Date(task.scheduledAt) : null, dueDate: task.dueDate, timezone }),
    [task.scheduledAt, task.dueDate, timezone],
  );
  const relative = presets.filter((p) => p.relative);
  const quick = presets.filter((p) => !p.relative);
  const matched = task.reminderSentAt ? (task.remindAt ? "custom" : "none") : matchReminderPreset(task.remindAt, presets);
  const reminderValue = customReminder ? "custom" : matched === "custom" ? "custom-current" : matched;
  const isPreset = task.durationMinutes !== null && (DURATION_PRESETS as readonly number[]).includes(task.durationMinutes);
  const durationValue = customDuration ? "custom" : task.durationMinutes === null ? "" : String(task.durationMinutes);
  const fmt = (iso: string) => formatInTimeZone(new Date(iso), timezone, "MMM d, HH:mm");
  const fmtOn = (iso: string) => formatInTimeZone(new Date(iso), timezone, "MMM d 'at' HH:mm");

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">When</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-2">
          <Label htmlFor="t-start">Starts</Label>
          <div className="flex gap-2">
            <input
              id="t-start"
              type="datetime-local"
              key={`${task.id}-${task.scheduledAt}`}
              defaultValue={toLocalInput(task.scheduledAt, timezone)}
              disabled={disabled}
              onBlur={(e) => {
                const v = e.target.value;
                if (v === toLocalInput(task.scheduledAt, timezone)) return;
                onSave({ scheduledAt: v ? fromLocalInput(v, timezone).toISOString() : null });
              }}
              className={inputClass}
            />
            {task.scheduledAt ? (
              <Button variant="quiet" className="shrink-0" disabled={disabled} onClick={() => onSave({ scheduledAt: null })}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="t-dur">Duration</Label>
          <select
            id="t-dur"
            value={durationValue}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") return setCustomDuration(true);
              setCustomDuration(false);
              onSave({ durationMinutes: v ? Number(v) : null });
            }}
            className={inputClass}
          >
            <option value="">None</option>
            {DURATION_PRESETS.map((m) => (
              <option key={m} value={m}>
                {formatMinutes(m)}
              </option>
            ))}
            {task.durationMinutes !== null && !isPreset ? <option value={task.durationMinutes}>{formatMinutes(task.durationMinutes)}</option> : null}
            <option value="custom">Custom…</option>
          </select>
          {customDuration ? (
            <Input
              type="number"
              min={5}
              max={600}
              step={5}
              autoFocus
              aria-label="Duration in minutes"
              placeholder="Minutes"
              defaultValue={task.durationMinutes ?? ""}
              disabled={disabled}
              onBlur={(e) => {
                const n = Math.round(Number(e.target.value));
                setCustomDuration(false);
                if (!e.target.value || !Number.isFinite(n) || n === task.durationMinutes) return;
                onSave({ durationMinutes: Math.min(600, Math.max(5, n)) });
              }}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="t-rem">Reminder</Label>
          <select
            id="t-rem"
            value={reminderValue}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") return setCustomReminder(true);
              setCustomReminder(false);
              if (v === "custom-current") return;
              if (v === "none") return onSave({ remindAt: null });
              const p = presets.find((x) => x.id === v);
              if (p) onSave({ remindAt: p.at.toISOString() });
            }}
            className={inputClass}
          >
            <option value="none">No reminder</option>
            {relative.length ? (
              <optgroup label={task.scheduledAt ? "Before start" : "On due date"}>
                {relative.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="Quick">
              {quick.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            {matched === "custom" && task.remindAt ? <option value="custom-current">{fmt(task.remindAt)}</option> : null}
            <option value="custom">Custom time…</option>
          </select>
          {customReminder ? (
            <input
              type="datetime-local"
              autoFocus
              aria-label="Reminder time"
              defaultValue={toLocalInput(task.remindAt, timezone)}
              disabled={disabled}
              onBlur={(e) => {
                const v = e.target.value;
                setCustomReminder(false);
                if (!v) return;
                onSave({ remindAt: fromLocalInput(v, timezone).toISOString() });
              }}
              className={inputClass}
            />
          ) : null}
        </div>
      </div>
      <FieldHint className="mt-2">
        {task.reminderSentAt
          ? `Reminder sent on ${fmtOn(task.reminderSentAt)}. Pick a time to remind again.`
          : task.remindAt
            ? `You'll get a notification on ${fmtOn(task.remindAt)}.`
            : "No reminder."}
      </FieldHint>
    </section>
  );
}
