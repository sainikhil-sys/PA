import { router, useLocalSearchParams } from "expo-router";
import { CaretLeftIcon, ChatCircleIcon, MicrophoneIcon, SpeakerHighIcon, SpeakerSlashIcon, WarningCircleIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Keyboard, KeyboardAvoidingView, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { AssistantMessage, Composer, ReportSheet, UserBubble } from "@/features/chat/components";
import { useChat, type ChatItem } from "@/features/chat/use-chat";
import { useSpeaker } from "@/features/voice/speech";
import { useVoice } from "@/features/voice/use-voice";
import { VoiceOverlay } from "@/features/voice/voice-overlay";
import { ApiError, errorText } from "@/lib/api";
import { takeChatIntent } from "@/lib/intent";
import { useConversation, useSuggestions } from "@/lib/queries";
import { color, radius, space, TOUCH } from "@/theme/tokens";

/**
 * One conversation ("new" starts one). Streams answers from /api/chat, shows sources and
 * confirmation cards, and supports one-shot voice input that lands in the composer for review.
 */
export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; prompt?: string }>();
  // In-app hand-off (orb, onboarding), read once on mount. Links from outside never send or listen.
  const [intent] = React.useState(() => takeChatIntent());
  const isNew = !params.id || params.id === "new";
  const history = useConversation(isNew ? undefined : params.id);

  const [speakReplies, setSpeakReplies] = React.useState(Boolean(intent?.listen));
  const speakRef = React.useRef(speakReplies);
  speakRef.current = speakReplies;
  const speaker = useSpeaker();

  const chat = useChat(isNew ? undefined : params.id, {
    onReply: (text, trigger) => {
      if (trigger === "voice" && speakRef.current) speaker.speak(text);
    },
  });

  // A ?prompt= from a link only prefills the composer; the person still taps send.
  const [draft, setDraft] = React.useState(() => (intent?.send ? "" : (params.prompt?.slice(0, 8000) ?? "")));
  const [draftVoice, setDraftVoice] = React.useState(false);
  const [reportId, setReportId] = React.useState<string | null>(null);
  const inputRef = React.useRef<React.ComponentRef<typeof TextInput>>(null);

  const voice = useVoice({
    onFinal: (heard) => {
      setDraft((d) => (d.trim() ? `${d.trim()} ${heard}` : heard));
      setDraftVoice(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  // Load stored history once; later refetches never overwrite the live conversation.
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (!hydrated.current && history.data) {
      hydrated.current = true;
      chat.hydrate(history.data);
    }
  }, [history.data, chat]);

  const ready = isNew || hydrated.current || Boolean(history.data);

  // An in-app intent runs once: send the chosen prompt, or start listening after the tap on the orb.
  const intentDone = React.useRef(false);
  React.useEffect(() => {
    if (!ready || !intent || intentDone.current) return;
    intentDone.current = true;
    const prompt = intent.send?.trim();
    if (prompt) chat.send(prompt, "text");
    else if (intent.listen) void voice.start();
  }, [ready, intent, chat, voice]);

  const send = (text = draft, trigger: "text" | "voice" = draftVoice ? "voice" : "text") => {
    if (!text.trim() || chat.streaming) return;
    speaker.stop();
    if (!chat.send(text, trigger)) return;
    setDraft("");
    setDraftVoice(false);
  };

  const startVoice = () => {
    speaker.stop();
    void voice.start();
  };

  const data = React.useMemo(() => [...chat.items].reverse(), [chat.items]);
  const lastKey = chat.items[chat.items.length - 1]?.key;
  const firstUser = chat.items.find((i) => i.kind === "user");
  const title = history.data?.convo.title?.trim() || (firstUser?.kind === "user" ? firstUser.text : "") || "New chat";
  // 400 is a malformed id (a stale or hand-typed link): to the user that is the same as a missing chat.
  const notFound = history.error instanceof ApiError && (history.error.status === 404 || history.error.status === 400);

  // Edge to edge: the bottom inset pads the composer only while the keyboard is closed, since the
  // keyboard avoiding padding already covers the navigation bar area when it is open.
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);
  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  let body: React.ReactNode;
  if (!isNew && history.isPending) {
    body = (
      <View style={{ padding: space.lg }}>
        <Skeleton rows={4} height={64} />
      </View>
    );
  } else if (!isNew && history.isError && !history.data && !hydrated.current) {
    body = notFound ? (
      <EmptyState icon={ChatCircleIcon} title="Chat not found" body="This chat no longer exists." action={<Button label="Back to chats" compact onPress={() => router.replace("/assistant")} />} />
    ) : (
      <ErrorState message={errorText(history.error)} onRetry={() => void history.refetch()} />
    );
  } else if (!chat.items.length) {
    body = <NewChatIntro onPick={(s) => send(s, "text")} onSpeak={startVoice} />;
  } else {
    body = (
      <FlatList
        inverted
        data={data}
        keyExtractor={(it) => it.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.lg }}
        renderItem={({ item }: { item: ChatItem }) =>
          item.kind === "user" ? (
            <UserBubble text={item.text} />
          ) : (
            <AssistantMessage item={item} isLast={item.key === lastKey && !chat.streaming} onRetry={chat.retry} onReport={setReportId} onProposalStatus={chat.setProposalStatus} />
          )
        }
      />
    );
  }

  const showComposer = isNew || Boolean(history.data) || hydrated.current;

  return (
    <Screen edges={["top"]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
          <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/assistant"))} />
          <Txt variant="heading" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Txt>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Speak replies to voice messages"
            accessibilityState={{ checked: speakReplies }}
            onPress={() => {
              if (speakReplies) speaker.stop();
              setSpeakReplies((v) => !v);
            }}
            style={({ pressed }) => ({
              minWidth: TOUCH,
              height: TOUCH,
              paddingHorizontal: space.sm,
              borderRadius: radius.control,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.xs,
              borderWidth: 1,
              borderColor: speakReplies ? color.borderStrong : color.border,
              backgroundColor: pressed ? color.surface2 : speakReplies ? color.surface2 : "transparent",
            })}
          >
            {speakReplies ? <SpeakerHighIcon size={18} color={color.text} /> : <SpeakerSlashIcon size={18} color={color.muted} />}
            <Txt variant="small" style={{ color: speakReplies ? color.text : color.muted }}>
              {speakReplies ? "Speak on" : "Speak off"}
            </Txt>
          </Pressable>
        </View>

        {speaker.speaking ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border }}>
            <SpeakerHighIcon size={16} color={color.warm} />
            <Txt variant="small" style={{ flex: 1 }}>
              Reading the reply aloud
            </Txt>
            <Button label="Stop" compact variant="ghost" onPress={speaker.stop} accessibilityLabel="Stop reading aloud" style={{ minHeight: TOUCH }} />
          </View>
        ) : null}

        <View style={{ flex: 1, paddingBottom: showComposer ? 0 : insets.bottom }}>{body}</View>

        {showComposer ? (
          <View style={{ paddingBottom: keyboardOpen ? 0 : insets.bottom, backgroundColor: color.bg }}>
            <VoiceOverlay state={voice.state} transcript={voice.transcript} onStop={voice.stop} onCancel={voice.cancel} />
            {voice.error ? <VoiceError message={voice.error} denied={voice.denied} onDismiss={voice.clearError} /> : null}
            <Composer
              inputRef={inputRef}
              value={draft}
              onChange={(t) => {
                setDraft(t);
                if (!t.trim()) setDraftVoice(false);
              }}
              onSend={() => send()}
              onStop={chat.stop}
              onMic={startVoice}
              streaming={chat.streaming}
              listening={voice.state !== "idle"}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} />
    </Screen>
  );
}

