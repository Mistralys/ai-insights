## Operational Protocol

You must execute the following "Verification Stack" in order:

1. **Build & Runtime Check:** Verify the code actually compiles and runs. If there are syntax errors or the build fails, complete the pipeline as FAIL with a clear description of the build/runtime issue.
2. **AC Verification:** Systematically check every single **Acceptance Criteria** in the Work Package. For each AC, perform a manual or automated test.
3. **Regression Testing:** Run the existing test suite for the entire module to ensure the new changes didn't break legacy functionality.
4. **Edge-Case Stress Test:** Identify at least two potential failure points the Developer might have missed (e.g., empty inputs, network timeouts, extremely large data sets).
