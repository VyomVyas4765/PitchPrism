# Partner workspaces (Dev 4)

`PartnerWorkspace` is the integration entry point for the three existing authenticated partner roles. It obtains the workspace kind/funding mode from the backend; there is no role selector or local-storage data fallback.

The production dashboard is deliberately not modified. See [the integration handoff](../../../backend/src/modules/partners/HANDOFF.md) for the exact mount/import changes, provisional read-view shapes, unavailable workflows and their owning dependencies. Component styles use a CSS module and the existing web-shell variables; other role features are unaffected.

The page displays only real API reads. Loading, empty, error and retry states are distinct. Pagination replaces old rows and clears details; refresh rereads access and funding mode. Lists contain no applicant details; opening an idea uses the existing protected detail endpoint. “Coming next” entries are explicit placeholders, with no fake form, notification or successful mutation.
