import { ShareNetworkIcon, SparkleIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, Share, View } from "react-native";
import { Button, Card, Input, Screen, Txt } from "@/components/ui";
import { useMemeCaptions, useMemeTemplates, type MemeTemplate } from "@/features/connect/social-api";
import { Choices, Loaded } from "@/features/connect/social-ui";
import { connectAccent } from "@/features/connect/theme";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";

/** Draws a caption layout with plain shapes and text. There is no picture: Cowork does not make images. */
function MemeLayout({ template, lines }: { template: MemeTemplate; lines: string[] }) {
  const stacked = template.id === "top_bottom";
  return (
    <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface2, overflow: "hidden" }}>
      {stacked ? (
        <View style={{ minHeight: 220, justifyContent: "space-between", padding: space.lg }}>
          <Txt style={{ fontFamily: font.semibold, fontSize: 22, lineHeight: 28, textAlign: "center" }}>{lines[0]}</Txt>
          <Txt style={{ fontFamily: font.semibold, fontSize: 22, lineHeight: 28, textAlign: "center" }}>{lines[1]}</Txt>
        </View>
      ) : (
        lines.map((l, i) => (
          <View key={i} style={{ flexDirection: "row", minHeight: 72, borderTopWidth: i ? 1 : 0, borderTopColor: color.border }}>
            <View style={{ width: 96, padding: space.md, justifyContent: "center", backgroundColor: color.surface3 }}>
              <Txt variant="caption" style={{ color: i === lines.length - 1 ? connectAccent.main : color.subtle }}>
                {template.lines[i]}
              </Txt>
            </View>
            <View style={{ flex: 1, padding: space.md, justifyContent: "center" }}>
              <Txt style={{ fontFamily: font.semibold, fontSize: 17, lineHeight: 23 }}>{l}</Txt>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

export default function MemesScreen() {
  const templates = useMemeTemplates();
  const captions = useMemeCaptions();
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [topic, setTopic] = React.useState("");
  const [pick, setPick] = React.useState(0);
  const template = templates.data?.find((t) => t.id === (templateId ?? templates.data?.[0]?.id));
  const options = captions.data ?? [];
  const chosen = options[pick];

  return (
    <Screen>
      <SubHeader title="Meme captions" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">Cowork writes caption text only. It cannot make or edit images: your phone draws the layout below with plain shapes, and you can share the text.</Txt>
        <Loaded q={templates}>
          {(items) => (
            <>
              <Choices value={template?.id ?? null} options={items.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => setTemplateId(v)} />
              <Input value={topic} onChangeText={setTopic} placeholder="What is it about? For example: group projects the night before" maxLength={200} multiline accessibilityLabel="Topic" />
              <Button
                label="Write captions"
                variant="primary"
                icon={SparkleIcon}
                disabled={!template || topic.trim().length < 2}
                loading={captions.isPending}
                onPress={() => {
                  if (!template) return;
                  setPick(0);
                  captions.mutate({ template: template.id, topic: topic.trim() });
                }}
              />
              {captions.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(captions.error)}</Txt> : null}
              {template && chosen ? (
                <View style={{ gap: space.md }}>
                  <MemeLayout template={template} lines={chosen} />
                  {options.length > 1 ? (
                    <Choices value={String(pick)} options={options.map((_, i) => ({ value: String(i), label: `Option ${i + 1}` }))} onChange={(v) => setPick(Number(v))} />
                  ) : null}
                  <Button label="Share text" icon={ShareNetworkIcon} onPress={() => void Share.share({ message: chosen.join("\n") })} />
                </View>
              ) : template ? (
                <Card>
                  <MemeLayout template={template} lines={template.lines} />
                </Card>
              ) : null}
            </>
          )}
        </Loaded>
      </ScrollView>
    </Screen>
  );
}
