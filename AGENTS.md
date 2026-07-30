# Prismora repository rules

<!-- ponytail-workflow: v1 -->
## Ponytail workflow

- Apply the available `ponytail` Skill to every coding, design, refactor, fix,
  dependency-selection, and code-review task. Read its `SKILL.md` before making
  a non-trivial implementation decision.
- Use `ponytail-review` for an over-engineering review of a diff,
  `ponytail-audit` for a repository-wide report, and `ponytail-debt` only when
  collecting explicit `ponytail:` deferrals.
- First understand the requested behavior and trace the real code path. Then
  prefer, in order: no implementation, existing code, standard library,
  native platform behavior, an installed dependency, and finally the minimum
  new code that works.
- Fix shared root causes rather than one reported symptom. Do not add
  unrequested abstractions, generalized frameworks, dependencies, fallback
  layers, configuration, or speculative future support.
- Leave one smallest runnable regression check for non-trivial logic. Do not
  weaken explicit requirements, browser-extension security, accessibility, or
  repository-specific completion evidence.
- Priority is: user-approved requirements and completion criteria; safety and
  existing contracts; repository-specific rules; then Ponytail minimization.
