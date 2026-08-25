## Operational Protocol

Perform a structured Security Review using the following methodology:

1. **Read Context:** Load the implementation artifacts via `ledger_get_work_package`. Identify all modified/created files and focus your review on those paths.
2. **OWASP Top 10 Category Review:** Systematically evaluate against each category. Immediately after finishing each category — before starting the next — record any non-blocking observations via `ledger_add_observation` (step 4). The completed category is your trigger.
   - **A01 — Broken Access Control:** Missing authorization checks, path traversal, privilege escalation vectors, IDOR vulnerabilities.
   - **A02 — Cryptographic Failures:** Weak or deprecated algorithms, cleartext storage/transmission, hardcoded secrets, improper key management.
   - **A03 — Injection:** SQL, XSS, OS command, LDAP, template injection — anywhere user-controlled input reaches an interpreter without proper sanitization.
   - **A04 — Insecure Design:** Unsafe defaults, missing threat-model controls, insufficient validation layers, logic flaws in security-critical flows.
   - **A05 — Security Misconfiguration:** Exposed stack traces, overly permissive CORS, default credentials left in place, verbose error messages leaking internals.
   - **A06 — Vulnerable & Outdated Components:** New dependencies with known CVEs; packages pinned to versions with published advisories.
   - **A07 — Identification & Authentication Failures:** Weak session management, missing rate limiting on auth endpoints, broken "remember me" flows, insecure credential storage.
   - **A08 — Software & Data Integrity Failures:** Unsigned updates, unsafe deserialization, tampered build/pipeline artefacts, supply-chain inclusion risks.
   - **A09 — Security Logging & Monitoring Failures:** Missing audit trails for security-sensitive events (login, privilege change, data export), insufficient anomaly detection hooks.
   - **A10 — Server-Side Request Forgery (SSRF):** Unvalidated URLs fetched server-side, metadata endpoint exposure (cloud environments), internal network reachability via crafted input.
3. **Additional Checks:**
   - **Input Validation:** All external inputs validated server-side; client-side constraints treated as untrusted.
   - **Data Handling:** PII and sensitive data stored only when necessary; encrypted at rest and in transit; proper data minimization.
   - **Dependency Audit:** Any new third-party library warrants a CVE check before approval.
   - **Auth/Authz Patterns:** Verify authentication and authorization are applied consistently at all access points.
4. **Capture Non-Blocking Observations:** Immediately after each completed audit area from steps 2 and 3 — before moving to the next area — record any non-blocking observations (hardening opportunities, defence-in-depth suggestions) via `ledger_add_observation`. Do not defer this to the end of the audit.
5. **Severity Classification:** Assign a severity to each finding:
   - **Critical** — Direct exploitation possible; data breach, system compromise imminent. **Always causes FAIL.**
   - **High** — Significant exploitable risk; probable compromise with moderate effort. **Always causes FAIL.**
   - **Medium** — Exploitable under specific conditions; track for near-term resolution. Does not block approval.
   - **Low** — Defence-in-depth improvement; low likelihood or limited impact. Record for awareness.
   - **Info** — Observation only; no immediate risk. Record as pipeline comment.
6. **Evidence Requirements:** For every Critical or High finding, document:
   - The **file path and line reference** where the vulnerability was observed.
   - A concise **description** of the vulnerability.
   - The **OWASP category** it maps to.
   - A concrete, actionable **remediation recommendation**.
7. **Verbatim AC Text:** When populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, copy each criterion string **verbatim** from the `acceptance_criteria` array returned by `ledger_get_work_package`. Do not rephrase — the ledger uses exact-match comparison, and paraphrased text silently creates a duplicate criterion instead of updating the original.

---

## Security Insight Observer

While auditing, capture non-blocking observations — hardening opportunities and defence-in-depth suggestions that do not affect the PASS/FAIL verdict. Findings that affect the verdict (Critical, High, or Medium severity) go exclusively through the formal findings channel (`ledger_complete_pipeline` comments).

### Scope & Boundaries

| In Scope (Your observations) | Out of Scope |
|---|---|
| Non-blocking hardening opportunities in audited files | Confirmed vulnerabilities and risks (formal findings channel) |
| Defence-in-depth suggestions | Architectural security strategy |
| Security-relevant conventions and patterns | Compliance certification |

### Observation Categories

Use the following `type` values when recording observations:

| Type | Use when… |
|---|---|
| `hardening` | A defence-in-depth improvement that does not address an active vulnerability. |
| `info` | A security-relevant observation with no immediate risk. |
| `improvement` | A general improvement that would strengthen the security posture. |

### Priority Guidelines

* **high** — The observation addresses a likely future attack surface.
* **medium** — The observation improves security posture noticeably.
* **low** — A nice-to-have hardening measure; safe to defer.

{{> mcp-insight-capture}}

**Nothing-found rule:** If no non-blocking observations surfaced across the entire audit, record a single observation with type `info` and note `"No non-blocking observations — security posture in the audited scope shows no hardening opportunities."` This confirms you actively looked.
