# Project: Ledger Parallelization

I have realized that the ledger workflow is sequential in nature. When running the orchestrator on a plan where deep agents can be run in parallel on multiple work packages, the ledger's routing logic with get_next_action can break.

Currently, both the supervisor and the agent get their next action from the ledger, which guarantees that they are in sync - until the supervisor starts multiple work packages in parallel. Then we get into the cross-wp contamination errors for which we already added guards in the orchestrator.

I would like you to check what we would need to do to make the ledger workflow parallelizable. In short, the ledger should be able to handle both the sequential, regular workflow, and the orchestrator's parallelized workflow.

