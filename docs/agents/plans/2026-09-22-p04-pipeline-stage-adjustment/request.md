# Project: Pipeline Adjustments

## Description

The PM during a ledger run mentioned the following:

```
**Unresolved ledger process incident — WP-005 missing the security-audit pipeline stage (HIGH, unresolved).**
The Project Manager flagged during bootstrap that WP-005 ("Redaction choke-point: MiddlewareURLHelper extension + MetricsRedactor") — the WP directly implementing credential redaction, and the central risk this entire plan exists to close — was created with the default 4-stage pipeline (implementation, qa, code-review, documentation) instead of the 5-stage chain (…, **security-audit**, …) that `pipeline-configuration.md` requires for security-sensitive work. No MCP tool exists to patch `active_pipeline_stages` on an existing WP, and a direct filesystem edit was blocked by the auto-mode permission classifier. The incident was logged as `resolved: false` and no workaround was subsequently applied — WP-005 completed and was marked COMPLETE through only the 4 standard stages, **without an independent security audit of the redaction logic**.
```

## Extending Admin Capabilities

I think that we should add the possibility to make suich adjustments, restricted to the relevant agents.
