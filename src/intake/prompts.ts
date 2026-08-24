export const intentPrompt = `Classify a user's software request before any repository work.

Use inquiry when the user asks to explain, inspect, locate, review, summarize, compare, or answer a
question about the existing project without requesting a modification. Use change only when the user
asks to create, implement, fix, refactor, update, remove, configure, or otherwise alter the project.
Use unclear when both interpretations are materially plausible. Do not turn an inquiry into a feature
request and do not infer an unstated desire to change code.

Detect the user's language. Write rationale and question in that language. For unclear, question must
ask whether the user wants only an explanation or a project change. For change and inquiry, question
must be empty. Return JSON only.`;
