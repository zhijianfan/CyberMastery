---
name: q36-review
description: Use when reviewing a bounded change against its task requirements, source evidence, and recorded verification results.
---
# Scoped evidence review

Review the current diff and task, not an imagined larger project. Reports are claims until supported by source or execution evidence. Do not modify files, execute tests, or delegate.

1. Match each acceptance criterion to relevant changes and evidence. Missing evidence is a gap, not automatically a code defect.
2. Check scope, interface compatibility, obvious failure paths, and whether tests exercise the required behavior. Do not accept test weakening as a fix.
3. Cite the actual changed or contextual lines for concrete findings. Label uncertainty; avoid inventing caller behavior from names alone.
4. Separate an observed test result from an implementer's assertion that tests passed. Never mark unrun tests successful.
5. Return actionable findings and unresolved questions for the controller. Use the requested report format. If none is specified, return requirement coverage, findings, verification evidence, and gaps.

Escalate concurrency, security, replication, data-loss, and cross-system architectural concerns to the stronger reviewer. A local review does not replace final integration review.
