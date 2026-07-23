---
description: Push a nested submodule's changes all the way up (submodule → .claude → workspace root)
argument-hint: "<operations|nestjs|react|django|design>  [commit message]"
---

# Push a nested submodule up the chain

The user edited files inside one of `.claude`'s nested submodules and wants the
change to be visible to everyone. Because of nested submodules, a push to the
inner repo alone is invisible — the parent repos still point at the OLD commit.
This command walks the pointer bump up all three levels.

## Input

`$ARGUMENTS` — first word is the submodule name (`operations`, `nestjs`,
`react`, `django`, or `design`). Any remaining words are the commit message.
If no message is given, write a short one summarizing the diff.

## What to do

Work from the workspace root:
`/Users/dongsub/Documents/Potential/projects/claude-fullstack-workspace`

Let `SUB` = the submodule name from `$ARGUMENTS`.

### Step 0 — sanity
- Confirm `SUB` is one of the five valid names. If not, stop and ask.
- Read the submodule's intended branch from `.claude/.gitmodules` (the `branch =`
  line for that submodule — currently `dev` for all five). Call it `BR`.
- Run `git -C .claude/$SUB status -s`. If there are NO changes AND the pointer is
  not ahead, tell the user there's nothing to push and stop.

### Step 1 — inner submodule (`.claude/$SUB`)
- If HEAD is detached (`git -C .claude/$SUB branch --show-current` is empty),
  check out the branch: `git -C .claude/$SUB checkout $BR`.
  - ⚠️ If detached at a commit that is AHEAD of `$BR` (work that isn't on the
    branch yet), do NOT blindly checkout — show the user the situation and ask
    whether to keep that commit. Otherwise proceed.
- Stage, commit, push:
  ```
  git -C .claude/$SUB add -A
  git -C .claude/$SUB commit -m "<message>"
  git -C .claude/$SUB push origin $BR
  ```

### Step 2 — `.claude` (bump the $SUB pointer)
```
git -C .claude add $SUB
git -C .claude commit -m "bump $SUB"
git -C .claude push origin <.claude's current branch, usually dev>
```

### Step 3 — workspace root (bump the `.claude` pointer)
```
git add .claude
git commit -m "bump .claude ($SUB)"
git push
```
Use the root's current branch (do NOT switch branches).

### Step 4 — report
Print a 3-line summary: which commit SHA landed at each level
(`$SUB` → `.claude` → root) so the user can see all three pointers moved.

## Rules
- Inner first, outer last. Never skip a level — a skipped bump means the change
  is invisible to anyone cloning the workspace.
- Only touch the named submodule and the pointer bumps. Do not stage unrelated
  changes (`git add .claude/$SUB` specifically, not `git add .`).
- If any push is rejected (remote ahead), pull/rebase that level and retry before
  moving up.
- Report honestly if a level fails — do not claim success for levels you didn't reach.
