import { Image } from "expo-image";
import { router } from "expo-router";
import { CameraIcon, ClockCounterClockwiseIcon, FileTextIcon, FilmStripIcon, ImagesIcon, UsersThreeIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, Switch, View } from "react-native";
import { Button, Card, EmptyState, IconButton, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useFiles } from "@/features/connect/files";
import { checkOutgoing, formatBytes, mediaClass, typeLabel } from "@/features/connect/files-logic";
import { pickDocuments, pickMedia, type Picked } from "@/features/connect/files-pick";
import { PeopleChecklist, useConnectedPeople, useConnectFeatures, useToggleList } from "@/features/connect/groups-ui";
import { SnapCamera } from "@/features/connect/snap-camera";
import { connectAccent } from "@/features/connect/theme";
import { Group, SubHeader } from "@/features/settings/parts";
import { color, radius, space } from "@/theme/tokens";

const MAX_ITEMS = 10;

function ItemRow({ p, onRemove }: { p: Picked; onRemove: () => void }) {
  const c = mediaClass(p.mime);
  const Icon = c === "video" ? FilmStripIcon : c === "image" ? ImagesIcon : FileTextIcon;
  const check = checkOutgoing(p.name, p.size ?? 1, p.mime);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 64 }}>
      {c === "image" ? (
        <Image source={{ uri: p.uri }} style={{ width: 48, height: 48, borderRadius: radius.control - 4 }} contentFit="cover" />
      ) : (
        <View style={{ width: 48, height: 48, borderRadius: radius.control - 4, backgroundColor: color.surface3, alignItems: "center", justifyContent: "center" }}>
          <Icon size={22} color={color.muted} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Txt variant="label" numberOfLines={1}>
          {p.name}
        </Txt>
        <Txt variant="small" style={check.ok ? undefined : { color: color.danger }} numberOfLines={2}>
          {check.ok ? `${typeLabel(p.mime, c === "image" || c === "video" ? "snap" : "file")}${p.size ? ` · ${formatBytes(p.size)}` : ""}` : check.reason}
        </Txt>
      </View>
      <IconButton icon={XIcon} label={`Remove ${p.name}`} tone="plain" onPress={onRemove} />
    </View>
  );
}

/**
 * SnapShare: take or pick photos, videos and documents and offer them to one or several people
 * connected right now. Each person approves before anything is sent.
 */
