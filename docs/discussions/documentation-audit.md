# Question: How to word a documentation audit prompt?

> To get a high-quality audit, you should position the agent as a **Senior Technical Architect** or a **QA Lead**. The goal is to move away from "Does this look okay?" and toward "Find the friction points between my plan and the reality of the code."

Here is an effective, structured prompt you can use.

----

## 🛠️ The "Discrepancy Audit" Prompt

**Instructions:** Paste your entire Markdown requirements document and then paste your current code files before sending this prompt.

> **Role:** You are acting as a Senior Technical Architect and QA Lead.
> **Task:** Perform a "Consistency Audit" between my **Requirements Specification** (provided above) and the **Actual Implementation** (the code provided above).
> **Goal:** Identify exactly where the code and the document have drifted apart so I can decide whether to update the document or fix the code.
> **Please provide the audit in the following format:**
> 1. **Undocumented Implementation:** List any logic or features present in the code that are *not* described in the specification (e.g., specific error handling, helper methods, or case restoration details).
> 2. **Unimplemented Requirements:** List any features or constraints described in the specification that are *missing* or incomplete in the current code.
> 3. **Contradictions:** Identify where the code does something *differently* than what the specification dictates.
> 4. **Implicit Assumptions:** Note any "guesses" the code is making that should be explicitly defined in the specification (e.g., file encodings, default timeout values, or path assumptions).
> 
> 
> **Do not update the document yet.** Simply provide the list of discrepancies for my review.

### Copy & paste prompt

```markdown
@workspace 
**Role:** You are acting as a Senior Technical Architect and QA Lead.
**Task:** Perform a "Consistency Audit" between my **Requirements Specification** (the active document) and the **Actual Implementation** (the code in the workspace).
**Goal:** Identify exactly where the code and the document have drifted apart so I can decide whether to update the document or fix the code.
**Please provide the audit in the following format:**
1. **Undocumented Implementation:** List any logic or features present in the code that are *not* described in the specification (e.g., specific error handling, helper methods, or case restoration details).
2. **Unimplemented Requirements:** List any features or constraints described in the specification that are *missing* or incomplete in the current code.
3. **Contradictions:** Identify where the code does something *differently* than what the specification dictates.
4. **Implicit Assumptions:** Note any "guesses" the code is making that should be explicitly defined in the specification (e.g., file encodings, default timeout values, or path assumptions).
 
**Do not update the document yet.** Simply provide the list of discrepancies for my review.
```

----

## 💡 Why this wording works

* **"Discrepancy Audit":** This term tells the agent you are looking for *differences*, not just a thumbs-up.
* **"Do not update yet":** This is the most important part. It prevents the agent from "hallucinating" a new version of your document before you’ve had a chance to verify if the code changes were even intentional.
* **"Implicit Assumptions":** This forces the agent to look for things like `UTF-8` encoding or `SearchOption.TopDirectoryOnly`—technical details that are often in the code but forgotten in the high-level document.

----

## 📈 Next Steps: How to handle the output

Once the agent gives you the list, you can process it efficiently:

1. **For valid code improvements:** Say, *"Point #1 in your audit is a good addition. Please rewrite Section 2.3 of my Markdown document to include that logic."*
2. **For code errors:** Say, *"Point #3 is actually a bug in the code. The specification is correct. Please rewrite the `ApplyLoadOrderAsync` method to align with the document."*
3. **For missing specs:** Say, *"I forgot to specify the backup logic mentioned in Point #2. Let's add a 'Safety' section to the document for that."*

This keeps you in the "Architect" seat, ensuring that the **Specification** remains the boss of the **Code**, rather than the other way around.
