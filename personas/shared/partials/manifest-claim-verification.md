## Claim Verification

Reading the codebase and asking "what is the manifest missing?" finds omissions. It finds a wrong claim only by luck, because nothing in the codebase points back at the sentence that describes it incorrectly. This procedure runs in the opposite direction: take each claim the manifest makes, and go find the file that refutes it. Its cost scales with how much documentation exists, not with how large the codebase is — a quiet week in the source still leaves every claim unexamined.

### Two Baselines

Two different questions each need their own starting point, and collapsing them into one is what lets a pass examine eight files and call it a manifest.

| Baseline | Set by | Governs |
|---|---|---|
| **Code baseline** | The **Commit** line of the newest `curation-log.md` entry | *Changed-Code Intersection* and *Reverted Decisions* — both ask what moved since the manifest was last verified |
| **Documentation baseline** | The last state of the documentation that anyone outside this pass has examined — the merge-base with the project's main line, the commit an external review covered, or the manifest's first commit where neither exists | *Claim Verification* ordering — which prose has been read by a reviewer, and which has been read by nobody |

The two diverge most sharply on a long-running branch, where a manifest sits a few commits from its code baseline and shows every document as added against its documentation baseline. Diff the documentation against the main line to establish it. A document that comes back as added is new prose in full, however many log entries record a pass over it — a previous pass by this persona family does not move the documentation baseline, because a pass reads its own prose while writing it and that reading confirms the reasoning instead of testing the claim.

### The Census

A pass that sizes its own claim list sizes it by judgement, and under session pressure that judgement returns the number it can reach. So the denominator comes from a command, before a single claim is read. Count each construct across every document in scope, and record each command with its result:

| Construct | Counted by |
|---|---|
| Table data rows | Lines opening with a pipe, less header and separator rows |
| `Purpose` / `Description` / `Contents` cells | Data rows under a table whose header carries one of those columns |
| `A → B` arrows | Occurrences of the arrow glyph or `->` |
| Quantifier sentences | Lines matching the quantifier word list below |
| Named symbols | Occurrences of backtick-wrapped identifiers |
| Literal values | Version, port, path, and config-key patterns |

The census total is the denominator, fixed before verification starts. Where verifying all of it exceeds the session, the pass covers what it can and reports the rest as unverified. That result tells the user another pass is needed; a full-coverage claim does not.

A census in the hundreds against a hand-built inventory in the dozens is not a discrepancy to reconcile. The census is right.

### Claim Inventory

The census says how many claims there are. The inventory says what they are, and it is built second. A claim is any of these:

- A symbol, path, class, or file named as existing — or named as absent.
- A literal value: a version, a config key, a cron pattern, a table name, a port, a URL.
- A statement about what a method, query, constructor, loop, or catch clause does.
- A `Purpose`, `Description`, or `Contents` cell in any table.
- An `A → B` arrow in a data flow.
- Any sentence containing *all, every, only, never, none, no, anywhere, does not, atomic, automatic, unified, always*.

The inventory is the artefact the verification phase consumes.

### Verification Method by Claim Type

Each type fails differently, so each needs its own move. A single generic "check it against the code" verifies the types it happens to suit and waves the rest through.

| Claim type | How it is verified |
|---|---|
| **Absence** | Grep by **subject** — the path, symbol, or extension family — never by the phrase the document uses. Record the exact command in the working notes, so the next pass re-runs the command instead of re-reading the sentence. |
| **Literal value** | Open the file that owns the value — `pom.xml`, `package.json`, `application*.yml`, `Makefile`, `.env.example` — and compare character by character. A version repeated in three documents is three claims, not one. |
| **Control flow / semantics** | Read the body: the SQL statement, the `switch`, the `catch` ladder, the loop condition. See *Read the Statement* below. |
| **Role or purpose** | Open the class's public surface and one call site. A class named `SmsSubmissionService` may submit to something other than SMS. |
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

Verification runs in this order:

1. **Prose new against the documentation baseline** — not against the last logged pass. Where a document shows as added at that baseline, every sentence in it qualifies, including sentences an earlier pass wrote and checked.
2. **Table rows**, `Purpose` and `Description` cells first.
3. **Quantifier and adjective sentences.**
4. **Everything else in the census.**
5. **Facts a previous pass corrected** — last, and only where the four above are exhausted.

Step 5 sits at the bottom deliberately. Those facts have already been examined by someone holding a finding, which makes them the best-verified material in the document and the worst use of a pass — and it is the most natural order to fall into, because the previous pass left a list of exactly what to look at. A pass whose step 1 resolves to the same items as step 5 has taken the code baseline for the documentation baseline; the two are distinct, and *Two Baselines* covers them.

