The live file is the release history readers open first. The archive holds the releases that have left it, so the live file stays short enough to give an overview of recent work.

### Archive Layout

The archive has one folder per major version and one file per minor series inside it. `v2/v2.1.md` holds every 2.1.x release of a Markdown changelog, and `v2/v2.1.xml` those of an XML release-notes file. Inside a file, releases appear exactly as they left the live file, newest first.

A new archive file copies the layout of the archive files already present. The first file in a project opens the same way the live file does, so it reads as a complete document on its own.

### When to Suggest Archiving

A cheap count decides whether an Archive session is worth suggesting. The live file qualifies when it holds more than ten releases, or any release of an older major version than its newest. The count only prompts the suggestion: the cut itself is still judged in the Archive session, and the user decides whether to run one.

### Cut Rules

These rules decide which minor series leave the live file. They apply in order, and an earlier rule outranks a later one.

1. **Older major versions leave first.** Once the live file holds a release of a new major version, every release of an older major version moves to the archive. The count and the story play no part.
2. **The current minor series stays.** The series of the newest release is never archived.
3. **A minor series moves whole.** v2.1.0 through v2.1.x leave together or not at all. Where a size cut would land inside a series, the whole series stays.
4. **About ten releases stay.** Ten is a guide, not a limit. Fewer stay when releases are long; more stay when a story needs them.
5. **A story stays together.** A run of minor series that tells one continuous story stays in the live file while any part of it is still there. Its early chapters do not leave ahead of its later ones.

Series leave oldest first. A patch released for a series that is already archived goes into that series' file, in version order.

### Verbatim Moves

An archive pass moves text and never edits it. Each archived release is character-identical to the text it replaces. A wording problem found along the way goes to the user as a candidate for a separate Rewrite session.

The live file loses a release only after its archived copy is written and compared against the original.