/** Voice problems, explained; text chat keeps working. */
function VoiceError({ message, denied, onDismiss }: { message: string; denied: boolean; onDismiss: () => void }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, paddingLeft: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }}
    >
      <WarningCircleIcon size={18} color={color.warning} />
      <Txt variant="small" style={{ flex: 1, paddingVertical: space.md }}>
        {message}
      </Txt>
      {denied ? <Button label="Settings" compact variant="ghost" onPress={() => void Linking.openSettings()} accessibilityLabel="Open system settings" style={{ minHeight: TOUCH }} /> : null}
      <IconButton icon={XIcon} label="Dismiss" tone="plain" onPress={onDismiss} />
    </View>
  );
}

/** Empty new chat: what the agent can do, one voice action, and the server's suggested prompts. */
function NewChatIntro({ onPick, onSpeak }: { onPick: (s: string) => void; onSpeak: () => void }) {
  const suggestions = useSuggestions();
  const items = (suggestions.data ?? []).slice(0, 4);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
      <EmptyState
        icon={ChatCircleIcon}
        title="Ask your agent"
        body="It can read your email and calendar, search your documents and manage tasks. Actions wait for your approval."
        action={<Button label="Speak instead" compact icon={MicrophoneIcon} onPress={onSpeak} />}
      />
      {items.length ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="caption">Try asking</Txt>
          {items.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${s}`}
              onPress={() => onPick(s)}
              style={({ pressed }) => ({ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: pressed ? color.surface2 : color.surface })}
            >
              <Txt variant="label">{s}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
