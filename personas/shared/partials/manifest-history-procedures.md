## Reverted Decisions

`constraints.md` is populated from config files, comments, and code patterns — surfaces where someone chose to make a convention visible. A convention nobody wrote down leaves a different trace: one commit makes a change, a later one undoes it. That pair is the codebase recording an approach that was tried and rejected, and it is the one kind of gotcha no current file states.

The **Commit** line of the newest `curation-log.md` entry is the floor for the search. Each pass reads history from that hash to `HEAD`. A first pass on a manifest with no log entry takes a bounded slice of recent history instead.

A revert is a lead, not a finding: `git log` does not distinguish a rejected decision from a botched merge, a release-branch rollback, or an experiment reverted twice. A lead becomes {{revert_lead_outcome}} when the current codebase agrees with it.

### Constraints

- Restrict the search to reverts touching configuration, build, dependency, and architecture-defining files. A reverted feature or bug fix says nothing about a convention, and a wider sweep buys noise.
- Confirm every lead against the current codebase before it goes any further. The convention a revert implies is either visible in the code today or it is not established.
- Never phrase a convention as commit archaeology. `constraints.md` states the convention — "config is loaded through `ConfigService` only" — never its history.

## Changed-Code Intersection

A pass that reads the manifest against itself finds only the contradictions the manifest already contains. It cannot find a document that is internally coherent and no longer true — the common case, where the prose stayed put and the code under it moved.

The intersection narrows the codebase to the part the manifest makes claims about. Take the source files changed since the last logged pass, and keep the ones whose classes, modules, or symbols the manifest names. For each survivor, read the file's diff, then re-read every manifest document that names it. The list is bounded by how much code moved rather than by how large the codebase is.

### Constraints

- Derive the change list from the commit in the newest log entry — the code baseline, and the same floor the *Reverted Decisions* search uses. It bounds this procedure alone; *Claim Verification* runs from the documentation baseline instead.
- Read every commit in the list in full where its diff touches a documented class. Mining a diff for the one item that put it on the list misses everything else that commit changed, and that remainder is where the wrong claims come from.
- Never substitute a commit count for the intersection. A count says work happened; only the file list says which documented claims are now suspect.
- Treat a small intersection exactly as an empty one, and never let either stand in for a pass. An empty range is visibly nothing and prompts the fallback; a short worklist looks like a pass and is finished comfortably inside a session. Neither says anything about the claims nobody has opened a file against, and *Claim Verification* covers the census regardless.
- Skip either procedure where the project has no Git repository or the clone is shallow, and record the skip in the log entry.