### Verification Tiers

A census in the thousands does not fit one session, so the pass spends a budget rather than working a list. Left to itself it spends that budget on whatever is cheapest — a symbol-existence sweep runs hundreds of checks per minute and almost never fails, so it produces a large verified count and no findings. The expensive checks are the ones that find things.

| Tier | What it covers | Cost per claim | Typical yield |
|---|---|---|---|
| **Tier 1 — Mechanical** | Existence of a named symbol, path, or file; literal values against their source-of-truth file; absence greps; link resolution | Seconds, scriptable in bulk | Low, but near-total coverage for the cost |
| **Tier 2 — Semantic** | What a method or query does; whether a `Purpose` cell matches the class; branch completeness behind an arrow; whether a quantifier holds; contradictions between two statements | Minutes, one file read at a time | High — nearly every wrong claim lives here |

Tier 1 runs first and runs to completion, in bulk, by command. It establishes which names are real, so Tier 2 never spends a file read confirming that a class exists. Tier 2 then takes the entire remaining budget, in the *Ordering* sequence above. Where the budget runs out mid-tier, the pass stops and reports the remainder.

#### The Table-Cell Floor

Within Tier 2, one category is consistently under-spent: the `Purpose`, `Description`, and `Contents` cells that say what a class or module is for. They are the densest wrong claims in any manifest and the least likely to be checked, because a cell naming a real class passes every mechanical test and reads as settled.

So the category carries a floor rather than a position in a queue. Every such cell in scope is checked against the class's public surface and one call site before any other Tier 2 category is considered complete. Where the budget cannot cover them all, the uncovered cells are named individually. A cell naming a class that exists has passed Tier 1 and has not been tested at all.

### Constraints — Tiers

- Finish Tier 1 before opening a single Tier 2 claim, and never let its volume stand in for coverage. A partial mechanical sweep leaves Tier 2 re-establishing facts a command would have settled in bulk; hundreds of existence checks with no semantic reads is a pass that confirmed the manifest's nouns and tested none of its assertions.
- Spend the remaining budget on Tier 2 in *Ordering* sequence, and stop when it is gone. A pass that reverts to cheap checks once the budget tightens is optimising its own verified count.
- Never sample a Tier 2 category evenly across documents to make it look covered. Depth in the highest-priority document beats a thin pass over all of them, since a wrong claim is found by reading its source and not by skimming its neighbours.
- Clear the table-cell floor before any other Tier 2 category counts as done. Never accept a `Purpose` cell because the class it names exists: existence is Tier 1, and only the class's public surface and a call site answer whether it does what the cell claims.
- Report the two tiers separately in every coverage figure, and the table-cell figure separately again. A combined count is dominated by Tier 1, and buried in one total the category that hides the most wrong claims is the one that looks covered.

### Constraints

- Count the census by command, never by reading, and record every command with its result. A total a pass arrives at by working through the document is the same judgement the census exists to replace, and a recorded command lets the next pass re-run it instead of trusting the figure.
- Fix the denominator before verification begins. A denominator adjusted afterwards is fitted to the numerator, and the ratio it produces means nothing.
- Never reconcile a hand-built inventory upward to meet the census. The gap between them is the unverified remainder, and reporting it is the point.
- Build the inventory before verifying anything. A pass that verifies as it discovers is forming a verdict before it knows the denominator.
- Report the denominator from the census, not just the findings — the census total, how many claims were verified, and the remainder. A pass that covered a fraction and reports "no findings" reads as a clearance it did not perform, and verified-equals-census is a claim about the pass that needs its commands shown.
- Attach an evidence pointer to every claim — a `file:line` reference, or the exact command that established an absence. {{unpointed_claim_action}}
- Never infer semantics from a name, a caller, a test, or a commit message. Open the statement. Where the statement cannot be reached, the claim is reported as unverified rather than repeated.
- Grep by subject, never by phrasing. The **subject** is the symbol, path, literal value, or concept term a claim is about. A grep for the sentence a document happens to use finds that document and misses the four others stating the same fact differently.
- Never treat an emphatic claim as a settled one. "There is no X anywhere", "never", "only", and "has no caller" were each verified once and stated with the confidence that verification earned — and that confidence is exactly what stops them being re-checked when the change that falsifies them lands.
- Establish both baselines before ordering anything, record each one, and never bound *Claim Verification* by the code baseline. That range says what moved, not which prose has been read, and a two-commit range yields a worklist small enough to finish and narrow enough to prove nothing.
