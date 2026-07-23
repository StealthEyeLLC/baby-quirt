# Standalone Baby v2 exact evidence index

This supplemental index binds each canonical risk row in `FAILURE_RISK_REGISTER_V2.md` to its scenario-specific source gate and the final exact-source certification. The canonical register remains the authority for full scenario wording, mitigation, and status.

Certification: workflow `29978551411`; 432/432 tests passed; zero failed/skipped; signed receipt `ebcf04bbd43a0a413f82de3260036931c61202e17b011c89618a4cdd3bf9bb05`; Baby `0aa38387377b7c1ea6cd144e0b88dbc5dcb8bf54` / tree `67925db5ece85478c182ad08318820efa42c3c05`; Gateway `e2ed51a1885e96b6e91ab48946a44d5dc1a1a35f` / tree `d0598af304c8cda8df3bb538d703d9db6c7dcb04`.

| ID | Scenario | Exact source gate | Certified evidence |
|---:|---|---|---|
| R001 | Default branch moved after planning | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R002 | History was rewritten | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R003 | Superseded PR was merged | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R004 | Hidden Fix coupling remains | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R005 | Wrong commit is built | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R006 | Untracked/generated files contaminate build | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R007 | Useful old code carries wrong authority assumptions | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R008 | PR head changes during review | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R009 | Controller installation is partial | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R010 | Product transaction upgrades its own guard | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R011 | Caller dies before guard arming | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R012 | Caller dies after guard arming | `test/deployment-database.test.ts`, `test/deployment-state-machine-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R013 | Baby dies after pointer switch | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R014 | Gateway dies during acceptance | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R015 | Host reboots during activation | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R016 | Stale timer fires after newer deployment | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R017 | Two deployments race | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R018 | Cancellation after arming | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R019 | Snapshot corrupt/incomplete | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R020 | Marker forged/stale | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R021 | Disarm response lost | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R022 | Rollback fails | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R023 | `NODE_ENV=production` omits build tools | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R024 | Registry timeout/outage | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R025 | Package yanked/integrity changes | `test/controller-guard.test.ts`, `test/idempotency.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R026 | Toolchain drift | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R027 | Nondeterministic build | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R028 | Cache stale/poisoned | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R029 | Archive contains links | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R030 | Archive traversal/bomb | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R031 | Native addon wrong path | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R032 | Wrapper hardcodes active pointer | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R033 | Version collision | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R034 | Package/release version disagreement | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R035 | Disk/inode exhaustion | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R036 | JSON record tears | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R037 | Replay nonce accepted before persistence | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R038 | Result committed but response lost | `test/strict-release-archive.test.ts`, `test/safe-extract.test.ts`, `test/inactive-install.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R039 | PID reused | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R040 | Stream offsets duplicate/skip | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R041 | PTY input altered | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R042 | Cancellation kills wrong process | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R043 | Caller timeout mistaken for failure | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R044 | Ambiguous job blindly replayed | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R045 | Oversized artifact fills memory | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R046 | State migration prevents rollback | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R047 | Gateway cannot traverse config directory | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R048 | Gateway can read private key | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R049 | Wrong Unix peer accepted | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R050 | Socket mode/owner drifts | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R051 | Old process remains after activation | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R052 | Key or machine identity mismatch | `test/jobs.test.ts`, `test/artifacts.test.ts`, `test/receipts.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R053 | Installer enables password mode | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R054 | GitHub login name changes | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R055 | OAuth state deleted/corrupted | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R056 | `fix.apply` remains | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R057 | Fix OAuth changed | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R058 | Issuer/resource/audience/challenge disagree | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R059 | Refresh replay works | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R060 | Private JWK/token public | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R061 | Source/docs tool wording differ | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R062 | Blanket destructive annotation | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R063 | Frozen old ChatGPT snapshot | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R064 | Tool changes after Always allow | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R065 | Always allow unavailable | `test/standalone-architecture.test.ts`, coordinated gateway OAuth/contract suites | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R066 | Especially risky action still prompts/blocks | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R067 | Existing tab stale | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R068 | OAuth expires without refresh | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R069 | Output exceeds client limits | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R070 | Idempotency key reused for changed intent | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R071 | Candidate Caddy invalid | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R072 | Reload fails | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R073 | Local health passes but public is 502/403/wrong host | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R074 | DNS/TLS differs | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R075 | Unexpected public listener | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R076 | Receipt v2 precedes gateway support | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R077 | Legacy fallback removed too early | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R078 | Gateway remains on fallback after Baby activation | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R079 | Operation schemas disagree | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R080 | New operation names collide | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R081 | Secret leaks | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R082 | Malicious repository text treated as authority | `test/snapshot-rollback.test.ts`, `test/nspawn-rehearsal.test.ts`, `test/permissions-v2.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R083 | Shell injection | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R084 | Symlink race/path substitution | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R085 | Evidence modified | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R086 | Malicious dependency install script | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R087 | CI artifact label treated as authority | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R088 | Actions permissions expose secrets | `test/secrets.test.ts`, `test/bootstrap-safe-extract.test.ts` | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R089 | Builds starve production | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R090 | Logs/artifacts/caches unbounded | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R091 | VPS too small | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R092 | Paid service becomes required | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R093 | Manual SSH becomes routine | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |
| R094 | Break-glass undocumented | `test/deployment-lane.test.ts`, `test/nspawn-bootstrap.test.ts`, exact-head nspawn receipt | Run `29978551411`, receipt `ebcf04bb…bb05` |

All 94 IDs are unique and complete (`R001`–`R094`). The certification receipt binds the complete command/evidence inventory; this index does not claim that aggregate certification replaces the row-specific source gate.
