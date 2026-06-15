# Question: Is prompt clear enough?

> In principle, when I am unsure whether my prompt is clear enough, I ask the agent if the information provided is clear enough. Is this the correct way to do it, or are there other ways?

----

Asking an agent "Is this clear?" is a good instinct, but it often triggers what we call **"The Yes-Man Bias."** Because AI models are trained to be helpful and agreeable, they will frequently say "Yes, everything is clear!" and then proceed to fill in any gaps in your instructions with their own assumptions—which may or may not align with your actual intent.

To get a truly high-fidelity result, there are three more effective ways to verify clarity.

----

## 1. The "Mirroring" Technique (The Best Way)

Instead of asking *if* it understands, ask the agent to **summarize or paraphrase** the requirements back to you in its own words before it writes a single line of code.

> **Prompt:** "Before you start coding, please summarize my requirements and list the specific architectural choices you intend to make. I want to ensure we are aligned."

This forces the agent to expose its "internal map." If the summary misses a key detail (like the case-sensitive restoration), you can catch it before the agent wastes time and context window generating incorrect code.

----

## 2. The "Pre-Flight Plan"

For complex tasks like your WPF app, ask for a **technical plan or pseudocode** first. This is like a blueprint check.

> **Prompt:** "Provide a brief technical outline of how you will implement the `FileService` reordering logic. Specifically, how will you handle the intersection of the reference file and the current file?"

----

## 3. The "Inquisitive Persona"

You can explicitly give the agent "permission" to be skeptical or curious. This overrides its default tendency to just start working.

> **Prompt:** "I am going to provide a project specification. I want you to act as a Senior Lead Developer. Read my specification and, instead of starting the work, ask me **three clarifying questions** about edge cases or technical constraints I might have missed."

**Common "Gaps" an agent might find:**

* What happens if `Plugins.txt` is read-only?
* Should we handle empty lines or just delete them?
* What if the `Data` folder is missing some of the files listed in the text file?

----

## Comparison of Methods

| Method | Why it’s better than "Is this clear?" | Best for... |
| ---- | ---- | ---- |
| **Mirroring** | Catching misunderstandings of the "What." | Simple feature additions. |
| **Planning** | Catching misunderstandings of the "How." | Complex logic or architecture. |
| **Inquisitive** | Catching what you *forgot* to include. | Starting a brand new project. |

----

## 💡 Recommendation for your Current Project

Since you are about to move into the UI and ViewModel phase, I recommend using the **Inquisitive Persona** first, followed by **Mirroring**.

When you start that fresh thread we discussed, you could end your "State of the Union" prompt with:

> *"Before you begin building the ViewModels, do you have any questions about the `FileService` methods I provided, or are there any UI edge cases (like error handling or path validation) you think we should define now?"*

This ensures that when the code starts flowing, it’s exactly what you need.
