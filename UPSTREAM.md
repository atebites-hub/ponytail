# Upstream fork maintenance

This repository is a **true GitHub fork** of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail). Keep `fork: true` and that parent. Do not convert it to a standalone repo.

Atebites-owned behavior lives on `main` as first-class commits. Upstream moves in through `chore: sync upstream` pull requests. Never force-push `main` unless it is still identical to upstream and the only path is a reviewable PR.

## Remotes

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | https://github.com/atebites-hub/ponytail.git | This fork (push / PRs) |
| `upstream` | https://github.com/DietrichGebert/ponytail.git | Parent (fetch only) |

```bash
git remote add origin https://github.com/atebites-hub/ponytail.git   # if missing
git remote add upstream https://github.com/DietrichGebert/ponytail.git  # if missing
git remote -v
# origin    https://github.com/atebites-hub/ponytail.git (fetch/push)
# upstream  https://github.com/DietrichGebert/ponytail.git (fetch)
```

Do not `git push` to `upstream`.

## Last synced upstream tip

- **Upstream:** https://github.com/DietrichGebert/ponytail
- **Parent:** [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
- **Last synced upstream tip:** <!-- upstream-tip-begin -->`356918eba965ee1eac64bd3a7f0dd02108350de5` (`356918e`, `docs: rename the Retriever logo files so GitHub serves the new version`)<!-- upstream-tip-end -->

The weekday sync workflow rewrites only the `upstream-tip-begin/end` span when it opens a clean sync PR.

## Owners

- **Jaskarn** (atebites-hub)
- **Factory Plugins bot**

## Divergence (atebites-only)

These are atebites-only. Do not drop them in an upstream merge without recording the deferral here.

| Patch / behavior | Why we keep it | Conflict risk | Source |
| --- | --- | --- | --- |
| Cursor plugin (IDE + CLI): `.cursor-plugin/`, `mcp.json`, root `plugin.json` Agent Plugins 1.0.0, README Cursor install | Cursor loads existing skills, rules, commands, and MCP as a plugin instead of copying the mdc | Medium — `README*.md` (upstream badge edits already overlap); `plugin.json` if upstream ships official Cursor support | `18df792`, PR #1 |

Do not change plugin behavior or marketplace pins during a sync. There are no factory patch ids.

## Sync policy

1. **Keep the GitHub fork relationship.** Parent must stay `DietrichGebert/ponytail`.
2. **Never rewrite published `main`.** No force-push to `main`. Exception only if `main` is still byte-identical to `upstream/main` and the change still goes through a PR.
3. **Do not rebase atebites commits off `main`.** Replay happens by *merging* `upstream/main` into a branch that already has those commits.
4. **Sync through a PR titled exactly `chore: sync upstream`** into `main`. Prefer GitHub **Create a merge commit** (not squash, not rebase) so atebites SHAs stay reachable and the next merge has a sane merge-base.
5. **Update this file** after each successful sync: last synced tip (the `upstream-tip` markers) and any new divergence or deferral.

### Manual sync

```bash
git fetch origin
git fetch upstream
git checkout -b chore/sync-upstream-$(git rev-parse --short upstream/main) origin/main

# Skip if we already contain upstream/main:
#   git merge-base --is-ancestor upstream/main HEAD && echo already synced

git merge --no-ff upstream/main -m "chore: merge upstream $(git rev-parse --short upstream/main)"
# Resolve conflicts using the divergence table. Keep the Cursor plugin.
# Update the Last synced upstream tip markers in this file.

git push -u origin HEAD
# Open PR title: chore: sync upstream
# Merge with a merge commit.
```

Weekday automation: `.github/workflows/sync-upstream.yml` (UTC cron, plus `workflow_dispatch`). If an open PR already has that exact title, the workflow leaves it alone.

`GITHUB_TOKEN` pull requests do not start other workflows. Set repository secret `UPSTREAM_SYNC_TOKEN` (Factory Plugins bot PAT with `contents` + `pull-requests`) so sync PRs still run CI.

### After every sync

- [ ] Cursor plugin still present; marketplace pins unchanged
- [ ] `npm test` if the merge touched more than docs
- [ ] This file’s last-synced SHA matches `upstream/main`
- [ ] Fork still `fork: true` with parent `DietrichGebert/ponytail`
