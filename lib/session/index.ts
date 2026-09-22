import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  accessToken?: string;
  githubLogin?: string;
  repoOwner?: string;
  repoName?: string;
}

const secret = process.env.SESSION_SECRET;

export const sessionOptions: SessionOptions = {
  // Falls back to a dev-only placeholder so `next build` can statically
  // analyze routes without real secrets set. Never used with real data
  // unless SESSION_SECRET is actually configured (routes are dynamic).
  password: secret && secret.length >= 32 ? secret : "0".repeat(32),
  cookieName: "404gb_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
