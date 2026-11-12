import { router, useLocalSearchParams } from "expo-router";
import { CameraIcon, DotsThreeIcon, FileTextIcon, ImagesIcon, MicrophoneIcon, PaperclipIcon, PaperPlaneRightIcon, SealCheckIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, KeyboardAvoidingView, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, IconButton, Input, Screen, Txt } from "@/components/ui";
import { CallButton } from "@/features/connect/calls-ui";
import { linkForPeer, maxTextFor, useConnect } from "@/features/connect/connect-store";
import type { TransferRow } from "@/features/connect/files-db";
import { useFiles } from "@/features/connect/files";
import { pickDocuments, pickMedia, type Picked } from "@/features/connect/files-pick";
import { FileBubble, MediaViewer, VoiceRecorder } from "@/features/connect/files-ui";
import { useConnectFeatures } from "@/features/connect/groups-ui";
import { fingerprint } from "@/features/connect/identity";
import { kindOfLink } from "@/features/connect/multi-transport";
import { SnapCamera } from "@/features/connect/snap-camera";
import type { MessageRow } from "@/features/connect/store";
import { SubHeader } from "@/features/settings/parts";
import { color, radius, space } from "@/theme/tokens";

const STATUS: Record<MessageRow["status"], string> = { sending: "Sending", sent: "Sent", delivered: "Delivered", received: "", failed: "Not sent: not connected" };

function Bubble({ m }: { m: MessageRow }) {
  const mine = m.outgoing === 1;
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", marginVertical: space.xs }}>
      <View style={{ backgroundColor: mine ? color.surface3 : color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, paddingHorizontal: space.md, paddingVertical: space.sm }}>
        <Txt selectable>{m.text}</Txt>
      </View>
      {mine && STATUS[m.status] ? (
        <Txt variant="small" style={{ alignSelf: "flex-end", marginTop: 2, color: m.status === "failed" ? color.danger : color.subtle }}>
          {STATUS[m.status]}
        </Txt>
      ) : null}
    </View>
  );
}

type Item = { kind: "msg"; ts: number; id: string; m: MessageRow } | { kind: "file"; ts: number; id: string; t: TransferRow };

