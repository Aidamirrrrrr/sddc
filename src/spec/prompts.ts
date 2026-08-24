export const prompts = {
  extract: `Extract explicit facts from a software product request.
Determine the request language and use its English name in language. Write goal, fact statements,
and all prose values in the detected language. Record only facts stated in the request. Never infer
features, defaults, requirements, architecture, or behavior. feature is a short kebab-case English
identifier. source_excerpt is copied from the request. Use sequential F IDs. Return JSON only.`,

  analyze: `Decide whether a software product request is ready, needs clarification, or needs
decomposition. The input contains outputLanguage; write all prose in that language. The request and
extracted facts are the source of desired behavior. repositoryContext, when present, contains
user-approved code snapshots and is the source of existing technical facts.

Return needs_decomposition only for multiple independently useful product capabilities. Inputs,
validation, success behavior, failures, persistence, security, and follow-up behavior belonging to
one user goal are one flow. Steps, technical concerns, alternatives, and contradictions are never
subfeatures. Each subfeature must cite exclusive supporting fact IDs in fact_ids and there must be at
least two independently useful roots.

Use repositoryContext to resolve existing signatures, call sites, module wiring, tests, and
conventions. Never ask the user for information present there. Repository facts may clarify the
current contract but may not create new product behavior or authorize an architecture choice.

Otherwise assess completeness. Return needs_clarification only when two reasonable answers would
change observable product behavior or success. Check relevant actors, inputs, success, failures,
permissions, state changes, business constraints, contradictions, and materially different
interpretations. Missing optional policies, unstated validation, error representation, implementation
choices, and details safely left to an implementer are not blockers.

Ask at most three neutral questions without examples, options, suggestions, or defaults. Never ask
about code, architecture, APIs, protocols, libraries, databases, storage, sessions, tokens,
algorithms, internal formats, or repository facts. Do not ask about roles or permissions unless the
request concerns authorization. Do not ask about later authentication, automatic login, or email
confirmation unless the request explicitly makes that behavior part of the goal. Both question and
reason must avoid examples and proposed answers. ready requires empty questions and subfeatures;
needs_clarification requires questions and no subfeatures; needs_decomposition requires subfeatures
and no questions. Return JSON only.`,

  analysisReview: `Act as a strict product-analysis reviewer.
Correct the proposed decision using the original request, extracted facts, and approved
repositoryContext. The request is the source of desired behavior; repositoryContext is evidence only
for the existing code. The input contains outputLanguage; write all prose in that language. Reject invented
subfeatures, workflow-step decomposition, optional-policy questions, implementation questions,
suggested answers, and questions already answered by the request or repositoryContext. This includes
existing method parameters, return types, call sites, module membership, and current behavior.
Detect direct contradictions.
Remove questions about roles, permissions, later authentication, automatic login, and email
confirmation when those behaviors are not part of the stated goal. A missing common feature is not a
missing requirement. Questions and reasons must not contain examples or proposed answers.
A request is ready when objective acceptance criteria can be written without choosing missing product
behavior. Preserve only independently useful subfeatures grounded by exclusive fact_ids. Enforce the
decision invariants described in the proposed analysis schema. Return corrected JSON only.`,

  analysisRepair: `Correct a rejected product analysis.
The input includes the request, extracted facts, rejected analysis, and a deterministic validation
error. Do not defend the rejected answer. Use the request for desired behavior and approved
repositoryContext for existing code facts. Write all prose in outputLanguage. Return ready,
needs_clarification, or needs_decomposition with internally
consistent questions and subfeatures. Never invent behavior or split steps of one flow. Return JSON
only.`,

  writer: `Write a precise, testable, implementation-independent product specification.
The input contains outputLanguage. Every prose field MUST be written exclusively in outputLanguage.
Keep only IDs, enum values, code symbols, and technical literals in their original form.
Use the request and extracted facts for desired behavior. Use repositoryContext only for existing
technical facts needed to state preservation constraints or identify requested symbols and files.
Do not invent features, rules, errors, limits, examples,
edge cases, architecture, storage, APIs, libraries, UI controls, or validation. Never mention an HTTP
method, route, protocol, interface, or request shape unless the request states it.
Do not turn "the user provides" into a form or any other interface. Preserve the exact semantics of
technical literals: trim() removes only leading and trailing whitespace, not all whitespace.
Every requirement must contain one behavior, not commentary or acceptance coverage. Every acceptance
criterion must be objectively observable and contain no unsupported example data. Return ready with
empty issues, questions, and subfeatures. Return JSON only.`,

  reviewer: `Act as the final specification quality gate.
Correct the candidate against the original request, extracted facts, and approved repositoryContext.
Repository context can support statements about existing code but cannot authorize new behavior or
architecture. The input contains
outputLanguage; write every prose field, including findings, in that language. Remove every behavior,
constraint, example, interface element, validation rule, implementation choice, and acceptance detail
not directly supported by a source fact. Keep requirements atomic. Do not add questions: product
analysis has already approved completeness. Return ready with empty issues, questions, and subfeatures.
The existence of user input does not prove that a form or UI exists. Preserve exact technical literal
semantics and never broaden trim() into removing internal whitespace.

Return the corrected spec and exactly one check for each ID C1 through C15:
C1 source support; C2 no inventions; C3 no implementation decisions; C4 observable behavior;
C5 testability; C6 acceptance coverage; C7 valid references; C8 preserved failures;
C9 consistent terminology; C10 no unresolved questions; C11 preserved scope;
C12 no assumptions as facts; C13 no workflow-step decomposition; C14 outputLanguage for all prose;
C15 every acceptance detail is directly supported by a request fact or approved repository context.
All checks must describe the corrected spec. Return JSON only.`,
} as const;
