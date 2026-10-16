import "server-only";
import { and, eq } from "drizzle-orm";
import { google } from "googleapis";
import { db, schema } from "@/lib/db";
import { appUrl, requireEnv } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/security/crypto";

/** Least privilege: read mail + create drafts, read calendar, read Drive files. No send/delete/modify. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google isn't connected yet. Connect it on the Integrations page.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export function googleOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    `${appUrl()}/api/integrations/google/callback`,
  );
}

export function googleAuthUrl(state: string) {
  return googleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: GOOGLE_SCOPES,
    state,
  });
}

async function googleRow(userId: string) {
  return db().query.integrations.findFirst({
    where: and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google")),
  });
}

/** OAuth2 client for the owner, refreshing (and re-encrypting) the access token when needed. */
export async function googleClient(userId: string) {
  const account = await googleRow(userId);
  if (!account?.refreshTokenEnc || account.status === "disconnected") throw new GoogleNotConnectedError();

  const client = googleOAuthClient();
  client.setCredentials({
    refresh_token: decrypt(account.refreshTokenEnc),
    access_token: account.accessTokenEnc ? decrypt(account.accessTokenEnc) : undefined,
    expiry_date: account.accessTokenExpiresAt?.getTime(),
  });

  const expiresSoon = !account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() < Date.now() + 60_000;
  if (expiresSoon) {
    try {
      const { credentials } = await client.refreshAccessToken();
      await db()
        .update(schema.integrations)
        .set({
          accessTokenEnc: credentials.access_token ? encrypt(credentials.access_token) : null,
          accessTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          status: "connected",
          lastError: null,
        })
        .where(eq(schema.integrations.id, account.id));
    } catch {
      await db()
        .update(schema.integrations)
        .set({ status: "error", lastError: "Google access expired. Reconnect to continue." })
        .where(eq(schema.integrations.id, account.id));
      throw new GoogleNotConnectedError("Google access expired. Reconnect on the Integrations page.");
    }
  }
  return client;
}

/** Exchange the OAuth code and store tokens encrypted. */
export async function saveGoogleConnection(userId: string, code: string) {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const existing = await googleRow(userId);
  const values = {
    status: "connected",
    accountLabel: info.data.email ?? null,
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    accessTokenEnc: tokens.access_token ? encrypt(tokens.access_token) : null,
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refreshTokenEnc ?? null),
    accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    lastError: null,
  };
  await db()
    .insert(schema.integrations)
    .values({ userId, provider: "google", ...values })
    .onConflictDoUpdate({ target: [schema.integrations.userId, schema.integrations.provider], set: values });
}
