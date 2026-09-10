## Claim Verification

Reading the codebase and asking "what is the manifest missing?" finds omissions. It finds a wrong claim only by luck, because nothing in the codebase points back at the sentence that describes it incorrectly. This procedure runs in the opposite direction: take each claim the manifest makes, and go find the file that refutes it. Its cost scales with how much documentation exists, not with how large the codebase is — a quiet week in the source still leaves every claim unexamined.

### Claim Inventory

Before anything is verified, list what the documents in scope actually assert. A claim is any of these:

- A symbol, path, class, or file named as existing — or named as absent.
- A literal value: a version, a config key, a cron pattern, a table name, a port, a URL.
- A statement about what a method, query, constructor, loop, or catch clause does.
- A `Purpose`, `Description`, or `Contents` cell in any table.
- An `A → B` arrow in a data flow.
- Any sentence containing *all, every, only, never, none, no, anywhere, does not, atomic, automatic, unified, always*.

The inventory is the artefact the verification phase consumes. A pass that verifies as it discovers is forming a verdict before it knows what it is verdicting on.

### Coverage Floor

A pass touches every document in scope before it deepens in any one of them. For each document, verify at least one claim from each category it carries — a table `Purpose`/`Description` cell, an absence claim, a quantifier sentence, a control-flow claim, wherever the document has one — appending each result to the sink as it clears. Only once every document has cleared this floor does the remaining budget go to *Ordering*'s tiers. A pass that spends its whole budget deepening tier 1 has skipped every document tier 1 didn't route it to, and skipping a document outright is exactly what the floor exists to prevent.

### Coverage

The floor above fixes breadth at one touch per document; what varies pass to pass is depth. Report coverage by document, distinguishing floor-only from deepened, and name every category left at floor depth that nobody went back to. "No findings" at floor depth reads identically to "no findings" at full depth, and only one of the two clears a document.

The figure a pass reports is the figure it did not set for itself. A coverage claim shaped by how much depth a pass reached, rather than how many documents it opened, describes the pass and not the manifest.

### Verification Method by Claim Type

Each type fails differently, so each needs its own move. A single generic "check it against the code" verifies the types it happens to suit and waves the rest through.

| Claim type | How it is verified |
|---|---|
| **Absence** | Grep by **subject** — the path, symbol, or extension family — never by the phrase the document uses. Record the exact command in the working notes, so the next pass re-runs the command instead of re-reading the sentence. |
| **Literal value** | Open the file that owns the value — `pom.xml`, `package.json`, `application*.yml`, `Makefile`, `.env.example` — and compare character by character. A version repeated in three documents is three claims, not one. |
| **Control flow / semantics** | Read the body: the SQL statement, the `switch`, the `catch` ladder, the loop condition. See *Read the Statement* below. |
| **Role or purpose** | Open the class's public surface and one call site. A class named `SmsSubmissionService` may submit to something other than SMS, and a cell naming a class that exists has been checked for spelling and nothing else. |
| **Branch completeness** | Read A and enumerate every branch that reaches a different B. One arrow where the code has two is a wrong claim, not an incomplete one. |
| **Quantifier or adjective** | Find the pointer that supports the word, or drop the word. An adjective added while rewriting a sentence for readability is the one with nothing behind it. |
| **Internal contradiction** | Grep the subject within the document and across the set. See *Contradiction Sweep* below. |

### Read the Statement

Every claim about what code *does* is verified against the statement that does it. A method name, a call site, a passing test, and the commit message that introduced the method are all secondary sources, and each one has produced a wrong manifest claim.

The high-risk families are the ones whose names read like documentation: `mark*`, `find*`, `get*`, `is*`, and any `execute()` on a processor or handler. `markDeferred()` sounds like it sets a deferred flag; whether it does is a property of its body.

### Contradiction Sweep

A summary table row states a conclusion and drops the reasoning that would have exposed a conflict, so a table and its own prose section can disagree inside one file without either looking wrong.

The sweep is mechanical, and its subject list is open: **every symbol named twice anywhere in scope is a sweep subject**, wherever it appears. A closed list of constructs — literals, arrows, status names, table rows — checks the places contradictions were found before, and a test-class name inside a prose bullet is none of those.

Derive the subject list by command rather than by reading: extract the backtick-wrapped identifiers across the document set, count their occurrences, and sweep every one appearing more than once. Compare each hit against the others, and each table row against the prose section covering the same subject. The finding is the pair, not either half.

### Ordering

The *Coverage Floor* fixes breadth; this order governs the depth that follows it, once every document in scope has cleared the floor. Verification runs in this order:

1. **Prose nobody outside this pass has read** — every sentence in a document that comes back added when diffed against the project's main line, however many log entries record a pass over it. A manifest sitting a few commits from its last logged pass on a long-running, unmerged branch counts here in full: a pass reads its own prose while writing it, and that reading confirms the reasoning instead of testing the claim, so an earlier pass by this persona family never earns a document an exemption.
2. **Table rows**, `Purpose` and `Description` cells first.
3. **Quantifier and adjective sentences.**
4. **Everything else.**
5. **Facts a previous pass corrected** — last, and only where the four above are exhausted.

Step 5 sits at the bottom deliberately. Those facts have already been examined by someone holding a finding, which makes them the best-verified material in the document and the worst use of a pass — and it is the most natural order to fall into, because the previous pass left a list of exactly what to look at. A pass whose step 1 resolves to the same items as step 5 has confused the commit its last review read with the prose nobody has actually checked — diffing against the main line, not the log, is what tells them apart.

### Constraints

- Build the inventory before verifying anything, and clear the Coverage Floor for every document before deepening in any one of them. Sampling a category evenly across documents is not the same as opening each document once, and going straight to tier 1's depth leaves the rest of the manifest exactly as untouched as the last pass did.
- Report coverage by document, floor-only versus deepened, and by category within each. A pass that left a document at floor depth and reports "no findings" reads as a clearance it did not perform.
- Attach an evidence pointer to every claim — a `file:line` reference, or the exact command that established an absence. {{unpointed_claim_action}}
- Never infer semantics from a name, a caller, a test, or a commit message. Open the statement. Where the statement cannot be reached, the claim is reported as unverified rather than repeated.
- Grep by subject, never by phrasing. The **subject** is the symbol, path, literal value, or concept term a claim is about. A grep for the sentence a document happens to use finds that document and misses the four others stating the same fact differently.
- Never treat an emphatic claim as a settled one. "There is no X anywhere", "never", "only", and "has no caller" were each verified once and stated with the confidence that verification earned — and that confidence is exactly what stops them being re-checked when the change that falsifies them lands.
- Never bound *Claim Verification* by the last logged commit. That range says what moved, not which prose has been read, and a two-commit range yields a worklist small enough to finish and narrow enough to prove nothing — diff against the project's main line instead to find what counts as unread.
