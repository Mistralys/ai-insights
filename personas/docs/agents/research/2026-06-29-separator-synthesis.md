# Research Report

## Problem Statement

Synthesize and verify the claims made across three LLM responses (Gemini, Claude Opus 4.8, Copilot) and one detailed research paper regarding the functional impact of Markdown horizontal rules (`---`) on LLM document comprehension. Rate each claim by credibility based on verifiable evidence.

## Problem Decomposition

1. **Claim extraction:** What specific claims does each source make, for and against `---` as a structural tool?
2. **Source reliability:** How authoritative is each source, and do they cite verifiable evidence?
3. **Cross-verification:** Which claims are corroborated by vendor documentation, peer-reviewed research, or reproducible benchmarks?
4. **Consensus vs. divergence:** Where do the sources agree, and where do they contradict each other?
5. **Actionable conclusion:** What is the evidence-based verdict?

## Context & Constraints

- Four sources were analyzed: Gemini (web), Claude Opus 4.8 (web), Copilot (web), and a detailed research paper.
- Verification was performed against: Anthropic's official prompt engineering documentation, OpenAI's prompt engineering guide, DAIR.AI's Prompt Engineering Guide, the Sclar et al. (2023) paper on prompt formatting sensitivity (ICLR 2024), the Bsharat et al. (2023) 26 principles paper, and two third-party blog sources (bulkmd.app, allmarkdowntools.com).
- No peer-reviewed study was found that directly isolates Markdown `---` horizontal rules as a variable in LLM comprehension experiments.

---

## Source Characterization

### Source 1: Gemini (Web)

**Stance:** Strongly pro-separator. Presents `---` as a functional structural tool with significant impact.

**Tone:** Assertive, prescriptive. Makes mechanistic claims about transformer attention without citations.

**Key claims:**
1. `---` prevents "context bleeding" by causing the attention mechanism to "recalibrate its focus"
2. `---` tokenizes into "a single, clean structural token" that acts as an "anchor point"
3. `---` improves factual recall and reduces the "lost in the middle" problem
4. Separators should be combined with headings for best effect

### Source 2: Claude Opus 4.8 (Web)

**Stance:** Cautiously supportive. Acknowledges a weak learned signal but emphasizes limitations.

**Tone:** Analytical, hedge-heavy. Distinguishes between what is measured and what is inferred. Cites specific papers.

**Key claims:**
1. LLMs have no Markdown parser; `---` is a token stream, not a structural instruction
2. `---` carries a "weak but real" learned association with boundaries from training data
3. The Sclar et al. study demonstrates up to 76 accuracy points variance from formatting changes
4. No study has isolated `---` in long-document comprehension specifically
5. XML tags are a stronger lever for Claude specifically
6. LLM-generated `---` is a "learned stylistic tic," not evidence of functional value

### Source 3: Copilot (Web)

**Stance:** Skeptical. Positions `---` as a weak, largely cosmetic signal.

**Tone:** Structured, lists-heavy, definitive. Cites third-party blog sources.

**Key claims:**
1. `---` is "not a strong structural cue" — weaker than headings, lists, and tables
2. Retrievers do not use `---` as chunk boundaries
3. `---` may help readability and reduce pronoun confusion (a "soft" effect)
4. `---` adds 3–5 tokens of overhead
5. `---` is useful only for "soft prompting," not for structure

### Source 4: Research Paper

**Stance:** Balanced. Concludes `---` is "functional but weak."

**Tone:** Systematic, well-structured. Cites vendor documentation directly.

**Key claims:**
1. Vendor documentation (Anthropic, OpenAI, DAIR.AI) recommends XML tags, headings, and `###` — but not `---` explicitly
2. `---` provides boundary detection without semantic labeling (unlike headings)
3. `---` is redundant in well-headed documents
4. `---` is the weakest structural signal compared to headings, `###`, and XML tags
5. No published attention-pattern analysis exists for `---` tokens specifically

---

## Claim Verification & Credibility Ratings

### Claims IN SUPPORT of `---` as a Functional Tool

