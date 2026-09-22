import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { initRepoStructure, getOctokit, getDefaultBranch } from "@/lib/github";

export const dynamic = "force-dynamic";

interface InitBody {
  owner?: string;
  repo?: string;
  createNew?: boolean;
  private?: boolean;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as InitBody;
  let owner = body.owner;
  let repo = body.repo;
  let branch: string | undefined;

  if (!repo) {
    return NextResponse.json({ error: "repo is required" }, { status: 400 });
  }

  if (body.createNew) {
    const octokit = getOctokit(session.accessToken);
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name: repo,
      private: body.private ?? true,
      auto_init: true,
      description: "404GB photo storage repo",
    });
    owner = data.owner.login;
    repo = data.name;
    branch = data.default_branch;
  }

  if (!owner) {
    return NextResponse.json({ error: "owner is required" }, { status: 400 });
  }

  await initRepoStructure(session.accessToken, owner, repo);
  // Cache the default branch on the session now (one extra call, on this
  // low-frequency repo-select path only) so the gallery's per-load HEAD-sha
  // check (Section 11) never has to re-resolve it.
  branch ??= await getDefaultBranch(session.accessToken, owner, repo);

  session.repoOwner = owner;
  session.repoName = repo;
  session.repoBranch = branch;
  await session.save();

  return NextResponse.json({ ok: true, owner, repo });
}
