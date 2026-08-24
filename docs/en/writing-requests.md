# Writing Requests

The original request is the sole source of truth. The agent exposes omissions,
ambiguity, and contradictions, while the user remains responsible for choosing
the intended behavior. An answer such as "choose the usual option" does not
resolve a decision.

## Recommended Template

Include only the sections relevant to the task:

```text
Goal:
Who uses it:
What the user provides or does:
Successful result:
Failure behavior:
Business rules and constraints:
Explicitly excluded behavior:
```

Architecture is optional. Mention a database, protocol, library, hashing
algorithm, transaction boundary, or token format only when it is a genuine
requirement rather than a decision intentionally left to the implementer.

## Abstract Request

```text
Add user registration.
```

This does not define what the user provides, what successful registration
means, or which failures matter. The agent stops and asks questions instead of
choosing email, passwords, sessions, or tokens itself.

## Sufficient Request

```text
Add user registration.

The user provides an email address and password. Normalize the email with
trim().toLowerCase() and require it to be unique. A duplicate email returns
USER_ALREADY_EXISTS without creating a user. After success, return the user to
the sign-in screen. The password must never be stored in plain text. Email
verification and automatic sign-in are outside this task.
```

Even a detailed request may contain a contradiction or an untestable rule. In
interactive mode, the agent continues asking blocking questions until it can
produce a complete specification without choosing behavior for the user.
