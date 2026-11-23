Request one error-code base per new class or module that throws coded exceptions — never one per exception. Component codes within that class/module are `{base}01`, `{base}02`, … in the order they are introduced.

- Call `ledger_generate_error_code`, always passing `cwd_path` (the repository root) and a `context` (e.g. the class or namespace name).
- When the result's `temporary` is `true`, add a `TEMPORARY ERROR CODE` comment marker at the call site and report it {{temporary_code_report_location}}.
- When the tool is unavailable altogether, use the placeholder base `777000000` with the same `TEMPORARY ERROR CODE` marker.
- Replace a temporary code later: call `ledger_list_temporary_error_codes` to find it, then swap the placeholder for a real base once the provider is available.
- Never choose or configure an error-code provider — that is the user's own setup in the GUI's Error Codes tab.
