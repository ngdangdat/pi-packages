/**
 * PR Status Extension
 *
 * Displays the current branch's GitHub PR in Pi's status bar (footer).
 * Uses `gh pr list` to find the PR and `ctx.ui.setStatus()` to render it.
 *
 * Auto-refreshes when the branch changes by watching .git/HEAD.
 * Provides `/pr-status` command for manual refresh.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { dirname, join } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up from cwd to find the .git path.
 * Handles both regular repos (.git is a directory) and worktrees (.git is a file).
 * Returns the resolved HEAD path, or null if not in a git repo.
 */
function findHeadPath(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          // Worktree: .git is a file containing "gitdir: <path>"
          const content = readFileSync(gitPath, "utf8").trim();
          if (content.startsWith("gitdir: ")) {
            const gitDir = join(dir, content.slice(8).trim());
            return join(gitDir, "HEAD");
          }
        } else if (stat.isDirectory()) {
          return join(gitPath, "HEAD");
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve a short, display-friendly branch name. */
async function resolveBranch(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string | null> {
  const result = await pi.exec(
    "git",
    ["branch", "--show-current"],
    { cwd, timeout: 5_000 },
  );
  const branch = result.stdout.trim();
  return branch || null;
}

/** Query gh CLI for an open PR matching the given branch head. */
async function fetchPR(
  pi: ExtensionAPI,
  branch: string,
  cwd: string,
): Promise<{ number: number; title: string; state: string } | null> {
  const result = await pi.exec(
    "gh",
    ["pr", "list", "--head", branch, "--json", "number,title,state", "--limit", "1"],
    { cwd, timeout: 5_000 },
  );

  if (result.code !== 0) return null;

  try {
    const prs = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      state: string;
    }>;
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let unwatchHead: (() => void) | undefined;
  let lastBranch: string | undefined;
  let latestCtx: ExtensionContext | undefined;

  /** Refresh the PR status display. */
  async function refresh(ctx: ExtensionContext): Promise<void> {
    const branch = await resolveBranch(pi, ctx.cwd);

    // Clear if on main/master or not in a repo
    if (!branch || branch === "main" || branch === "master") {
      ctx.ui.setStatus("pr-status", undefined);
      lastBranch = branch ?? undefined;
      return;
    }

    // Skip if branch hasn't changed (avoids redundant gh calls)
    if (branch === lastBranch) return;
    lastBranch = branch;

    const pr = await fetchPR(pi, branch, ctx.cwd);
    if (pr) {
      const icon =
        pr.state === "OPEN" ? "🟢" : pr.state === "MERGED" ? "🟣" : "🔴";
      ctx.ui.setStatus("pr-status", `${icon} PR #${pr.number}: ${pr.title}`);
    } else {
      ctx.ui.setStatus("pr-status", undefined);
    }
  }

  /** Trigger a refresh using the latest known ctx (from file watcher). */
  function refreshFromWatcher(): void {
    if (!latestCtx) return;
    // Fire-and-forget: next render will pick up the new status
    refresh(latestCtx).catch(() => { /* ignore */ });
  }

  /** Start watching .git/HEAD for branch changes. */
  function startWatching(cwd: string): void {
    stopWatching();

    const headPath = findHeadPath(cwd);
    if (!headPath) return;

    // watchFile is poll-based (stat interval), which handles git's atomic
    // rename of HEAD correctly (unlike event-based fs.watch on the file).
    watchFile(headPath, { interval: 500 }, () => {
      refreshFromWatcher();
    });

    unwatchHead = () => {
      try { unwatchFile(headPath); } catch { /* ignore */ }
    };
  }

  function stopWatching(): void {
    unwatchHead?.();
    unwatchHead = undefined;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    lastBranch = undefined; // force refresh on new session
    await refresh(ctx);
    startWatching(ctx.cwd);
  });

  // ── Command ──────────────────────────────────────────────────────────────

  pi.registerCommand("pr-status", {
    description: "Refresh PR status in the footer",
    handler: async (_args, ctx) => {
      lastBranch = undefined; // force refresh
      await refresh(ctx);
      ctx.ui.notify("PR status refreshed", "info");
    },
  });
}
