import { Image } from "expo-image";
import { router } from "expo-router";
import { CheckIcon, ImageSquareIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton, Screen, Txt } from "@/components/ui";
import { useCreatePost } from "@/features/feed/api";
import { VISIBILITY_LABEL, type Visibility } from "@/features/feed/types";
import { pickPhotos, photosSupported, uploadPhoto, type LocalPhoto } from "@/features/feed/upload";
import { ApiError, errorText } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

const POST_MAX = 5000;
const PHOTOS_MAX = 10;

/** New post: text, up to ten photos, and who can see it. */
export default function NewPost() {
  const insets = useSafeAreaInsets();
  const create = useCreatePost();
  const teen = useMe().data?.ageGroup === "teen";
  const [body, setBody] = React.useState("");
  // Teens never post publicly (the server enforces it too).
  const [visibility, setVisibility] = React.useState<Visibility>(teen ? "followers" : "public");
  const [photos, setPhotos] = React.useState<LocalPhoto[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The server said uploads are off (503 until photo storage is set up): offer to post the text alone.
  const [uploadsOff, setUploadsOff] = React.useState(false);
  const canPhotos = photosSupported();

  const addPhotos = async () => {
    setError(null);
    try {
      setBusy("Preparing photos...");
      const picked = await pickPhotos(PHOTOS_MAX - photos.length);
      setPhotos((p) => [...p, ...picked].slice(0, PHOTOS_MAX));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add those photos.");
    } finally {
      setBusy(null);
    }
  };

  const publish = async (withPhotos = true) => {
    setError(null);
    try {
      const mediaIds: string[] = [];
      const toUpload = withPhotos ? photos : [];
      for (let i = 0; i < toUpload.length; i++) {
        setBusy(`Uploading photo ${i + 1} of ${toUpload.length}...`);
        mediaIds.push(await uploadPhoto(toUpload[i]!));
      }
      setBusy("Posting...");
      const post = await create.mutateAsync({ body: body.trim(), visibility, mediaIds });
      router.replace(post.status === "held" ? `/post/${post.id}` : "/");
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setUploadsOff(true);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const empty = !body.trim() && !photos.length;
  const options = (Object.keys(VISIBILITY_LABEL) as Visibility[]).filter((v) => !(teen && v === "public"));

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
          <IconButton icon={XIcon} label="Discard and close" tone="plain" onPress={() => router.back()} />
          <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            New post
          </Txt>
          <Button label="Post" variant="primary" compact disabled={empty || Boolean(busy)} loading={Boolean(busy) && busy !== "Preparing photos..."} onPress={() => void publish()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What's on your mind?"
            placeholderTextColor={color.subtle}
            multiline
            autoFocus
            maxLength={POST_MAX}
            accessibilityLabel="Post text"
            selectionColor={color.accentText}
            cursorColor={color.accentText}
            style={[type.body, { minHeight: 140, fontSize: 17, lineHeight: 24, textAlignVertical: "top" }]}
          />
          {body.length > POST_MAX - 200 ? <Txt variant="small">{`${POST_MAX - body.length} characters left`}</Txt> : null}

          {photos.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {photos.map((p, i) => (
                <View key={p.uri} style={{ width: 96, height: 96 }}>
                  <Image source={{ uri: p.uri }} style={{ width: 96, height: 96, borderRadius: radius.control }} contentFit="cover" accessibilityLabel={`Photo ${i + 1}`} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${i + 1}`}
                    onPress={() => setPhotos((list) => list.filter((x) => x.uri !== p.uri))}
                    hitSlop={8}
                    style={{ position: "absolute", top: 4, right: 4, width: 28, height: 28, borderRadius: 8, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}
                  >
                    <XIcon size={14} color={color.text} weight="bold" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <Button
            label={photos.length ? `Add photos (${photos.length} of ${PHOTOS_MAX})` : "Add photos"}
            icon={ImageSquareIcon}
            disabled={!canPhotos || photos.length >= PHOTOS_MAX || Boolean(busy)}
            onPress={() => void addPhotos()}
          />
          {!canPhotos ? <Txt variant="small">Adding photos needs the latest version of Cowork.</Txt> : <Txt variant="small">Location and camera details are removed from photos before they upload.</Txt>}

          <View accessibilityRole="radiogroup" accessibilityLabel="Who can see this" style={{ gap: space.xs }}>
            <Txt variant="caption">Who can see this</Txt>
            {options.map((v) => {
              const on = visibility === v;
              return (
                <Pressable
                  key={v}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setVisibility(v)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.border, backgroundColor: pressed ? color.surface2 : color.surface })}
                >
                  <View style={{ flex: 1, paddingVertical: space.sm }}>
                    <Txt variant="label">{VISIBILITY_LABEL[v].title}</Txt>
                    <Txt variant="small">{VISIBILITY_LABEL[v].detail}</Txt>
                  </View>
                  {on ? <CheckIcon size={18} color={color.accentText} weight="bold" /> : null}
                </Pressable>
              );
            })}
            {teen ? <Txt variant="small">Accounts under 18 post to followers or friends, not everyone.</Txt> : null}
          </View>

          {busy ? (
            <Txt variant="small" accessibilityLiveRegion="polite">
              {busy}
            </Txt>
          ) : null}
          {error ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {error}
            </Txt>
          ) : null}
          {uploadsOff && photos.length && body.trim() ? (
            <Button
              label="Post without photos"
              variant="primary"
              disabled={Boolean(busy)}
              onPress={() => {
                setPhotos([]);
                setUploadsOff(false);
                void publish(false);
              }}
            />
          ) : null}
          <View style={{ height: insets.bottom }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
