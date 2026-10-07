# DripSign

DripSign is an open source agreement workspace. A sender prepares a document,
the recipient proposes changes in a shared thread, and the sender publishes the
agreed version for signature. The signed document and audit record are kept
with the agreement.

The product has one signing authority. A host application may show the staff
interface through an authenticated bridge, while recipients use the standalone
portal. A shared interface does not grant access by itself: the server checks
the sender, recipient, agreement, and current revision for each operation.

The initial development tree is being built in `apps/` and `packages/`.
`docs/DECISIONS.md` records the architecture and release boundary.

## License

Apache License 2.0. See [LICENSE](LICENSE).
