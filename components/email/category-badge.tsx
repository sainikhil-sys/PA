import { EnvelopeSimple, Info, Newspaper, Prohibit, Warning } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge";
import type { EmailCategory } from "@/lib/db/schema";

/** Categories are distinguished by fill/outline/dash + icon + label — never color. */
const MAP: Record<EmailCategory, { label: string; variant: "solid" | "outline" | "soft" | "dashed" | "muted"; Icon: typeof Warning }> = {
  URGENT: { label: "Urgent", variant: "solid", Icon: Warning },
  REPLY_NEEDED: { label: "Needs reply", variant: "outline", Icon: EnvelopeSimple },
  FYI: { label: "FYI", variant: "soft", Icon: Info },
  NEWSLETTER: { label: "Newsletter", variant: "dashed", Icon: Newspaper },
  SPAM: { label: "Spam", variant: "muted", Icon: Prohibit },
};

export function CategoryBadge({ category }: { category: EmailCategory | null }) {
  if (!category) return <Badge variant="dashed">Sorting…</Badge>;
  const { label, variant, Icon } = MAP[category];
  return (
    <Badge variant={variant}>
      <Icon weight={variant === "solid" ? "fill" : "regular"} aria-hidden />
      {label}
    </Badge>
  );
}

export const CATEGORY_LABEL: Record<EmailCategory, string> = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v.label])) as Record<EmailCategory, string>;