export default function SnapShareScreen() {
  useConnectFeatures();
  const available = useFiles((x) => x.available);
  const offer = useFiles((x) => x.offer);
  const people = useConnectedPeople();
  const { selected: picked, toggle } = useToggleList();
  // Only people still connected count, even if they were ticked before they disconnected.
  const selected = picked.filter((k) => people.some((p) => p.peerKey === k));
  const [items, setItems] = React.useState<Picked[]>([]);
  const [viewOnce, setViewOnce] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pickError, setPickError] = React.useState<string | null>(null);

  const add = (more: Picked[]) => {
    setResult(null);
    setItems((cur) => {
      const next = [...cur, ...more.filter((m) => !cur.some((c) => c.uri === m.uri))];
      if (next.length > MAX_ITEMS) setPickError(`Up to ${MAX_ITEMS} items at a time. The rest were left out.`);
      return next.slice(0, MAX_ITEMS);
    });
  };

  const pick = async (kind: "media" | "docs") => {
    setPickError(null);
    try {
      add(kind === "media" ? await pickMedia(true) : await pickDocuments(true));
    } catch {
      setPickError("Could not open the picker. Try again.");
    }
  };

  const hasMedia = items.some((i) => ["image", "video"].includes(mediaClass(i.mime)));
  const blocked = items.filter((i) => !checkOutgoing(i.name, i.size ?? 1, i.mime).ok);
  const canSend = items.length > 0 && selected.length > 0 && !blocked.length && !sending && available;

  const send = async () => {
    setSending(true);
    setResult(null);
    let offered = 0;
    const problems: string[] = [];
    for (const it of items) {
      const isMedia = ["image", "video"].includes(mediaClass(it.mime));
      const r = await offer(selected, { uri: it.uri, name: it.name, size: it.size, mime: it.mime, kind: isMedia ? "snap" : "file", disappearing: isMedia && viewOnce });
      offered += r.ok;
      r.failed.forEach((f) => {
        const who = people.find((p) => p.peerKey === f.peer)?.name ?? "someone";
        problems.push(`${it.name} to ${who}: ${f.reason}`);
      });
    }
    setSending(false);
    if (!problems.length) {
      setItems([]);
      setResult({ ok: true, text: `Sent ${offered === 1 ? "1 offer" : `${offered} offers`}. Each person sees a preview and decides whether to accept.` });
    } else {
      setResult({ ok: false, text: `${offered ? `Sent ${offered === 1 ? "1 offer" : `${offered} offers`}. ` : ""}Not offered: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? `; and ${problems.length - 3} more` : ""}.` });
    }
  };

  return (
    <Screen>
      <SubHeader title="SnapShare" right={<IconButton icon={ClockCounterClockwiseIcon} label="SnapShare history" tone="plain" onPress={() => router.push("/connect/transfers?filter=snap")} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">Send photos, videos and files to people connected to you nearby, with no internet. Files are encrypted end to end and go phone to phone.</Txt>

        {!available ? (
          <Card>
            <Txt variant="small">File sharing is not available in this build of Cowork. It needs the Android app with Connect file support.</Txt>
          </Card>
        ) : null}

        <View>
          <SectionHeader title="What to send" />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Camera" icon={CameraIcon} compact style={{ flex: 1 }} onPress={() => setCamera(true)} disabled={items.length >= MAX_ITEMS} />
            <Button label="Gallery" icon={ImagesIcon} compact style={{ flex: 1 }} accessibilityLabel="Pick photos and videos" onPress={() => void pick("media")} disabled={items.length >= MAX_ITEMS} />
            <Button label="Files" icon={FileTextIcon} compact style={{ flex: 1 }} accessibilityLabel="Pick documents" onPress={() => void pick("docs")} disabled={items.length >= MAX_ITEMS} />
          </View>
          {pickError ? (
            <Txt variant="small" style={{ color: color.danger, marginTop: space.sm }} accessibilityLiveRegion="polite">
              {pickError}
            </Txt>
          ) : null}
          {items.length ? (
            <Group style={{ marginTop: space.md }}>
              {items.map((p) => (
                <ItemRow key={p.uri} p={p} onRemove={() => setItems((cur) => cur.filter((x) => x.uri !== p.uri))} />
              ))}
            </Group>
          ) : (
            <Txt variant="small" style={{ marginTop: space.sm }}>
              Nothing picked yet. Up to {MAX_ITEMS} items, 200 MB each. Apps and installers cannot be sent.
            </Txt>
          )}
        </View>

        {hasMedia ? (
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Txt variant="label">View once</Txt>
                <Txt variant="small">Photos and videos open once on their phone and are then deleted there. Screenshots or another camera can still keep a copy.</Txt>
              </View>
              <Switch
                value={viewOnce}
                onValueChange={setViewOnce}
                trackColor={{ true: connectAccent.main, false: color.surface3 }}
                thumbColor={color.text}
                accessibilityLabel="View once"
              />
            </View>
          </Card>
        ) : null}

        <View>
          <SectionHeader title="Send to" />
          {people.length ? (
            <PeopleChecklist people={people} selected={selected} onToggle={toggle} />
          ) : (
            <EmptyState
              icon={UsersThreeIcon}
              title="Nobody is connected right now"
              body="Connect with people nearby first. Both phones need Connect open."
              action={<Button label="Open Connect" compact onPress={() => router.push("/connect")} />}
            />
          )}
        </View>

        {result ? (
          <Txt variant="small" style={{ color: result.ok ? color.success : color.danger }} accessibilityLiveRegion="polite">
            {result.text}
          </Txt>
        ) : null}

        <Button
          label={sending ? "Preparing" : selected.length > 1 ? `Offer to ${selected.length} people` : "Offer"}
          variant="primary"
          loading={sending}
          disabled={!canSend}
          onPress={() => void send()}
        />

        <Row icon={ClockCounterClockwiseIcon} title="History" detail="What you sent and received, and whether it was opened" onPress={() => router.push("/connect/transfers?filter=snap")} />
      </ScrollView>

      <SnapCamera
        open={camera}
        onClose={() => setCamera(false)}
        onCaptured={(p) => {
          setCamera(false);
          add([p]);
        }}
      />
    </Screen>
  );
}
