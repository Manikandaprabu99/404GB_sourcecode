import { NextResponse } from "next/server";
import { getDefaultBranch, getOctokit, initRepoStructure } from "@/lib/github";
import { ApiError, readJsonBody, withAuth } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withAuth(async (req, { session, accessToken }) => {
  const body = await readJsonBody(req);
  let owner = typeof body.owner === "string" ? body.owner : undefined;
  let repo = typeof body.repo === "string" ? body.repo : undefined;
  let branch: string | undefined;

  if (!repo) throw new ApiError(400, "repo is required");

  if (body.createNew === true) {
    const { data } = await getOctokit(accessToken).repos.createForAuthenticatedUser({
      name: repo,
      private: typeof body.private === "boolean" ? body.private : true,
      auto_init: true,
      description: "404GB photo storage repo",
    });
    owner = data.owner.login;
    repo = data.name;
    branch = data.default_branch;
  }

  if (!owner) throw new ApiError(400, "owner is required");

  await initRepoStructure(accessToken, owner, repo);
  // Cached on the session so per-request routes never re-resolve it.
  branch ??= await getDefaultBranch(accessToken, owner, repo);

  session.repoOwner = owner;
  session.repoName = repo;
  session.repoBranch = branch;
  await session.save();

  return NextResponse.json({ ok: true, owner, repo });
});
