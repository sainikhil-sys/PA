import { Bell, Books, ChatCircle, CheckSquare, Cpu, Lightning, Microphone, Newspaper, PenNib, Robot, ShieldCheck, type Icon } from "@phosphor-icons/react";

export const FLOW_ICON: Record<string, Icon> = {
  chat: ChatCircle,
  voice: Microphone,
  automation: Lightning,
  agent: Robot,
  model: Cpu,
  tasks: CheckSquare,
  knowledge: Books,
  news: Newspaper,
  approval: ShieldCheck,
  content: PenNib,
  notify: Bell,
};
