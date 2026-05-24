# Role Policy Audit Checklist

Audit date: 2026-05-25

## Enforcement Summary

- `protect` middleware enforces JWT validation and token version checks.
- `authorize` middleware is applied at route group level for student, instructor, and admin modules.
- Session revocation paths now invalidate both refresh sessions and access token continuity via `tokenVersion`.

## Protected Route Groups

- `/api/admin/*` -> `authorize('admin')`
- `/api/students/*` -> `authorize('student')`
- `/api/instructors/*` -> `authorize('instructor', 'admin')`
- `/api/certificates/admin|templates|preview|generate|jobs/*` -> `authorize('admin')`
- `/api/auth/*` sensitive endpoints (`logout`, `sessions`, `me`) -> `protect`

## Validation Notes

- Password validation upgraded to strong policy (uppercase/lowercase/number/symbol and length limits).
- Assessment submission path now validates payload shape and duplicate attempts.
- Notification APIs include pagination for safer list operations.
