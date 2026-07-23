# CP1 Candidate

phaseKind: CP1
schemaVersion: CandidateReviewBundleV1

## RQMatrix

| dimension | status | evidence | gap | disposition | skipReason |
|---|---|---|---|---|---|
| RQ-1 | PASS | evidence-1 | none | accept | N/A |
| RQ-2 | PASS | evidence-2 | none | accept | N/A |
| RQ-3 | PASS | evidence-3 | none | accept | N/A |
| RQ-4 | PASS | evidence-4 | none | accept | N/A |
| RQ-5 | PASS | evidence-5 | none | accept | N/A |
| RQ-6 | PASS | evidence-6 | none | accept | N/A |
| RQ-7 | PASS | evidence-7 | none | accept | N/A |
| RQ-8 | PASS | evidence-8 | none | accept | N/A |

## DomainRealityMatrix

| domain | currentReality | repoEvidence | consumer | decision | negativeProbe | skipReason |
|---|---|---|---|---|---|---|
| sourceTruth | current | repo | CP1 | accept | missing-source | N/A |
| packageChannel | current | package.json | package | accept | wrong-channel | N/A |
| licensePolicy | current | LICENSE | package | accept | wrong-license | N/A |
| commandSurface | current | index.js | CLI | accept | missing-command | N/A |
| runtimeCapability | current | runtime | host | accept | missing-runtime | N/A |
| phaseKind | CP1 | front matter | CP gate | accept | wrong-phase | N/A |

## ClaimEvidenceMatrix

| claim | evidence | status |
|---|---|---|
| requirements are source-backed | repo evidence | PASS |

## EscapeAbsorptionQueue

| sourceClaimId | finding | localEvidence | disposition | targetArtifact | owner | status |
|---|---|---|---|---|---|---|
| N/A | no escaped finding | local scan | reject | N/A | review owner | closed |
