---
name: gh-stack
description: Work with GitHub Stacked PRs through the official `github/gh-stack` GitHub CLI extension. Use when creating, linking, viewing, updating, rebasing, syncing, checking out, or merging dependent pull requests; when the user mentions `gh stack`, PR stacks, stacked branches, dependent PRs, or splitting work into reviewable layers; and when linking jj-managed bookmarks or existing PRs into a GitHub stack.
---

# Work with GitHub PR stacks

Use GitHub's official `gh stack` extension to manage linear chains of dependent pull requests. Treat the feature as preview software: inspect the installed command help before a mutation when flags or behavior may have changed.

A stack runs from trunk to top:

```text
(main) <- auth <- api <- frontend
           bottom            top
```

Each PR targets the branch immediately below it. Pass stack members bottom-to-top.

## Check availability

Run:

```bash
gh stack --version
gh auth status
```

If the extension is missing, ask before installing it with `gh extension install github/gh-stack`. GitHub Stacked PRs is in private preview; exit code 9 means the repository is not enabled. Report that limitation instead of trying to emulate the GitHub stack object.

## Choose the ownership model

### Let gh-stack manage Git branches

Use local tracking only in a conventional Git checkout. Metadata lives in `.git/gh-stack` and is not committed.

```bash
gh stack init auth
# commit the bottom layer
gh stack add api
# commit the next layer
gh stack submit --auto --remote origin
gh stack view --json
```

- Create the stack before implementing dependent layers when practical.
- Put foundational work at the bottom and dependent work above it.
- Pass explicit branch names to `init` and `add` in agent workflows.
- Use `submit --auto` to avoid the editor. It creates drafts by default; add `--open` only when ready-for-review PRs are intended.
- Pass `--remote <name>` to network commands when the repository has multiple remotes.

### Let jj or another VCS manage branches

Do not use gh-stack's local tracking commands in a jj workspace. `init`, `add`, `rebase`, `sync`, navigation, and `checkout` operate Git branches and `.git/gh-stack` state.

Create, sign, and push bookmarks with jj, create the PRs through the repository's normal workflow, then link their PR numbers or URLs:

```bash
GH_REPO="$repository" gh stack link --base "$trunk" \
  "$bottom_pr_url" \
  "$middle_pr_url" \
  "$top_pr_url"
```

- Prefer existing PR numbers or full URLs for jj, especially in a non-colocated workspace.
- Set `GH_REPO` to the credential-free `owner/repo` slug when GitHub CLI cannot infer the repository.
- Pass `--base "$trunk"` in a non-colocated workspace; `link` otherwise asks Git for the repository's default branch.
- Use branch arguments only when gh-stack may push them and create or retarget their PRs. `link` automatically pushes branch arguments.
- Treat `link` as a write: it creates or updates the GitHub stack and corrects PR base branches to match the requested order.
- Add `--open` only when new and existing PRs should be ready for review.
- Add members to the top of an existing stack with `gh stack link <stack-number> <new-pr>...`.
- Remember that `link` is additive: it does not remove existing stack members.
- Do not add merged, closed, queued, or auto-merge-enabled PRs; GitHub rejects them unless they are already members of the target stack.

## Inspect before changing

Use machine-readable state for locally tracked stacks:

```bash
gh stack view --json
```

The JSON includes `trunk`, `currentBranch`, and ordered `branches`. Each branch reports its name, base, current/merged/queued/rebase state, and PR details when present.

For remote or jj-managed stacks, use explicit PR or stack identifiers with `gh pr view`, `gh stack checkout`, or the GitHub UI. Do not run bare interactive pickers in an unattended agent session.

## Update a Git-managed stack

Edit the branch that owns the concern, then cascade the change upward:

```bash
gh stack checkout api
# edit and commit
gh stack rebase --upstack --remote origin
gh stack push --remote origin
gh stack view --json
```

Use `gh stack sync --remote origin` to fetch, reconcile, rebase, push, and refresh PR state. It does not create PRs. Add `--prune` only with permission to delete merged local branches.

`push`, `sync`, and `submit` can rewrite remote branches with force-with-lease after rebases. Confirm the intended stack and remote before running them. If only inspection was requested, do not mutate branches or GitHub state.

## Handle conflicts

After a rebase conflict:

```bash
# resolve files
git add <resolved-files>
gh stack rebase --continue
```

Use `gh stack rebase --abort` to restore the pre-rebase stack. If `sync` detects a conflict, it restores the stack first; rerun `gh stack rebase` to resolve it interactively.

## Merge or remove stacks

Merge only after the user has approved the exact target:

```bash
gh stack merge <stack-or-pr-number> --yes --squash
```

A PR target merges that PR and every unmerged PR below it. A stack target merges the full stack. The operation is all-or-nothing unless a merge queue handles the members separately. Use `gh stack merge`, not `gh pr merge`.

Treat unstacking as destructive stack metadata work:

```bash
gh stack unstack <stack-number>
gh stack unstack --local
```

The first changes GitHub and local tracking. `--local` keeps the GitHub stack. Require clear user authorization for either operation.

## Avoid interactive hangs

In agent workflows:

- Use `gh stack view --json`, not bare `view`.
- Use `gh stack submit --auto`, not bare `submit`.
- Pass targets to `init`, `add`, `checkout`, and `merge`.
- Do not run `gh stack modify` or `gh stack switch`; both require a TUI.
- Branch on exit codes and read stderr. A non-interactive divergent `sync` can abort without changes while exiting successfully, so also check for `Sync aborted`.

Consult `gh stack <command> --help` and the [official gh-stack documentation](https://github.com/github/gh-stack) for the installed version.
