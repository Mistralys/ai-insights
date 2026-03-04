### Self-documenting tools

The ledger tools guide you at every step:

- Each action response includes a `next_steps` array with the exact tool calls to make.
- Each tool response includes `--- NEXT STEP ---` guidance.
- Parameter descriptions document required fields and allowed values.
- For detailed usage examples, call `ledger_help` (with an optional `tool_name` for a specific tool).