/** One offline conversation. It sends only while the other phone is connected; history stays on this phone. */
export default function ConnectChat() {
  useConnectFeatures();
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const s = useConnect();
  const transfers = useFiles((x) => x.transfers);
  const filesAvailable = useFiles((x) => x.available);
  const files = useFiles.getState();
  const info = s.peers.find((p) => p.key === peer);
  const live = linkForPeer(s, peer);
  const thread = s.messages[peer];
  const [draft, setDraft] = React.useState("");
  const [menu, setMenu] = React.useState(false);
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"block" | "delete" | null>(null);
  const [attach, setAttach] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [viewing, setViewing] = React.useState<TransferRow | null>(null);
  const [fileNote, setFileNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    void s.loadThread(peer);
    // loadThread is stable; reload only when the person changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer]);

  // Text messages and files for this person, one timeline, newest first (the list is inverted).
  const data = React.useMemo<Item[]>(() => {
    const items: Item[] = [
      ...(thread ?? []).map((m) => ({ kind: "msg" as const, ts: m.ts, id: `m:${m.id}`, m })),
      ...transfers.filter((t) => t.peer === peer).map((t) => ({ kind: "file" as const, ts: t.ts, id: `f:${t.id}`, t })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [thread, transfers, peer]);
  const canSend = Boolean(live) && !info?.blocked;
  // Files and voice notes need a Nearby link; hotspot/LAN and Bluetooth LE links carry text only.
  const mediaLink = live ? kindOfLink(live.link) === "nearby" : false;
  const canSendFiles = canSend && filesAvailable && mediaLink;

  const offer = async (picked: Picked[], kind: "file" | "voice" = "file", durationMs?: number) => {
    setFileNote(null);
    for (const p of picked) {
      const r = await files.offer([peer], { uri: p.uri, name: p.name, size: p.size, mime: p.mime, kind, durationMs });
      if (r.failed.length) setFileNote(`${kind === "voice" ? "Voice message" : p.name}: ${r.failed[0]!.reason}`);
    }
  };

  const pick = async (what: "media" | "docs") => {
    setAttach(false);
    try {
      await offer(what === "media" ? await pickMedia(true) : await pickDocuments(true));
    } catch {
      setFileNote("Could not open the picker. Try again.");
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SubHeader
          title={info?.name ?? "Chat"}
          right={
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              {info?.blocked ? null : <CallButton peerKey={peer} />}
              <IconButton icon={DotsThreeIcon} label="More" tone="plain" onPress={() => setMenu(true)} />
            </View>
          }
        />
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.xs }}>
          <Txt variant="small">
            {info?.blocked
              ? "Blocked"
              : live
                ? mediaLink
                  ? "Connected, end-to-end encrypted"
                  : "Connected for text only, end-to-end encrypted"
                : "Not connected. Both phones need Connect open and visible."}{" "}
            · {fingerprint(peer)}
          </Txt>
          {!info?.verified && live ? (
            <Button label="Verify this person" compact icon={SealCheckIcon} onPress={() => setVerifyOpen(true)} style={{ alignSelf: "flex-start" }} />
          ) : info?.verified ? (
            <Txt variant="small" style={{ color: color.success }}>
              Verified in person
            </Txt>
          ) : null}
        </View>

        <FlatList
          inverted
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (item.kind === "msg" ? <Bubble m={item.m} /> : <FileBubble t={item.t} onOpen={setViewing} />)}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
          ListEmptyComponent={
            <Txt variant="small" style={{ textAlign: "center", transform: [{ scaleY: -1 }] }}>
              No messages yet.
            </Txt>
          }
        />

        {fileNote ? (
          <Txt variant="small" style={{ color: color.danger, paddingHorizontal: space.lg }} accessibilityLiveRegion="polite">
            {fileNote}
          </Txt>
        ) : null}

        {recording ? (
          <VoiceRecorder
            onClose={() => setRecording(false)}
            onDone={(r) => void offer([{ uri: r.uri, name: `voice-${Date.now()}.m4a`, size: null, mime: "audio/mp4" }], "voice", r.durationMs)}
          />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: color.border }}>
            <IconButton icon={PaperclipIcon} label="Send a photo, video or file" tone="plain" disabled={!canSendFiles} onPress={() => setAttach(true)} />
            <View style={{ flex: 1 }}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder={canSend ? "Message" : "Not connected"}
                editable={canSend}
                multiline
                maxLength={maxTextFor(live?.link)}
                accessibilityLabel="Message"
                style={{ maxHeight: 140, paddingVertical: space.md }}
              />
            </View>
            <IconButton
              icon={PaperPlaneRightIcon}
              label="Send"
              tone="accent"
              disabled={!canSend || !draft.trim()}
              onPress={() => {
                void s.send(peer, draft);
                setDraft("");
              }}
            />
            {!draft.trim() ? <IconButton icon={MicrophoneIcon} label="Record a voice message" tone="plain" disabled={!canSendFiles} onPress={() => setRecording(true)} /> : null}
            </View>
        )}
      </KeyboardAvoidingView>

      <Sheet open={attach} onClose={() => setAttach(false)} title={`Send to ${info?.name ?? "this person"}`}>
        <Button label="Photos and videos" icon={ImagesIcon} onPress={() => void pick("media")} />
        <Button label="Document" icon={FileTextIcon} onPress={() => void pick("docs")} />
        <Button
          label="Camera"
          icon={CameraIcon}
          onPress={() => {
            setAttach(false);
            setCamera(true);
          }}
        />
        <Txt variant="small">They see the name, size and a preview, and decide whether to accept. Up to 200 MB per file. Apps and installers cannot be sent.</Txt>
      </Sheet>

      <SnapCamera
        open={camera}
        onClose={() => setCamera(false)}
        onCaptured={(p) => {
          setCamera(false);
          void offer([p], "file");
        }}
      />
      <MediaViewer t={viewing} onClose={() => setViewing(null)} />

      <Sheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="Verify this person">
        <Txt variant="bodyMuted">Look at the other phone together. If it shows the same code, this chat is with them and nobody in between.</Txt>
        <Txt variant="display" style={{ textAlign: "center", letterSpacing: 6 }}>
          {live?.safetyCode ?? "------"}
        </Txt>
        <Button
          label="The codes match"
          variant="primary"
          disabled={!live?.safetyCode}
          onPress={async () => {
            await s.verify(peer);
            setVerifyOpen(false);
          }}
        />
        <Button label="They are different" variant="ghost" onPress={() => setVerifyOpen(false)} />
        <Txt variant="small">If the codes differ, do not share anything and disconnect.</Txt>
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <Button
          label="Files and transfers"
          onPress={() => {
            setMenu(false);
            router.push("/connect/transfers");
          }}
        />
        <Button
          label="SnapShare"
          onPress={() => {
            setMenu(false);
            router.push("/connect/snapshare");
          }}
        />
        <Button
          label="Groups"
          onPress={() => {
            setMenu(false);
            router.push("/connect/groups");
          }}
        />
        <Button
          label={info?.blocked ? "Unblock" : "Block"}
          onPress={() => {
            setMenu(false);
            if (info?.blocked) void s.unblock(peer);
            else setConfirm("block");
          }}
        />
        <Button
          label="Delete chat"
          variant="danger"
          onPress={() => {
            setMenu(false);
            setConfirm("delete");
          }}
        />
      </Sheet>

      <ConfirmSheet
        open={confirm === "block"}
        title={`Block ${info?.name ?? "this person"}?`}
        body="They are disconnected now and cannot connect to you again from this phone. They are not told."
        confirmLabel="Block"
        destructive
        onConfirm={async () => {
          await s.block(peer);
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === "delete"}
        title="Delete this chat?"
        body="The messages and files from this chat are removed from this phone and this person is forgotten. The other phone keeps its own copy."
        confirmLabel="Delete chat"
        destructive
        onConfirm={async () => {
          // Also removes their transfers, received files and call history.
          await s.forget(peer);
          setConfirm(null);
          if (router.canGoBack()) router.back();
          else router.replace("/connect");
        }}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}
