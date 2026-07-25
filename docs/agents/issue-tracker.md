# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

This repo uses GitHub issues for wayfinder maps and tickets. GitHub here supports **native** sub-issues and blocking, so use them directly (no body convention needed).

- **Map**: a single issue labelled `wayfinder:map`. Body uses the wayfinder map template (Destination / Notes / Decisions so far / Not yet specified / Out of scope). Open child tickets are found by query — do not list them in the body.
- **Tickets**: child issues of the map, labelled `wayfinder:<type>` (`research` | `prototype` | `grilling` | `task`). Each body starts with `## Question`. Create with `--parent <map>` to attach as a sub-issue.
- **Blocking**: use native blocking — `--blocked-by <csv>` (comma-separated numbers) when creating, or `gh issue edit <n> --add-blocked-by <csv>` afterward. A ticket is on the frontier when every ticket blocking it is closed.
- **Claiming**: assign the ticket to the dev driving it (`gh issue edit <n> --add-assignee <user>` or `--assignee @me` on create). An open, unassigned ticket is unclaimed.
- **Resolve**: post the answer as a comment, close with `gh issue close <n> --comment "..."`, then append a one-line gist (linking the ticket) to the map's **Decisions so far** via `gh issue edit <map> --body-file ...`.
