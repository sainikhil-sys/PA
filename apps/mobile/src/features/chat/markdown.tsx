import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { CheckIcon, CopyIcon } from "phosphor-react-native";
import * as React from "react";
import { Platform, Pressable, ScrollView, Text, View, type TextStyle } from "react-native";
import { color, font, radius, space, TOUCH, type } from "@/theme/tokens";

/**
 * A small, safe Markdown renderer for assistant answers. It only ever renders plain Text: no HTML,
 * no images, no embedded content. Links open in the in-app browser and only for http(s) URLs.
 */

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; start: number; items: string[] }
  | { t: "quote"; text: string };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      // An unclosed fence (still streaming) runs to the end.
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      out.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    // Blank lines and horizontal rules end a paragraph; rules are not drawn.
    if (!line.trim() || /^\s*([-*_])(\s*){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1]!.length, text: h[2]! });
      continue;
    }
    const b = BULLET.exec(line);
    if (b && !/^\s*\*\*/.test(line)) {
      flush();
      const last = out[out.length - 1];
      if (last?.t === "ul") last.items.push(b[1]!);
      else out.push({ t: "ul", items: [b[1]!] });
      continue;
    }
    const n = NUMBERED.exec(line);
    if (n) {
      flush();
      const last = out[out.length - 1];
      if (last?.t === "ol") last.items.push(n[2]!);
      else out.push({ t: "ol", start: Number(n[1]), items: [n[2]!] });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const text = line.replace(/^\s*>\s?/, "");
      const last = out[out.length - 1];
      if (last?.t === "quote") last.text += `\n${text}`;
      else out.push({ t: "quote", text });
      continue;
    }
    // A continuation line indented under a list item joins that item.
    const last = out[out.length - 1];
    if (!para.length && /^\s{2,}\S/.test(line) && (last?.t === "ul" || last?.t === "ol")) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "link"; c: Inline[]; url: string }
  | { t: "cite"; n: string };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\))|(\[(\d{1,3})\])|(\*[^*\s][^*\n]*?\*|\b_[^_\n]+?_\b)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: src.slice(last, at) });
    if (m[1]) out.push({ t: "code", v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: "b", c: parseInline(m[2].slice(2, -2)) });
    else if (m[3]) out.push({ t: "link", c: parseInline(m[4]!), url: m[5]! });
    else if (m[6]) out.push({ t: "cite", n: m[7]! });
    else if (m[8]) out.push({ t: "i", c: parseInline(m[8].slice(1, -1)) });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

/** Open an http(s) URL in the in-app browser. Anything else is ignored. */
export function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  void WebBrowser.openBrowserAsync(url).catch(() => {});
}

const MONO = Platform.select({ android: "monospace", ios: "Menlo", default: "monospace" });

function InlineText({ nodes, base }: { nodes: Inline[]; base: TextStyle }): React.ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "code":
        return (
          <Text key={i} style={{ fontFamily: MONO, fontSize: (base.fontSize ?? 15) - 1, color: color.text, backgroundColor: color.surface3 }}>
            {` ${n.v} `}
          </Text>
        );
      case "b":
        return (
          <Text key={i} style={{ fontFamily: font.semibold }}>
            <InlineText nodes={n.c} base={base} />
          </Text>
        );
      case "i":
        return (
          <Text key={i} style={{ fontStyle: "italic" }}>
            <InlineText nodes={n.c} base={base} />
          </Text>
        );
      case "link":
        return (
          <Text key={i} accessibilityRole="link" onPress={() => openLink(n.url)} style={{ color: color.accentText, textDecorationLine: "underline" }}>
            <InlineText nodes={n.c} base={base} />
          </Text>
        );
      case "cite":
        return (
          <Text key={i} accessibilityLabel={`Source ${n.n}`} style={{ fontFamily: font.medium, fontSize: 11, color: color.accentText }}>
            {` [${n.n}]`}
          </Text>
        );
    }
  });
}

function Para({ text, style }: { text: string; style: TextStyle }) {
  return (
    <Text selectable style={style} maxFontSizeMultiplier={1.6}>
      <InlineText nodes={parseInline(text)} base={style} />
    </Text>
  );
}

/** A fenced code block: monospace, horizontally scrollable, with its own Copy button. */
function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <View style={{ borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.md, borderBottomWidth: 1, borderBottomColor: color.border }}>
        <Text style={type.small} maxFontSizeMultiplier={1.4}>
          {lang || "Code"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Code copied" : "Copy code"}
          onPress={() => {
            void Clipboard.setStringAsync(text).then(() => setCopied(true), () => {});
          }}
          style={({ pressed }) => ({ minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.xs, opacity: pressed ? 0.7 : 1 })}
        >
          {copied ? <CheckIcon size={16} color={color.success} /> : <CopyIcon size={16} color={color.muted} />}
          <Text style={type.small} maxFontSizeMultiplier={1.4}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ padding: space.md }}>
        <Text selectable style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: color.text }} maxFontSizeMultiplier={1.4}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

const HEAD_SIZE = [20, 18, 16, 15, 15, 15];

/** Renders an assistant answer as Markdown. */
export function Markdown({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={{ gap: space.sm }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <Para key={i} text={b.text} style={type.body} />;
          case "h":
            return <Para key={i} text={b.text} style={{ ...type.heading, fontSize: HEAD_SIZE[b.level - 1], marginTop: i ? space.xs : 0 }} />;
          case "quote":
            return (
              <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: color.borderStrong, paddingLeft: space.md }}>
                <Para text={b.text} style={type.bodyMuted} />
              </View>
            );
          case "code":
            return <CodeBlock key={i} text={b.text} lang={b.lang} />;
          case "ul":
          case "ol":
            return (
              <View key={i} style={{ gap: space.xs }}>
                {b.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: "row", gap: space.sm }}>
                    <Text style={[type.body, { color: color.muted, minWidth: b.t === "ol" ? 22 : 12 }]} maxFontSizeMultiplier={1.6}>
                      {b.t === "ol" ? `${b.start + j}.` : "•"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Para text={item} style={type.body} />
                    </View>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

/** The answer as plain sentences for speech: no code, no markup, no citation markers. */
export function toPlainText(md: string): string {
  return parseBlocks(md)
    .filter((b) => b.t !== "code")
    .map((b) => (b.t === "ul" || b.t === "ol" ? b.items.join(". ") : b.text))
    .join(". ")
    .replace(/\[(\d{1,3})\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")
    .trim();
}
