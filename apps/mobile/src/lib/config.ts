/** The Cowork server the app talks to. Override for staging with EXPO_PUBLIC_API_URL. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://antropic.me").replace(/\/+$/, "");

export const WEB_URL = API_URL;
export const PRIVACY_URL = `${WEB_URL}/privacy`;
export const TERMS_URL = `${WEB_URL}/terms`;
export const SUPPORT_EMAIL = "support@antropic.me";