| # | Claim | Source(s) | Evidence Found | Credibility |
|---|-------|-----------|---------------|-------------|
| S1 | `---` carries a learned association with boundaries from training data | All four | **Inferential but well-grounded.** LLMs are trained on massive corpora of Markdown (GitHub, Wikipedia, documentation) where `---` consistently appears at topic boundaries. No direct measurement exists, but the statistical argument is strong by construction. | **High** — The inference is mechanistically sound even without a direct study. |
| S2 | Formatting choices (including separators) measurably affect LLM performance | Claude, Research Paper | **Confirmed.** Sclar et al. (arXiv:2310.11324, ICLR 2024) found up to 76 accuracy points variance on LLaMA-2-13B from formatting perturbations. The paper explicitly lists "separators" among its atomic perturbations. | **Very High** — Peer-reviewed (ICLR 2024), directly verified on arXiv. |
| S3 | `---` prevents "context bleeding" by recalibrating the attention mechanism | Gemini | **Unverified.** No published study measures attention weight redistribution at `---` tokens. The attention mechanism processes all tokens simultaneously; `---` does not cause a "recalibration." The claim misrepresents how self-attention works. | **Low** — Mechanistically misleading. Transformers do not "recalibrate" at separators; attention is computed over the full sequence in parallel. |
| S4 | `---` collapses into "a single, clean structural token" acting as an "anchor point" | Gemini | **Partially verified.** Modern tokenizers (cl100k, Claude's tokenizer) do often encode `---` as 1–2 tokens. But "anchor point" implies a special retrieval function that has no empirical basis. allmarkdowntools.com confirms `---` has minimal token overhead but does not describe an anchor function. | **Medium** — Tokenization claim is approximately correct; "anchor point" claim is unsubstantiated. |
| S5 | `---` reduces the "lost in the middle" problem | Gemini | **Unverified.** The "lost in the middle" finding (Liu et al., 2023) concerns position-based retrieval degradation in long contexts. No follow-up study has tested whether inserting `---` tokens mitigates this effect. | **Low** — No evidence connects `---` to the lost-in-the-middle phenomenon. |
| S6 | `---` can be used for structure-aware chunking in RAG pipelines | Gemini | **Partially contradicted.** Copilot's answer and bulkmd.app both state that retrievers chunk on headings, paragraph breaks, tables, and code blocks — not on `---`. allmarkdowntools.com mentions `---` under "Separator Patterns for Complex Prompts" but not as a chunking boundary. Custom implementations could use `---` for chunking, but standard tooling does not. | **Low-Medium** — Custom pipelines could be built this way, but it is not standard practice. |
| S7 | `---` helps readability and reduces pronoun confusion | Copilot | **Partially supported.** bulkmd.app notes that "models lose the antecedent in pronoun-heavy paragraphs" and standalone sentences under headings are cited more reliably. A `---` creating visual separation could plausibly reduce this, but the measured effect is attributed to headings, not `---`. | **Medium** — Plausible inference, but the measured benefit is from headings, not horizontal rules. |
| S8 | `---` works best when combined with headings | Gemini, Research Paper | **Supported by vendor guidance.** Both Anthropic (XML tags + structure) and OpenAI ("Markdown headers and lists") recommend combined structural approaches. The logical extension is that `---` + headings is better than `---` alone. However, this also implies `---` is redundant when headings are present. | **High** — Well-supported, though it paradoxically undermines the case for `---` by itself. |

### Claims AGAINST `---` as a Functional Tool

| # | Claim | Source(s) | Evidence Found | Credibility |
|---|-------|-----------|---------------|-------------|
| A1 | LLMs have no Markdown parser; `---` is just tokens, not a structural instruction | Claude | **Correct.** LLMs process token sequences. There is no AST parser for Markdown in the model architecture. Any structural understanding is an emergent property of training, not a built-in parser. | **Very High** — Architecturally accurate. |
| A2 | No vendor explicitly recommends `---` for prompt structuring | Research Paper | **Confirmed.** Anthropic recommends XML tags. OpenAI recommends "Markdown headers and lists." DAIR.AI recommends `###`. None mention `---` horizontal rules as a recommended structural tool. Anthropic's own prompt engineering page was fetched and searched thoroughly — `---` is not mentioned as a recommendation. | **Very High** — Directly verified against all three vendor sources. |
| A3 | `---` is the weakest structural signal compared to headings, XML tags, and `###` | Copilot, Research Paper | **Strongly supported.** `---` carries no semantic label (unlike headings), no hierarchy (unlike `#`/`##`/`###`), and no nestability (unlike XML). Every vendor recommendation favors one of these alternatives. allmarkdowntools.com lists headings, lists, code blocks, and tables as high-impact elements; `---` is not in this list. | **Very High** — Converging evidence from all sources and vendor documentation. |
| A4 | Standard retrievers do not use `---` as chunk boundaries | Copilot | **Supported.** bulkmd.app describes chunking based on headings, code fences, and paragraph breaks. Cursor's indexer is described as using "headings as chunk boundaries, code fences treated as atomic units." No source mentions `---` as a chunk delimiter. | **High** — Consistent across all retrieval-focused sources. |
| A5 | `---` is redundant in well-structured documents with headings | Claude, Research Paper | **Logically sound.** If a heading already signals a section boundary and provides a semantic label, adding `---` provides only a small visual reinforcement. The research paper demonstrates this with a code example showing `---` between two headed sections carrying "negligible additional structural information." | **High** — Logically necessary given that headings subsume the boundary signal `---` provides. |
| A6 | LLM-generated `---` is a stylistic tic, not evidence of functional value | Claude, Research Paper | **Well-reasoned inference.** LLMs reproduce formatting patterns from training data. The fact that models output `---` does not prove it helps comprehension — it proves the model learned that "good Markdown documents" contain `---`. This is distribution-matching, not structural optimization. | **High** — Sound reasoning about generative model behavior, though no direct study confirms it. |
| A7 | Overuse of `---` creates "token noise" that dilutes the signal | Gemini, Claude | **Plausible.** If `---` carries a weak "boundary" signal, using it after every paragraph degrades the signal-to-noise ratio. This follows from the general principle that overuse of any formatting cue reduces its distinctiveness. No direct measurement exists. | **Medium-High** — Logically consistent with how learned associations work, but unmeasured. |
| A8 | XML tags are a strictly stronger delimiter for Claude specifically | Claude, Research Paper | **Confirmed.** Anthropic's documentation explicitly states: "XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs." This is a direct vendor recommendation with no equivalent statement about `---`. | **Very High** — Direct vendor documentation, verified. |

---

## Source Reliability Assessment

| Source | Reliability | Rationale |
|--------|------------|-----------|
| **Gemini (Web)** | **Low-Medium** | Makes the strongest pro-separator claims but provides no citations. Several claims (attention recalibration, anchor points, lost-in-the-middle mitigation) misrepresent transformer mechanics or lack evidence. The best practices section is reasonable but overstates the effect size. |
| **Claude Opus 4.8 (Web)** | **High** | Most epistemically careful response. Explicitly separates measured results from inference. Correctly identifies the Sclar et al. paper and its scope. Accurately characterizes the gap between "formatting affects behavior" (measured) and "`---` specifically helps comprehension" (unmeasured). |
| **Copilot (Web)** | **Medium** | Reaches a reasonable conclusion but relies on third-party blog sources (allmarkdowntools.com, bulkmd.app) rather than academic papers or vendor documentation. Some claims are well-supported; others inherit the reliability level of their blog sources. |
| **Research Paper** | **High** | Most comprehensive and systematic. Directly cites and correctly quotes vendor documentation. The comparative evaluation table is well-structured. The "functional but weak" conclusion is well-calibrated. Minor limitation: cites DAIR.AI Prompt Engineering Guide's `###` recommendation but doesn't note that `###` is used as a bare separator (not a heading) in that context. |
| **Anthropic docs** | **Very High** | Primary vendor documentation for Claude. Directly verified. |
| **OpenAI docs** | **Very High** | Primary vendor documentation for GPT models. Directly verified. Explicitly recommends "Markdown headers and lists." |
| **DAIR.AI** | **High** | Widely cited, peer-reviewed-adjacent prompt engineering resource. Verified recommendation for `###` separators. |
| **Sclar et al. (2023)** | **Very High** | Peer-reviewed at ICLR 2024. Directly addresses prompt formatting sensitivity. Confirmed on arXiv. |
| **bulkmd.app** | **Low-Medium** | Product blog for a Markdown conversion tool. Self-reported benchmarks without peer review. Clear commercial interest in promoting Markdown formatting. Benchmarks are described but methodology is informal. |
| **allmarkdowntools.com** | **Low-Medium** | Product blog for a Markdown tool. No citations. Claims are reasonable but unverified. Notably mentions `---` under "Separator Patterns" as preventing "context from bleeding into instructions" — a claim without supporting evidence. |

---

## Consensus Map

### All four sources agree on:

1. `---` is **not purely cosmetic** — it carries some learned meaning from training data.
2. **Headings are strictly superior** to `---` for structuring documents.
3. **Overuse dilutes the signal** — `---` after every paragraph is counterproductive.
4. **Combining `---` with headings** is the recommended pattern if `---` is used at all.

### Sources diverge on:

| Question | Gemini | Claude | Copilot | Research Paper |
|----------|--------|--------|---------|----------------|
| **Effect size** | Large ("significant") | Small ("weak signal") | Minimal ("not strong") | Small ("weak but real") |
| **Mechanism** | Attention recalibration | Statistical association | Inferential readability | Learned training pattern |
| **RAG/retrieval impact** | Yes (chunk boundaries) | Not discussed | No (not used by retrievers) | Not directly |
| **Recommended?** | Yes, enthusiastically | Only for peer-level boundaries | Only for soft prompting | Only as visual reinforcement |
| **Token concern** | Not mentioned | Not mentioned | Yes (3–5 tokens) | Very low (1–2 tokens) |

---

## Recommendation

### Verdict: `---` is a weak, real, but largely redundant structural signal.

The evidence converges on a clear conclusion:

1. **The functional effect exists but is weak.** The Sclar et al. paper (ICLR 2024) confirms that formatting details, including separators, affect LLM performance. This is the strongest available evidence, though it tests separators between few-shot examples, not `---` in long documents.

2. **No vendor recommends `---` specifically.** All three major prompt engineering resources (Anthropic, OpenAI, DAIR.AI) recommend headings, XML tags, or `###` — never `---`. This is the most telling negative evidence: if `---` had measurable value, it would appear in at least one vendor guide.

3. **`---` is subsumable by headings.** Anywhere a `---` provides value, a heading would provide strictly more value (boundary + label + hierarchy). The only exception is separating peer-level items where a heading would be semantically inappropriate (e.g., between examples or log entries).

4. **The strongest claims (Gemini) are the least supported.** Claims about attention recalibration, anchor points, and lost-in-the-middle mitigation have no empirical basis and misrepresent transformer mechanics.

### Practical Guidelines

- **Keep existing `---` in well-structured documents.** They are harmless and aid human readability. Stripping them provides no measurable benefit.
- **Do not add `---` as a substitute for headings.** If you need a section boundary, use a heading.
- **Use `---` for peer-level item separation** where headings would be too heavy (between examples, between distinct alternatives, between log entries in a sequence).
- **For Claude prompts specifically, prefer XML tags** (`<context>`, `<instructions>`) for reliable structural parsing.
- **For OpenAI prompts, prefer Markdown headings** (`# Identity`, `## Instructions`, `## Examples`).
- **Do not add `---` after every section heading** — this is the redundancy pattern LLMs reproduce from training data, and it adds no value.

## Open Questions

- **No direct `---` isolation study exists.** No published paper measures the effect of `---` horizontal rules as section dividers in long-document comprehension tasks. All available evidence is either about formatting sensitivity in general (Sclar et al.) or inference from the mechanism.
- **Model-specific tokenization differences.** Different tokenizers may encode `---` differently (1 token vs. 2–3 tokens). The practical impact of this difference is unknown.
- **YAML confusion risk.** In prompts containing YAML content, `---` could theoretically be misinterpreted as a YAML document boundary. No study quantifies this risk.
- **Attention pattern analysis.** Mechanistic interpretability studies that directly measure attention weight distribution at `---` tokens versus heading tokens would settle the debate definitively.

## References

### Verified Primary Sources

- Anthropic. "Prompting best practices." https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices (accessed 2026-06-29). **Verified.** Key quote: *"XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs."* Does not mention `---`.
- OpenAI. "Prompt engineering." https://developers.openai.com/docs/guides/prompt-engineering (accessed 2026-06-29). **Verified.** Key quote: *"Markdown headers and lists can be helpful to mark distinct sections of a prompt, and to communicate hierarchy to the model."* Does not mention `---`.
- DAIR.AI. "General Tips for Designing Prompts." https://www.promptingguide.ai/introduction/tips (accessed 2026-06-29). **Verified.** Key quote: *"use some clear separator like '###' to separate the instruction and context."* Recommends `###`, not `---`.

### Verified Academic Papers

- Sclar, M., Choi, Y., Tsvetkov, Y., & Suhr, A. (2023). "Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design." arXiv:2310.11324. **Verified — ICLR 2024.** Confirms up to 76 accuracy points variance from formatting perturbations on LLaMA-2-13B. Separators are among the atomic perturbations studied.
- Bsharat, S. M., Myrzakhan, A., & Shen, Z. (2023). "Principled Instructions Are All You Need for Questioning LLaMA-1/2, GPT-3.5/4." arXiv:2312.16171. **Verified.** 26 guiding principles for prompt design.

### Third-Party Sources (Lower Reliability)

- bulkmd.app. "How AI Agents Read Markdown Context in 2026." https://bulkmd.app/blog/markdown-context-for-ai-agents (accessed 2026-06-29). **Product blog with self-reported benchmarks.** Interesting but not peer-reviewed. Clear commercial interest. Notably, discusses headings and tables as structural signals — does not mention `---` as significant.
- allmarkdowntools.com. "LLM Markdown Formatting Guide." https://allmarkdowntools.com/blog/llm-markdown-formatting-guide (accessed 2026-06-29). **Product blog without citations.** Mentions `---` under "Separator Patterns for Complex Prompts" but does not provide evidence for the claim that it "prevents context from bleeding into instructions."
- Karpathy, A. "Let's build the GPT Tokenizer." https://youtu.be/zduSFxRajkE. Cited by the research paper. Educational lecture on tokenization mechanics — does not address `---` specifically.
