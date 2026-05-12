/**
 * Git Status Extension
 *
 * Displays the current branch's GitHub PR in Pi's status bar (footer),
 * along with information about uncommitted files and commits in local but not pushed.
 *
 * Auto-refreshes when the branch changes by watching .git/HEAD.
 * Provides `/git-status` command for manual refresh.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
            const gitDir = resolve(dir, content.slice(8).trim());
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
): Promise<{ number: number; title: string; state: string; url: string } | null> {
  const result = await pi.exec(
    "gh",
    ["pr", "list", "--head", branch, "--json", "number,title,state,url", "--limit", "1"],
    { cwd, timeout: 5_000 },
  );

  if (result.code !== 0) return null;

  try {
    const prs = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      state: string;
      url: string;
    }>;
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

/** Get uncommitted files and unpushed commits count. */
async function fetchGitStatus(pi: ExtensionAPI, branch: string, cwd: string): Promise<{ uncommittedFiles: number; unpushedCommits: number }> {
  let uncommittedFiles = 0;
  let unpushedCommits = 0;

  try {
    const statusResult = await pi.exec("git", ["status", "--porcelain"], { cwd, timeout: 5000 });
    uncommittedFiles = statusResult.stdout.trim().split("\n").filter(line => line.length > 0).length;
  } catch {
    // Ignore errors
  }

  try {
    const logResult = await pi.exec("git", ["log", `origin/${branch}..HEAD`, "--oneline"], { cwd, timeout: 5000 });
    unpushedCommits = logResult.stdout.trim().split("\n").filter(line => line.length > 0).length;
  } catch {
    // If there is an error (e.g., origin/branch doesn't exist), we might just count local commits
    try {
      const logResult = await pi.exec("git", ["log", "--oneline", "--not", "--remotes"], { cwd, timeout: 5000 });
      unpushedCommits = logResult.stdout.trim().split("\n").filter(line => line.length > 0).length;
    } catch {
       // Ignore errors
    }
  }

  return { uncommittedFiles, unpushedCommits };
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let unwatchHead: (() => void) | undefined;
  let latestCtx: ExtensionContext | undefined;

  /** Refresh the git status display. */
  async function refresh(ctx: ExtensionContext): Promise<void> {
    const branch = await resolveBranch(pi, ctx.cwd);

    // Clear if not in a repo
    if (!branch) {
      ctx.ui.setStatus("git-status", undefined);
      return;
    }

    let statusTextParts = [];

    const gitStatus = await fetchGitStatus(pi, branch, ctx.cwd);
    if (gitStatus.uncommittedFiles > 0) {
      statusTextParts.push(`📝 ${gitStatus.uncommittedFiles} uncommitted`);
    }
    if (gitStatus.unpushedCommits > 0) {
      statusTextParts.push(`⬆️ ${gitStatus.unpushedCommits} unpushed`);
    }

    if (branch !== "main" && branch !== "master") {
      const pr = await fetchPR(pi, branch, ctx.cwd);
      if (pr) {
        const icon = pr.state === "OPEN" ? "🟢" : pr.state === "MERGED" ? "🟣" : "🔴";
        statusTextParts.push(`${icon} PR #${pr.number} - ${pr.url}`);
      }
    }

    if (statusTextParts.length > 0) {
      ctx.ui.setStatus("git-status", statusTextParts.join(" | "));
    } else {
      ctx.ui.setStatus("git-status", undefined);
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
    const listener = () => {
      refreshFromWatcher();
    };
    watchFile(headPath, { interval: 2000 }, listener);

    unwatchHead = () => {
      try { unwatchFile(headPath, listener); } catch { /* ignore */ }
    };
  }

  function stopWatching(): void {
    unwatchHead?.();
    unwatchHead = undefined;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    // Fire-and-forget to avoid blocking session initialization
    refresh(ctx).catch(() => { /* ignore */ });
    startWatching(ctx.cwd);
  });

  // ── Command ──────────────────────────────────────────────────────────────

  pi.registerCommand("git-status", {
    description: "Refresh git status in the footer",
    handler: async (_args, ctx) => {
      await refresh(ctx);
      ctx.ui.notify("Git status refreshed", "info");
    },
  });
}
