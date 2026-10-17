# Role modules

Future role routers/services belong in `entrepreneur/` (Dev 1), `centre/` (Dev 2), `hq/` (Dev 3), or `partners/` (Dev 4). Their owner implements the full workflow, including validation, scoped persistence and access tests. Dev 3 owns the shared auth layer and the router mounts in `src/app.ts`; coordinate that small shared edit rather than duplicating guards.

The current read-only submission endpoint is an access-control foundation, not the complete PRD submission contract. Do not add writes until the contract owner and consuming role owners agree its schema.
