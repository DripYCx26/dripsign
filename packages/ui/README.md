# DripSign interface

The shared agreement interface renders server projections from `@dripsign/db`.
Hosts provide action callbacks and refreshed data after each command. Import
`@dripsign/ui/styles.css` once in the host application.

| File | Purpose |
| --- | --- |
| `src/index.ts` | Public component exports. |
| `src/AgreementWorkspace.tsx` | Document, shared negotiation thread, recipient signing, and staff suggestions. |
| `src/styles.css` | Scoped paper palette, controls, and responsive layout. |
