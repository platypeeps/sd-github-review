# Review Data Retention Policy Design

## Ownership And Configuration

`sd-github-review` owns the versioned retention schema, `standard-v1` profile,
bounded status/purge contracts, and conformance fake. The consumer private
control plane owns durable enforcement, tenant authorization, deletion
execution, backups, and legal holds. The command pack owns portable operator
rendering and confirmation UX.

The profile is assigned by the private control plane and exposed by immutable
ID/version/digest. Repository configuration does not contain arbitrary
durations. Future policy variation requires another named profile so every
receipt and report remains reproducible.

## Standard-v1 Matrix

| Data class | Active rule | Terminal retention | Final form |
| --- | --- | --- | --- |
| Prohibited review/provider content | Never persist | Crash cleanup within 24 hours | None |
| Operational attempt state | Until terminal; unresolved maximum 180 days | 90 days | Bounded receipt |
| Deferred review | Until recovered, superseded, PR closed, or 180 days | 30 days | Bounded receipt with `expired_unreviewed` when applicable |
| Budget observation/provider reference | Current bounded observation only | 90 days | Coverage-aware aggregate |
| Receipt, usage/cost, quarantine, audit, deletion evidence | Immutable bounded event | 13 months | Deleted |
| Adjudication correction/conflict chain | Chain remains intact | 13 months after newest event | Coverage-aware anonymous aggregate |
| Catalog/safe policy version | While referenced | 13 months after last retained reference | Digest/coverage only |
| Static adapter prompt-profile version | While referenced by active/retained catalog | 13 months after last retained reference | Digest/coverage only |
| Anonymous aggregate metrics | N/A | 25 months | Deleted |
| Backup | N/A | Hard maximum 35 days | Deleted |

Durations use calendar-aware timestamps in UTC. Every stored record has exactly
one data class and immutable retention-policy digest. A record with conflicting
classifications fails closed rather than selecting the longer duration.
Static prompt-profile configuration contains reusable templates/settings only;
rendered prompts and PR-specific content remain prohibited.

## Lifecycle

```text
active -> terminal -> compacted -> deleted
   |          |           |
   |          +-----------+--> legal hold pauses covered deletion timer
   |
   +--> active maximum -> explicit terminal expiry

authorized purge: active/terminal/compacted -> purge_pending -> live_deleted
                                                        -> backup_expired
```

Compaction removes operational detail and retains only the bounded receipt.
Deletion appends a minimal deletion receipt and updates coverage metadata.
Neither operation may retain prohibited content.

An active deferred record reaches `expired_unreviewed` at 180 days. It remains
visible as terminal detail for 30 days, then compacts. An unresolved attempt
reaches `expired_unknown` at 180 days and follows its 90-day terminal window.

## Legal Hold

A hold binds tenant, repository, data classes, actor, reason, authorization,
start, and required expiry. It pauses future deletion only for covered live
records. Expiry or authorized release resumes the remaining timer; it does not
restart a full retention period. Holds cannot restore previously deleted data.

## Purge, Transfer, And Backups

`purge_repository_data` is idempotent and destructive. It requires explicit
confirmation and returns progress plus a final deletion receipt. Live data must
be removed within seven days. Backups expire within 35 days; every restore
replays the deletion journal before serving reads.

Uninstall stops new collection but does not imply purge. Removal marks state
inactive. Same-tenant transfer requires repository identity revalidation;
cross-tenant transfer requires explicit authorization from the destination and
never silently reassigns historical actor or policy authority.

GitHub-native artifacts remain outside this private lifecycle and are called
out explicitly by status/purge results.

## Coverage And Reporting

Every bounded report includes policy identity, observation/coverage window,
retention gaps, and last deletion. Adjudication and effectiveness metrics carry
eligible, retained, expired, purged, and unknown counts. Anonymous 25-month
aggregates cannot contain repository, PR, attempt, finding, actor, candidate-
actor, or provider-account identifiers.

## Rollback

Policy rollback selects a prior immutable profile only for new records. It does
not extend existing deletion deadlines silently or resurrect deleted data.
Enforcement rollback disables new collection; it never disables purge, legal-
hold expiry, deletion-journal replay, or backup aging.
