import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { mimeFromName, safeName } from "./files-logic";

/** A file chosen on this phone, ready to offer. */
export type Picked = { uri: string; name: string; size: number | null; mime: string };

/** Photos and videos from the system photo picker (no storage permission needed on Android 13+). */
export async function pickMedia(multiple = true): Promise<Picked[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 10 : 1,
    quality: 1,
  });
  if (res.canceled) return [];
  return res.assets.map((a, i) => {
    const fallback = a.type === "video" ? `video-${i + 1}.mp4` : `photo-${i + 1}.jpg`;
    const name = safeName(a.fileName ?? a.uri.split("/").pop() ?? fallback, fallback);
    return { uri: a.uri, name, size: a.fileSize ?? null, mime: a.mimeType ?? mimeFromName(name) };
  });
}

/** Any document through the system file picker. Copied to Cowork's cache so it can be read. */
export async function pickDocuments(multiple = true): Promise<Picked[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple, copyToCacheDirectory: true, type: "*/*" });
  if (res.canceled) return [];
  return res.assets.map((a) => {
    const name = safeName(a.name, "file");
    return { uri: a.uri, name, size: a.size ?? null, mime: a.mimeType ?? mimeFromName(name) };
  });
}
