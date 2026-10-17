import "server-only";
import { escapeLittleText, linkedinVersion } from "./linkedin-format";
import { oauthAccessToken } from "./oauth";

/** Publish one text post as the connected member. Called ONLY from the owner's explicit Publish click. */
export async function publishToLinkedIn(userId: string, text: string): Promise<{ urn: string; url: string }> {
  const { token, config } = await oauthAccessToken(userId, "linkedin");
  const sub = String(config.sub ?? "");
  if (!sub) throw new Error("Reconnect LinkedIn (profile id missing).");
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "linkedin-version": linkedinVersion(),
      "x-restli-protocol-version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${sub}`,
      commentary: escapeLittleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 201) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`LinkedIn returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const urn = res.headers.get("x-restli-id") ?? "";
  return { urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/feed/" };
}
