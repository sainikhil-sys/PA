import { useLocalSearchParams } from "expo-router";
import { CheckCircleIcon, PlusIcon, SparkleIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Button, Card, Input, Screen, Txt } from "@/components/ui";
import { useAddPlanTask, useCircle, usePlan } from "@/features/connect/social-api";
import { formatWhen } from "@/features/connect/social-ui";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/**
 * AI group planning. The plan is a suggestion: nothing is created until you tap Add on a step,
 * and then it becomes one normal task in your own task list (not anyone else's).
 */
export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const plan = usePlan(id);
  const add = useAddPlanTask();
  const [goal, setGoal] = React.useState("");
  const [added, setAdded] = React.useState<Record<number, boolean>>({});

  return (
    <Screen>
      <SubHeader title="Plan with AI" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">
          {`Describe what ${circle.data?.name ?? "the circle"} wants to do. Cowork's AI suggests steps and times, using what you write here plus the circle's name, description, size and upcoming events. Nothing is created until you add a step, and an added step goes to your own task list only.`}
        </Txt>
        <Input value={goal} onChangeText={setGoal} placeholder="Study for the networks exam on the 28th, 4 of us" maxLength={500} multiline accessibilityLabel="Goal" />
        <Button
          label="Suggest a plan"
          variant="primary"
          icon={SparkleIcon}
          disabled={goal.trim().length < 3}
          loading={plan.isPending}
          onPress={() => {
            setAdded({});
            plan.mutate(goal.trim());
          }}
        />
        {plan.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(plan.error)}</Txt> : null}

        {plan.data ? (
          <View style={{ gap: space.md }}>
            <Txt>{plan.data.summary}</Txt>
            {plan.data.steps.map((s, i) => (
              <Card key={i} style={{ gap: space.sm }}>
                <Txt variant="heading">
                  {i + 1}. {s.title}
                </Txt>
                {s.detail ? <Txt variant="bodyMuted">{s.detail}</Txt> : null}
                {s.suggestedAt || s.durationMinutes ? (
                  <Txt variant="small">
                    {[s.suggestedAt ? `Suggested: ${formatWhen(s.suggestedAt)}` : null, s.durationMinutes ? `${s.durationMinutes} min` : null].filter(Boolean).join(" · ")}
                  </Txt>
                ) : null}
                <Button
                  label={added[i] ? "Added to your tasks" : "Add to my tasks"}
                  icon={added[i] ? CheckCircleIcon : PlusIcon}
                  compact
                  disabled={added[i]}
                  loading={add.isPending && add.variables?.title === s.title}
                  onPress={() => add.mutate({ circleId: id, ...s }, { onSuccess: () => setAdded((x) => ({ ...x, [i]: true })) })}
                />
              </Card>
            ))}
            {add.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(add.error)}</Txt> : null}
            <Txt variant="small">AI suggestions can be wrong. Check times before you rely on them.</Txt>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
