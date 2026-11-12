import { CheckSquareIcon, SquareIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, View } from "react-native";
import { Txt } from "@/components/ui";
import { Group } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";
import { useConnect } from "./connect-store";
import { startFiles } from "./files";
import { startGroups } from "./groups";
import { fingerprint } from "./identity";
import { connectAccent } from "./theme";

export type PersonOption = { peerKey: string; name: string };

/** A checklist of people, for picking recipients or group members. 48dp rows, checkbox semantics. */
export function PeopleChecklist({ people, selected, onToggle, max }: { people: PersonOption[]; selected: string[]; onToggle: (peerKey: string) => void; max?: number }) {
  return (
    <Group>
      {people.map((p) => {
        const on = selected.includes(p.peerKey);
        const full = !on && max != null && selected.length >= max;
        const Icon = on ? CheckSquareIcon : SquareIcon;
        return (
          <Pressable
            key={p.peerKey}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: full }}
            accessibilityLabel={p.name}
            disabled={full}
            onPress={() => onToggle(p.peerKey)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.lg, backgroundColor: pressed ? color.surface2 : undefined, opacity: full ? 0.5 : 1 })}
          >
            <Icon size={22} color={on ? connectAccent.main : color.muted} weight={on ? "fill" : "regular"} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{p.name}</Txt>
              <Txt variant="small">{fingerprint(p.peerKey)}</Txt>
            </View>
          </Pressable>
        );
      })}
    </Group>
  );
}

export function useToggleList(initial: string[] = []) {
  const [selected, setSelected] = React.useState<string[]>(initial);
  const toggle = React.useCallback((k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])), []);
  return { selected, toggle, setSelected };
}

/** People connected securely right now (not blocked), one entry per person. */
export function useConnectedPeople(): PersonOption[] {
  const links = useConnect((s) => s.links);
  const peers = useConnect((s) => s.peers);
  return React.useMemo(() => {
    const out = new Map<string, PersonOption>();
    for (const l of Object.values(links)) {
      if (l.phase !== "secure" || !l.peerKey) continue;
      if (peers.find((p) => p.key === l.peerKey)?.blocked) continue;
      out.set(l.peerKey, { peerKey: l.peerKey, name: peers.find((p) => p.key === l.peerKey)?.name ?? l.name });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [links, peers]);
}

/** Makes sure Connect, file transfers and groups are listening. Every Connect screen calls it. */
export function useConnectFeatures() {
  React.useEffect(() => {
    const s = useConnect.getState();
    if (!s.ready) void s.init("");
    startFiles();
    startGroups();
  }, []);
}
