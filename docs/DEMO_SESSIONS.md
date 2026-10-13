# Visitor demo sessions

Each visitor receives an opaque, HttpOnly session cookie on demo entry. A new session starts from the immutable supplied and synthetic sample cases. DISP-002 starts at version 1, Open, without a decision, refund or settlement. Existing records from the previous shared demo are preserved and never imported into new visitor sessions.

Changing roles preserves the visitor's progress. **Start fresh demo** creates a new session and preserves the selected role. It does not delete previous records or invoke an agent. Tabs in the same browser profile share a session; a separate browser profile or incognito window starts independently. Cookies last eight hours and are refreshed on demo entry. Demo roles remain previews, not verified identities.

All mutable records live under `<runtime>/demo-sessions/<session UUID>/`: case versions, agent runs, evidence collection, snapshots, appeals and review tasks, decisions, simulated settlements and receipts, precedent records, provider telemetry, uploads, and call allowances. Agent workers retain the originating namespace after the HTTP response returns. Fixtures, reference documents and public illustrations are shared immutable sources. Legacy CLI evaluation continues to use the original runtime root.

The WhatsApp reference confirms that organizers will not provide real data for privacy reasons and participants should create synthetic data for training and testing. It does not make synthetic outcomes real financial transactions or establish demo policy clauses as official Ryde policy. Existing source labels and simulated settlement labels remain in place.

Verification covers independent settlements and case versions, private appeals and images, independent call allowances, concurrent background workers with identical run IDs, rejected cross-session storage paths, and entry/change-role/reset cookie behavior. Production validation uses fixture agents and makes no paid model calls.
