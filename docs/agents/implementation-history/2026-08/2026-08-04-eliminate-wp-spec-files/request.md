# Original Request

## Initial Question

> With the updated WP storage which now includes the full WP detail from the file on disk, I wonder if we could skip writing the WP files to disk entirely, and have the agents use the ledger tools instead? Only if this has an advantage over using files (like less token usage, for example).

## Clarification: No Backward Compatibility

> I don't think that we need to make the work package file optional - we do not have any backwards compatibility considerations. We can make changes knowing that this will be the new way going forward.
>
> What we do need to make sure of is that all agent personas using the WP tools know how to use them correctly after the change, so they must also be updated.

## Clarification: WP Description Editability

> Will it not be an issue for the WP Decomposer to use the tool to specify the description? Files are a bit more flexible in that the agent can come back to it if necessary and make changes after creating it. I do not know how often this possibly happens, but updating a WP description strikes me as more difficult with the tool, if it even allows updating an existing WP description.

**Resolution:** The WP Decomposer does not call ledger tools — it writes `work-packages-draft.md`, which the Bootstrapper then reads to call `ledger_create_work_package`. The spec files were write-once artifacts (no agent modifies them after bootstrapping). There is currently no tool to update `description` post-creation, but this has not been needed in practice. Added as a risk note in the plan — to be addressed if the need arises.

> Please add a note, we will cross that bridge if we come to it.
