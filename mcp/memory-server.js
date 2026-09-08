#!/usr/bin/env node
'use strict'

const { fstatSnapshot, filePathSnapshot } = require('../hooks/_runtime/file-identity.cjs')

/**
 * DevCodex MCP Memory Server — local stdio process (deployed to .claude/mcp/; needs .claude/scripts/lib deps)
 *
 * Implements MCP 2024-11-05 protocol over stdin/stdout (JSON-RPC 2.0).
 *
 * Tools:
 *   memory_status         — Read bounded today/yesterday/SUMMARY metadata
 *   memory_session_query  — Read exact bounded daily-memory session sections
 *   memory_summary_query  — Read bounded latest/unresolved SUMMARY rows
 *   memory_session_allocate — Atomically reserve the next daily session section
 *   memory_task_admit_v2  — Resolve current server-owned ingress and admit/adopt/bind one formal task
 *   memory_task_write_owner — Acquire/renew/handoff/takeover/release/reopen one fenced task owner
 *   memory_task_fast_path_lease — Issue one bounded two-path low-risk mutation lease
 *   memory_workflow_operational_write_lease — Issue one exact, one-use report/memory/audit/checkpoint lease
 *   memory_task_terminal_v1 — Reconcile terminal evidence, close out V5 and unbind the live route
 *   memory_artifact_mutation_reconcile_v1 — Re-observe one exact failed-closeout effect set without mutation authority
 *   memory_task_resolve   — Resolve an exact task identity without loading task bodies
 *   memory_session_read   — Read today's/yesterday's session memory file
 *   memory_session_write  — Append a block to one allocation-bound daily session
 *   memory_artifact_link_project — Project or validate active-root-relative artifact links
 *   memory_cp_confirm     — Record CP checkpoint confirmation in sessions.md
 *   memory_summary_read   — Read agent SUMMARY.md
 *   memory_summary_append — Append one index row to agent SUMMARY.md
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { assertSingleSegment, resolveInside, resolveExistingRegularFileInside } = require('./path-guard')
const { createJsonLineServer } = require('./stdio-jsonrpc.cjs')
const { createMemoryFileTransaction } = require('./memory-file-transaction.cjs')
const {
  computeProjectTargetLeaseDigest,
  executeTaskAdmission,
  executeTaskWriteOwner,
  executeWorkflowTaskTerminal,
  recoverOwnerFencedAdmissionForResume,
  reconcileWorkflowTaskTerminal,
  readFinalizedResumeCanonicalEvidence,
  validateProjectTargetLease
} = require('./task-admission-authority.cjs')
const {
  createArtifactLinkProjectionSet,
  renderArtifactLinkBlock,
  validateMarkdownLocalLinks
} = require('./artifact-link-projection.cjs')
const {
  createAutoCheckpointDecision,
  observeFinalizedTaskResumeLiveness,
  readBoundedResumeIngressCapability,
  readFencedTaskWriteOwner,
  readAdmissionIngressSnapshot,
  readEmergencyCloseouts,
  readTaskRecoveryState,
  resolveTaskRecoveryMetaDir,
  sameIdentity,
  updateTaskRecoveryState,
  validateAutoCheckpointDecision,
  validateTaskScopedAutoContinuationGrant,
  writeAdmissionIngressSnapshot,
  writeBoundedResumeIngressCapability
} = require('../hooks/_runtime/task-recovery-store-v5.cjs')
const {
  buildActualInstructionEnvelope,
  buildWorkItemSet,
  validateActualInstructionEnvelope,
  validateWorkItemSet
} = require('../hooks/_runtime/actual-instruction-envelope.cjs')
const {
  buildWorkflowRouteDecision,
  verifyWorkflowRouteDecision
} = require('../hooks/_runtime/workflow-route-decision-v2.cjs')
const {
  applyArtifactMutationReconciliation,
  createArtifactMutationReconciliationReceipt,
  validateArtifactMutationReconciliationEvidence
} = require('../hooks/_runtime/artifact-mutation-reconciliation.cjs')
const {
  readBoundedTextFileSync,
  scanBoundedTextLinesSync
} = require('./bounded-text-reader.cjs')
const {
  findLayoutInfo,
  namespaceRootPath,
  PROJECT_NAMESPACE_SCHEMA_PATTERN,
  normalizeProjectNamespace,
  resolveHostWorkspaceBinding,
  resolveLegacyProjectRoot,
  resolveRuntimeStateRoot
} = require('../hooks/_runtime/workspace-layout.cjs')
const {
  CONTEXT_READ_CONTRACT,
  buildContextReadError,
  createContextReadReceipt,
  recordContextReadOutcome
} = require('../hooks/_runtime/context-read-contract.cjs')
const { buildJsonContentIdentity } = require('../hooks/_runtime/content-identity.cjs')
const { taskOperationTerminalSnapshot } = require('../hooks/_runtime/lifecycle-turn-liveness.cjs')
const {
  authorizeContextRead,
  readMcpContextSourceObservations,
  recordMcpContextSourceObservations
} = require('../hooks/_runtime/context-source-observation.cjs')
const { readRuntimeGenerationManifest } = require('../hooks/_runtime/runtime-generation-identity.cjs')
const {
  acquireRuntimeGenerationLease
} = require('../hooks/_runtime/runtime-generation-lease.cjs')
const {
  currentActiveSessionIds,
  rowsByCurrentState,
  summaryStateConflicts
} = require('../scripts/lib/memory-summary-state.js')
const {
  TaskContinuationError,
  evaluatePortableTaskIdentityBinding,
  resolveUniqueActiveTaskContinuation,
  resolveTaskContinuation
} = require('../hooks/_runtime/task-continuation-contract.cjs')
const {
  activateTaskCheckpointEpochBootstrap,
  activateTaskCheckpointEpochSuccessor,
  checkpointEpochProjectionDigest,
  confirmTaskCheckpointPhase,
  digestValue: checkpointDigestValue,
  normalizeStageKey,
  prepareTaskCheckpointEpochBootstrap,
  prepareTaskCheckpointEpochSuccessor,
  sealCheckpointEpochBootstrapAuthority,
  sealCheckpointPhaseBinding,
  sealCheckpointPhaseSlot,
  sealTaskCheckpointEpoch
} = require('../hooks/_runtime/task-checkpoint-epoch-v1.cjs')
const {
  advanceCheckpointEpochOperation,
  createCheckpointEpochOperation,
  createCheckpointEpochReceipt,
  finalizeTaskCheckpointProjection,
  parseCurrentEpochMarker,
  renderTaskCheckpointProjection,
  sealCheckpointEpochOperation
} = require('../hooks/_runtime/task-checkpoint-projection-v1.cjs')
const {
  buildTaskContinuityView,
  renderTaskContinuityViewHuman
} = require('../hooks/_runtime/task-continuity-view-v1.cjs')
const { normalizeLanguageTag } = require('../hooks/_runtime/language-context.cjs')
const { createLinkCapabilityDecision } = require('../hooks/_runtime/visible-output-contract.cjs')
const {
  createWorkspaceSessionRouteIndex,
  digestSessionRef
} = require('../hooks/_runtime/workspace-session-route-index-v1.cjs')
const {
  createWorkflowOperationalWriteLease
} = require('../hooks/_runtime/workflow-operational-write-lease.cjs')
const {
  createSimpleTaskFastPathLease,
  createSimpleTaskFastPathUsage,
  validateSimpleTaskFastPathUsage
} = require('../hooks/_runtime/simple-task-fast-path-lease.cjs')
const {
  bindValidationControlIngressIntent,
  validateValidationControlIngressReceipt,
  validateValidationControlIngressIntent,
  validationProjectRootIdentity
} = require('../hooks/_runtime/workflow-completion-contract.cjs')
const {
  classifyRelativeTarget,
  readLayeredArtifactSlotRegistry
} = require('../hooks/_runtime/artifact-slot-decision.cjs')
const {
  createArtifactTemplateBinding,
  projectArtifactTemplateBinding,
  qualifyArtifactContent,
  qualifyArtifactFile,
  renderArtifactTemplate,
  renderArtifactTemplateQualification,
  validateArtifactTemplateQualification
} = require('../hooks/_runtime/artifact-template-contract.cjs')

function loadCpDigestContract() {
  try {
    return require('../scripts/lib/cp-digest.js')
  } catch {
    return null
  }
}

const CP_DIGEST_CONTRACT = loadCpDigestContract()

function loadMemoryIndexContract() {
  try {
    return require('../scripts/lib/memory-index.js')
  } catch {
    return null
  }
}

const MEMORY_INDEX_CONTRACT = loadMemoryIndexContract()
const MEMORY_FILE_TRANSACTION = createMemoryFileTransaction()

function loadSummaryTypeCanon() {
  try {
    return require('../scripts/lib/summary-type-canon.js')
  } catch {
    return null
  }
}

const SUMMARY_TYPE_CANON = loadSummaryTypeCanon()

const INPUT_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd()

const MEMORY_RUNTIME_GENERATION_LEASE = acquireRuntimeGenerationLease({
  role: 'memory-mcp',
  runtimeRoot: path.resolve(__dirname, '..')
})
if (!['active', 'not-installed-generation'].includes(MEMORY_RUNTIME_GENERATION_LEASE.status)) {
  const error = new Error(
    `RUNTIME_GENERATION_LEASE_REQUIRED: ${MEMORY_RUNTIME_GENERATION_LEASE.reasonCode || MEMORY_RUNTIME_GENERATION_LEASE.status}`
  )
  error.code = 'RUNTIME_GENERATION_LEASE_REQUIRED'
  throw error
}

function activeMemoryRuntimeIdentity() {
  const runtimeRoot = path.resolve(__dirname, '..')
  const generation = readRuntimeGenerationManifest(runtimeRoot, fs)
  let packageVersion = 'unknown'
  try { packageVersion = String(JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8')).version || 'unknown') } catch {}
  const core = {
    schemaVersion: 'MemoryRuntimeGenerationRefV1',
    activeVersion: generation.manifest?.packageVersion || packageVersion,
    generationId: generation.manifest?.generationId || `source-${packageVersion}`,
    runtimeContractVersion: Number(generation.manifest?.runtimeContractVersion || 0),
    manifestStatus: generation.status
  }
  return {
    ...core,
    runtimeDigest: crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex')
  }
}

const MEMORY_RUNTIME_IDENTITY = activeMemoryRuntimeIdentity()

// ─── Server metadata ──────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'devcodex-memory',
  version: '1.0.0'
}

const {
  VALID_AGENTS,
  normalizeAgent,
  detectRuntimeAgent
} = require('./agent-identity.cjs')

// Prefer DEVCODEX_AGENT; otherwise infer host env (incl. grok). Never default to claude-code.
const EXPLICIT_RUNTIME_AGENT = normalizeAgent(process.env.DEVCODEX_AGENT)
const DEFAULT_AGENT = detectRuntimeAgent()
const TASK_KINDS = new Set(['requirements', 'bugs', 'optimizations', 'scenario-tests'])
const MAX_MEMORY_SESSION_WRITE_CHARS = 262144
const MEMORY_SESSION_WRITE_REQUIRED_FIELDS = Object.freeze(['content'])
const MEMORY_SOURCE_MAX_BYTES = 8 * 1024 * 1024
const WORKSPACE_CONTEXT_PROJECT = '__workspace__'
const PROJECT_NAMESPACE_INPUT_SCHEMA = Object.freeze({
  type: 'string',
  pattern: PROJECT_NAMESPACE_SCHEMA_PATTERN
})

const CONTEXT_READ_BINDING_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'],
  properties: {
    schemaVersion: { const: 'ContextReadBindingV1' },
    contextEpoch: { type: 'string', minLength: 1 },
    planId: { type: 'string', minLength: 1 },
    planContentId: { type: 'string', minLength: 1 },
    activeRoot: { type: 'string', minLength: 1 },
    project: { type: 'string' }
  },
  additionalProperties: false
}

const ARTIFACT_LINK_DESCRIPTOR_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'targetPath', 'purpose'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    targetPath: { type: 'string', minLength: 1, description: 'active-root-relative target path' },
    purpose: { type: 'string', minLength: 1, maxLength: 300 }
  }
})

const SUMMARY_ARTIFACT_DESCRIPTOR_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['label', 'targetPath', 'purpose'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    targetPath: { type: 'string', minLength: 1, description: 'active-root-relative target path' },
    purpose: { type: 'string', minLength: 1, maxLength: 300 }
  }
})

const LINK_CAPABILITY_DECISION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'surface', 'evidenceState', 'mode', 'workspaceRoot', 'targetRelation',
    'absolutePathFallback', 'fallbackReason', 'evidenceRefs', 'decisionId', 'validation'
  ],
  properties: {
    schemaVersion: { const: 'LinkCapabilityDecisionV1' },
    surface: { type: 'string', minLength: 1 },
    evidenceState: { type: 'string', enum: ['verified', 'inferred', 'failed'] },
    mode: { type: 'string', enum: ['clickable', 'portable', 'plain', 'failed'] },
    workspaceRoot: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    targetRelation: { type: 'string', enum: ['workspace', 'external', 'ambiguous'] },
    absolutePathFallback: { type: 'boolean' },
    fallbackReason: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    decisionId: { type: 'string', minLength: 1 },
    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['valid', 'errors'],
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } }
      }
    }
  }
})

const WORKFLOW_INGRESS_REF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'envelopeId', 'envelopeDigest', 'decisionDigest', 'routeRevision'],
  properties: {
    schemaVersion: { type: 'string', const: 'WorkflowIngressProjectionRefV1' },
    envelopeId: { type: 'string', pattern: '^aie-[a-f0-9]{40}$' },
    envelopeDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    decisionDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    routeRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' }
  }
})

const TASK_WRITE_OWNER_REF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ownerGeneration', 'ownerNonce', 'leaseRevision', 'leaseDigest'],
  properties: {
    ownerGeneration: { type: 'integer', minimum: 1 },
    ownerNonce: { type: 'string', pattern: '^owner-[a-f0-9]{40}$' },
    leaseRevision: { type: 'integer', minimum: 1 },
    leaseDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }
  }
})

const TOOLS = [
  {
    name: 'memory_task_admit_v2',
    description: '正式任务准入/恢复并原子获取 fenced owner。传入 operation、task 对象和 overview.content 原文；新建用 admit，task 内提供 taskKind、entryVariant、displayName，续办用 bind/adopt。通常省略 ingressRef 和 resumeContextBinding，由服务端恢复当前入口；如显式提供则二者互斥。写权限取决于 CP。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'task', 'overview'],
      // Keep properties visible to hosts that render top-level oneOf branches
      // without their parent fields. The handler enforces ingress exclusivity.
      properties: {
        operation: { type: 'string', enum: ['admit', 'adopt', 'bind'] },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project'] },
        ingressRef: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion', 'envelopeId', 'envelopeDigest', 'decisionDigest', 'routeRevision'
          ],
          properties: {
            schemaVersion: { type: 'string', const: 'WorkflowIngressProjectionRefV1' },
            envelopeId: { type: 'string', pattern: '^aie-[a-f0-9]{40}$' },
            envelopeDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            decisionDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            routeRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' }
          }
        },
        resumeContextBinding: CONTEXT_READ_BINDING_SCHEMA,
        task: {
          type: 'object',
          additionalProperties: false,
          properties: {
            taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$', description: 'adopt/bind 可从当前宿主的唯一任务补齐；admit 禁止传入' },
            displayName: { type: 'string', minLength: 1, maxLength: 160, description: 'admit 必填；新目录保留合法显示名' },
            aliases: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 300 } },
            taskKind: { type: 'string', enum: ['requirements', 'bugs', 'optimizations', 'scenario-tests'] },
            entryVariant: { type: 'string', enum: ['new', 'product-provided', 'change', 'fix', 'continue', 'reopen'] },
            taskRootRelative: { type: 'string', minLength: 3, maxLength: 320, description: 'adopt/bind 可从精确任务补齐；必须为 <taskKind>/<single-segment>' }
          }
        },
        overview: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 262144 },
            productSourceContent: { type: 'string', minLength: 1, maxLength: 262144, description: 'entryVariant=product-provided 时必填' }
          }
        }
      }
    }
  },
  {
    name: 'memory_task_write_owner',
    description: '对正式任务执行 fenced owner CAS。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'taskId', 'admissionId'],
      properties: {
        operation: { type: 'string', enum: ['acquire', 'renew', 'release', 'handoff-prepare', 'handoff-accept', 'takeover-prepare', 'takeover-accept', 'reopen'] },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project'] },
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        admissionId: { type: 'string', pattern: '^admission-[a-f0-9]{40}$' },
        expectedOwner: TASK_WRITE_OWNER_REF_SCHEMA,
        targetSessionDigest: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'handoff-prepare 的 exact target session digest' },
        handoffRefDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        takeoverRefDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }
      }
    }
  },
  {
    name: 'memory_task_fast_path_lease',
    description: '为最多两个低风险路径签发简单任务租约。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ingressRef', 'operation', 'targets', 'riskAssessment'],
      properties: {
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        operation: { type: 'string', enum: ['create-or-update'] },
        targets: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 512 }
        },
        riskAssessment: {
          type: 'object',
          additionalProperties: false,
          required: ['changeClass', 'crossModule', 'sharedContract', 'publicApiOrSchema', 'securitySensitive', 'dependencyChange', 'releaseImpact'],
          properties: {
            changeClass: { type: 'string', enum: ['narrative-markdown', 'local-implementation'] },
            crossModule: { type: 'boolean' },
            sharedContract: { type: 'boolean' },
            publicApiOrSchema: { type: 'boolean' },
            securitySensitive: { type: 'boolean' },
            dependencyChange: { type: 'boolean' },
            releaseImpact: { type: 'boolean' }
          }
        }
      }
    }
  },
  {
    name: 'memory_workflow_operational_write_lease',
    description: '为精确 operational slot 签发一次性窄写租约。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'targets'],
      properties: {
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        operation: { type: 'string', enum: ['create', 'append', 'update'] },
        targets: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string', minLength: 1, maxLength: 512 }
        }
      }
    }
  },
  {
    name: 'memory_task_terminal_v1',
    description: '核验终态证据，撤销 owner 并解绑 route。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'ingressRef', 'taskId', 'admissionId', 'terminalStatus', 'expectedOwner',
        'lifecycleRevision', 'expectedStateSequence', 'expectedWriterGeneration',
        'settledSetDigest', 'evidence'
      ],
      properties: {
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project'] },
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        admissionId: { type: 'string', pattern: '^admission-[a-f0-9]{40}$' },
        terminalStatus: { type: 'string', enum: ['completed', 'rejected', 'cancelled', 'failed'] },
        expectedOwner: TASK_WRITE_OWNER_REF_SCHEMA,
        lifecycleRevision: { type: 'integer', minimum: 1 },
        expectedStateSequence: { type: 'integer', minimum: 1 },
        expectedWriterGeneration: { type: 'integer', minimum: 1 },
        settledSetDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        evidence: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'path', 'sha256', 'bytes'],
            properties: {
              role: { type: 'string', enum: ['ecr', 'report', 'memory', 'completion'] },
              path: { type: 'string', minLength: 1, maxLength: 1024 },
              sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              bytes: { type: 'integer', minimum: 1, maximum: 8388608 }
            }
          }
        }
      }
    }
  },
  {
    name: 'memory_task_closeout_reconcile_v1',
    description: '按 CAS 恢复终态并重试 route unbind。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ingressRef', 'taskId'],
      properties: {
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project'] },
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' }
      }
    }
  },
  {
    name: 'memory_artifact_mutation_reconcile_v1',
    description: '按 CAS 复证并收口 artifact closeout；不改文件。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operationId', 'expectedCloseoutDigest', 'resolution'],
      properties: {
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project'] },
        ingressRef: WORKFLOW_INGRESS_REF_SCHEMA,
        taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        operationId: { type: 'string', minLength: 1, maxLength: 256 },
        expectedCloseoutDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        resolution: { type: 'string', enum: ['accept-observed-effects'] }
      }
    }
  },
  {
    name: 'memory_task_resolve',
    description: '按 taskId、名称或 alias 精确定位，仅返回有界元数据。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 300, description: '精确任务名、alias 或稳定 taskId' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选项目命名空间；提供后限制为 project scope' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '可选；默认按 cwd/project 推断' },
        persistIndex: { type: 'boolean', description: '是否持久化可重建索引；默认 true' }
      }
    }
  },
  {
    name: 'memory_task_continuity_view_v1',
    description: '返回有界、只读、面向人的任务连续性视图；缺 taskId 时允许唯一候选恢复或一次消歧。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        name: { type: 'string', minLength: 1, maxLength: 300 },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        scope: { type: 'string', enum: ['project', 'workspace'] },
        locale: { type: 'string', minLength: 2, maxLength: 32 },
        priorDisambiguationReceiptDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }
      }
    }
  },
  {
    name: 'memory_status',
    description: '返回当前目标的有界记忆状态与冲突摘要。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'latestRows 数量，默认 5，最大 20' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_query',
    description: '按条件限量查询会话记忆。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        date: { type: 'string', pattern: '^\\d{8}$', description: 'YYYYMMDD，默认今日' },
        sessionId: { type: 'string', minLength: 1, maxLength: 64, description: '精确会话编号，如 01 或 02a' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '会话状态，默认 all' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回会话数，默认 1' },
        handoffOnly: { type: 'boolean', description: '仅返回 ContextHandoffCard' },
        maxChars: { type: 'integer', minimum: 1, maximum: 50000, description: '正文总字符预算，默认 12000' },
        cursor: { type: 'string', minLength: 1, maxLength: 8192, description: '上一页返回的 opaque MemoryCursorV1；必须与同一 tool/target/context/query/source 完全匹配' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_summary_query',
    description: '按条件限量查询 SUMMARY。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的读取域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        status: { type: 'string', enum: ['active', 'completed', 'blocked', 'unresolved', 'all'], description: '默认 active' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回行数，默认 5，最大 50' },
        since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '只返回该日期及之后的行' },
        cursor: { type: 'string', minLength: 1, maxLength: 8192, description: '上一页返回的 opaque MemoryCursorV1；必须与同一 tool/target/context/query/source 完全匹配' },
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_allocate',
    description: '原子分配会话编号与 sessionBinding，并预留 daily memory 段。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Agent 标识，默认当前实际宿主' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '集中布局下的写入域' },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '集中布局下的项目命名空间' },
        date: { type: 'string', pattern: '^\\d{8}$', description: 'YYYYMMDD，默认今日' },
        title: { type: 'string', minLength: 1, maxLength: 160, description: '会话标题，默认 未命名任务' },
        intent: { type: 'string', maxLength: 120, description: '意图标签，默认 unspecified' },
        sourceMessage: { type: 'string', maxLength: 300, description: '用户消息摘要，可选' }
      }
    }
  },
  {
    name: 'memory_session_read',
    description: '读取已分配的会话记忆。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      properties: {
        agent: { type: 'string' },
        date: { type: 'string', description: 'YYYYMMDD，默认今日' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '读取域' },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_session_write',
    description: '向已分配会话段追加内容及去重的产物链接。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [...MEMORY_SESSION_WRITE_REQUIRED_FIELDS],
      properties: {
        agent: { type: 'string' },
        date: { type: 'string', description: 'YYYYMMDD，默认今日' },
        content: { type: 'string', minLength: 1, maxLength: MAX_MEMORY_SESSION_WRITE_CHARS },
        artifacts: { type: 'array', minItems: 1, maxItems: 20, items: ARTIFACT_LINK_DESCRIPTOR_SCHEMA },
        sessionId: { type: 'string', minLength: 1, maxLength: 64, description: 'allocate 返回的会话编号' },
        sessionBinding: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'allocate 返回的绑定值' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '写入域' },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA
      }
    }
  },
  {
    name: 'memory_artifact_link_project',
    description: '投影或验证 active-root 内产物的 Markdown 链接。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['documentPath', 'artifacts', 'linkCapability'],
      properties: {
        operation: { type: 'string', enum: ['project', 'validate-existing'], description: '默认 project。' },
        documentPath: { type: 'string', minLength: 1, description: 'active-root-relative Markdown document path。' },
        artifacts: { type: 'array', minItems: 1, maxItems: 20, items: ARTIFACT_LINK_DESCRIPTOR_SCHEMA },
        linkCapability: LINK_CAPABILITY_DECISION_SCHEMA,
        scope: { type: 'string', enum: ['project', 'workspace'] },
        project: { ...PROJECT_NAMESPACE_INPUT_SCHEMA, description: '可选项目命名空间。' }
      }
    }
  },
  {
    name: 'memory_cp_confirm',
    description: '记录已绑定 CP；任务 Auto 需复审证据。',
    inputSchema: {
      type: 'object',
      required: ['requirement', 'phase'],
      properties: {
        requirement: { type: 'string' },
        kind: { type: 'string', enum: ['requirements', 'bugs', 'optimizations', 'scenario-tests'] },
        phase: { type: 'string', enum: ['CP1', 'CP2', 'CP3'] },
        time: { type: 'string' },
        artifactPath: { type: 'string' },
        artifactVersion: { type: 'string' },
        artifactSha256: { type: 'string' },
        sourceMessage: { type: 'string' },
        stageKey: { type: 'string', minLength: 1, maxLength: 64, description: '新 CP1 代际标识；省略时由 artifactVersion 派生。' },
        expectedEpochId: { type: 'string', pattern: '^E[0-9]{4,}-[a-f0-9]{12}$', description: '可选 current epoch CAS。' },
        autoDecisionEvidence: {
          type: 'object',
          additionalProperties: false,
          required: ['riskClass', 'reviewGradeCard'],
          properties: {
            riskClass: { type: 'string', enum: ['R1', 'R2', 'R3', 'R4'] },
            sideEffectCategories: {
              type: 'array',
              maxItems: 32,
              items: { type: 'string', minLength: 1, maxLength: 128 }
            },
            blockers: {
              type: 'array',
              maxItems: 32,
              items: { type: 'string', minLength: 1, maxLength: 256 }
            },
            reviewGradeCard: {
              type: 'object',
              additionalProperties: false,
              required: ['grade', 'status', 'openBlockers'],
              properties: {
                grade: { type: 'string', enum: ['R1', 'R2', 'R3', 'R4'] },
                status: { type: 'string', enum: ['PASS', 'WARN', 'BLOCK', 'UNVERIFIED', 'N/A'] },
                openBlockers: { type: 'integer', minimum: 0 },
                reviewDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }
              }
            }
          }
        },
        scope: { type: 'string', enum: ['project', 'workspace'] },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA
      }
    }
  },
  {
    name: 'memory_summary_read',
    description: '兼容读取 SUMMARY.md。',
    inputSchema: {
      type: 'object',
      required: ['contextBinding'],
      properties: {
        agent: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'workspace'], description: '读取域' },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA,
        contextBinding: CONTEXT_READ_BINDING_SCHEMA
      }
    }
  },
  {
    name: 'memory_summary_append',
    description: '追加 SUMMARY.md 状态；可生成报告与记忆链接。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      oneOf: [{ required: ['row'] }, { required: ['entry'] }],
      properties: {
        agent: { type: 'string' },
        row: { type: 'string', description: 'Markdown 表格行' },
        entry: {
          type: 'object', required: ['summary', 'status'], additionalProperties: false,
          properties: {
            summary: { type: 'string' }, status: { type: 'string', enum: ['active', 'completed', 'blocked'] },
            type: { type: 'string' }, sessionId: { type: 'string' }, date: { type: 'string' }
          },
          description: '结构化事实；运行时构造表格行并恢复当前会话，不要求模型拼接列。'
        },
        reportArtifact: SUMMARY_ARTIFACT_DESCRIPTOR_SCHEMA,
        memoryArtifact: SUMMARY_ARTIFACT_DESCRIPTOR_SCHEMA,
        scope: { type: 'string', enum: ['project', 'workspace'], description: '写入域' },
        project: PROJECT_NAMESPACE_INPUT_SCHEMA
      }
    }
  }
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLocalDate(date = new Date()) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('')
}

function formatLocalDateTime(date = new Date()) {
  const compactDate = formatLocalDate(date)
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const offset = `${offsetSign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)} ${currentTime(date)} ${offset}`
}

function today() {
  return formatLocalDate()
}

function currentTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function isRealCompactDate(value) {
  const text = String(value || '')
  if (!/^\d{8}$/.test(text)) return false
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
}

function validateDate(date) {
  if (!date) return
  if (!/^\d{8}$/.test(String(date))) throw new Error(`date must be YYYYMMDD, got: ${date}`)
  if (!isRealCompactDate(date)) throw new Error(`date is not a real calendar date: ${date}`)
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8') } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

function readJsonFile(filePath) {
  const raw = readFile(filePath)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const LAYOUT = findLayoutInfo(INPUT_ROOT)

function inferContextProject() {
  const binding = resolveHostWorkspaceBinding({
    cwd: INPUT_ROOT,
    layout: LAYOUT,
    capability: process.env.DEVCODEX_HOST_WORKSPACE_CAPABILITY || 'physical',
    allowUniqueProject: false
  })
  return binding.status === 'resolved' ? binding.projectNamespace : ''
}

const CONTEXT_PROJECT = inferContextProject()
const DEFAULT_SCOPE = LAYOUT.enabled ? (CONTEXT_PROJECT ? 'project' : 'workspace') : 'project'

function throwWorkspaceBindingError(binding) {
  const error = new Error(binding?.error?.message || 'host workspace binding failed')
  error.code = binding?.error?.code || 'HOST_WORKSPACE_UNRESOLVED'
  error.candidates = binding?.error?.candidates || []
  error.workspaceBinding = binding
  throw error
}

function resolveProjectBinding(projectName, { requireProfile = true } = {}) {
  if (!LAYOUT.enabled) return null
  const target = String(projectName || CONTEXT_PROJECT || '').trim()
  if (!target) return null
  const binding = resolveHostWorkspaceBinding({
    cwd: INPUT_ROOT,
    layout: LAYOUT,
    explicitProject: target,
    capability: process.env.DEVCODEX_HOST_WORKSPACE_CAPABILITY || 'physical',
    requireProfile,
    allowUniqueProject: false
  })
  if (binding.status !== 'resolved') throwWorkspaceBindingError(binding)
  return binding
}

function resolveProjectName(projectName) {
  const normalized = LAYOUT.enabled
    ? (resolveProjectBinding(projectName)?.projectNamespace || '')
    : normalizeProjectNamespace(projectName, {
        layout: LAYOUT,
        contextProject: '',
        allowEmpty: true
      })
  if (LAYOUT.enabled || !normalized) return normalized
  return path.basename(resolveLegacyProjectRoot(INPUT_ROOT, normalized))
}

function resolveProjectRoot(projectName) {
  return resolveLegacyProjectRoot(INPUT_ROOT, projectName)
}

function resolveScope(scope) {
  const value = String(scope || '').trim().toLowerCase()
  if (value === 'workspace' || value === 'project') return value
  return DEFAULT_SCOPE
}

function getActiveRoot(args = {}) {
  if (!LAYOUT.enabled) {
    return path.join(resolveProjectRoot(args.project), '.devcodex')
  }
  const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
  const projectName = resolveProjectName(args.project)
  const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
  if (!explicitScope && !projectName) {
    throw new Error('workspace-namespace memory scope is ambiguous at workspace root; pass project or explicit scope:"workspace"')
  }
  if (scope === 'project' && !projectName) {
    throw new Error('workspace-namespace project memory requires project when cwd is workspace root')
  }
  if (scope === 'workspace' || !projectName) {
    return path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace')
  }
  return namespaceRootPath(LAYOUT.workspaceRoot, projectName)
}

function sessionFilePath(agent, date, args = {}) {
  const candidate = agent === undefined || agent === null || agent === ''
    ? DEFAULT_AGENT
    : assertSingleSegment(agent, 'agent')
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw new Error('invalid agent')
  return resolveInside(getActiveRoot(args), '.memory', 'clients', safeAgent, 'tasks', `${date || today()}.md`)
}

function summaryFilePath(agent, args = {}) {
  const candidate = agent === undefined || agent === null || agent === ''
    ? DEFAULT_AGENT
    : assertSingleSegment(agent, 'agent')
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw new Error('invalid agent')
  return resolveInside(getActiveRoot(args), '.memory', 'clients', safeAgent, 'SUMMARY.md')
}

function summaryProjectLabel(args = {}) {
  if (!LAYOUT.enabled) return path.basename(resolveProjectRoot(args.project)) || 'project'
  const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
  const projectName = resolveProjectName(args.project)
  const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
  if (scope === 'workspace') return 'workspace'
  return projectName || CONTEXT_PROJECT || 'project'
}

function summaryHeader(agent, args = {}) {
  return renderArtifactTemplate({
    templateRef: 'content/prompts/agent-summary.prompt.md', blockId: 'summary-header',
    producer: 'memory-summary-append', values: { agent: agent || DEFAULT_AGENT, project: summaryProjectLabel(args) }
  })
}

function renderSummaryRow(cells) {
  const keys = ['date', 'sessionId', 'type', 'summary', 'report', 'memory', 'status']
  return renderArtifactTemplate({
    templateRef: 'content/prompts/agent-summary.prompt.md', blockId: 'summary-row',
    producer: 'memory-summary-append', values: Object.fromEntries(keys.map((key, index) => [key, escapeSummaryCell(cells[index])]))
  })
}

function taskSessionsPath(kind, requirement, args = {}) {
  return resolveInside(getActiveRoot(args), kind, assertSingleSegment(requirement, 'requirement'), '.memory', 'sessions.md')
}

const CP_HEADING_RE = /^#{1,6}\s+.*CP\s*确认记录\s*$/i
const CP_TABLE_HEADER_RE = /^\|\s*CP\s*\|\s*状态\s*\|\s*(?:时间\s*\||artifactPath\s*\|\s*version\s*\|\s*sha256\s*\|\s*sourceMessage\s*\|\s*confirmedAt\s*\|)\s*$/i
const EXTENDED_CP_TABLE_HEADER_RE = /^\|\s*CP\s*\|\s*状态\s*\|\s*artifactPath\s*\|\s*version\s*\|\s*sha256\s*\|\s*sourceMessage\s*\|\s*confirmedAt\s*\|\s*$/i

function parseCpTableRows(text) {
  if (CP_DIGEST_CONTRACT) return CP_DIGEST_CONTRACT.parseCpSessions(text)
  const rows = { CP1: null, CP2: null, CP3: null }
  const lineRe = /^\|\s*(CP[123])\s*\|\s*([^|\n]+)\|(.*)$/gm
  let match
  while ((match = lineRe.exec(String(text || ''))) !== null) {
    const cells = String(match[3] || '').split('|').map(cell => cell.trim()).filter(Boolean)
    const artifactPathCell = cells.length >= 5 ? cells[0] : null
    const projectedArtifact = /^\[(.*)\]\((?:<[^>]+>|[^)]+)\)$/.exec(String(artifactPathCell || ''))
    rows[match[1]] = {
      confirmed: match[2].includes('✅') && !/stale/i.test(match[2]),
      stale: /stale/i.test(match[2]),
      artifactPath: projectedArtifact
        ? projectedArtifact[1].replace(/\\([\\\[\]|])/g, '$1')
        : String(artifactPathCell || '').replace(/^`|`$/g, '') || null,
      artifactPathCell,
      artifactVersion: cells.length >= 5 ? cells[1] : null,
      artifactSha256: cells.length >= 5 ? String(cells[2] || '').replace(/`/g, '').toUpperCase() : null,
      sourceMessage: cells.length >= 5 ? cells[3] : null,
      confirmedAt: cells.length >= 5 ? cells[4] : (cells.length === 1 ? cells[0] : null)
    }
  }
  return rows
}

function renderExtendedCpTable(phases) {
  if (CP_DIGEST_CONTRACT) return CP_DIGEST_CONTRACT.buildExtendedCpTable({ phases })
  const lines = [
    '### CP 确认记录',
    '',
    '| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |',
    '|:--:|:----:|--------------|---------|--------|---------------|-------------|'
  ]
  for (const phase of ['CP1', 'CP2', 'CP3']) {
    const row = phases[phase]
    lines.push(`| ${phase} | ${row.status} | ${row.artifactPath} | ${row.artifactVersion} | ${row.artifactSha256} | ${row.sourceMessage} | ${row.confirmedAt} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function taskMemoryTransactionTarget(args = {}) {
  const activeRoot = getActiveRoot(args)
  const project = LAYOUT.enabled
    ? (resolveProjectName(args.project) || CONTEXT_PROJECT || '')
    : (path.basename(resolveProjectRoot(args.project)) || path.basename(INPUT_ROOT))
  const workspaceRoot = LAYOUT.enabled ? path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace') : ''
  return {
    activeRoot,
    project: path.resolve(activeRoot) === path.resolve(workspaceRoot || activeRoot) && workspaceRoot ? '' : project,
    scope: workspaceRoot && path.resolve(activeRoot) === path.resolve(workspaceRoot) ? 'workspace' : 'project',
    agent: EXPLICIT_RUNTIME_AGENT || DEFAULT_AGENT
  }
}

function isCpDataRow(line) {
  return /^\|\s*CP[123]\s*\|/.test(String(line || '').trim())
}

/**
 * Locate the dedicated CP confirmation table only.
 * Must not treat ordinary session/index Markdown tables as CP tables (PF-162 / GR-068).
 */
function locateCpTableBlock(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const headingIndex = lines.findIndex(line => CP_HEADING_RE.test(line.trim()))
  let headerIndex = -1
  if (headingIndex >= 0) {
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      if (/^#{1,6}\s+/.test(lines[index]) && index > headingIndex + 1) break
      if (CP_TABLE_HEADER_RE.test(lines[index].trim())) {
        headerIndex = index
        break
      }
    }
  }
  // Only scan global headers when they are true CP headers (not any table with a "状态" column)
  if (headerIndex < 0) headerIndex = lines.findIndex(line => CP_TABLE_HEADER_RE.test(line.trim()))
  if (headerIndex < 0 && headingIndex < 0) return { lines, found: false }

  if (headerIndex < 0) {
    // Heading without a CP table: treat as incomplete block to be replaced
    return {
      lines,
      found: true,
      start: headingIndex,
      end: headingIndex + 1,
      headingLine: lines[headingIndex],
      incomplete: true
    }
  }

  let end = headerIndex + 1
  while (end < lines.length && (lines[end].trim() === '' || lines[end].trim().startsWith('|'))) end += 1
  const start = headingIndex >= 0 && headingIndex < headerIndex ? headingIndex : headerIndex
  return {
    lines,
    found: true,
    start,
    end,
    headingLine: headingIndex >= 0 && headingIndex < headerIndex ? lines[headingIndex] : '### CP 确认记录',
    incomplete: false
  }
}

/** Strip orphan | CP1 | rows that leaked outside a dedicated CP table (false-success repair). */
function stripOrphanCpRowsOutsideBlock(text) {
  const location = locateCpTableBlock(text)
  const lines = location.lines
  const protectedStart = location.found ? location.start : lines.length
  const protectedEnd = location.found ? location.end : lines.length
  const cleaned = lines.filter((line, index) => {
    if (index >= protectedStart && index < protectedEnd) return true
    return !isCpDataRow(line)
  })
  return cleaned.join('\n')
}

/**
 * Fail closed if CP data rows appear before the dedicated CP section
 * (pollution of ordinary 5-col session index tables).
 */
function assertNoCpRowsOutsideDedicatedBlock(text) {
  const location = locateCpTableBlock(text)
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const start = location.found ? location.start : lines.length
  const end = location.found ? location.end : lines.length
  for (let index = 0; index < lines.length; index += 1) {
    if (index >= start && index < end) continue
    if (isCpDataRow(lines[index])) {
      throw new Error('ConfirmBindingGate: CP rows leaked into non-CP section of sessions.md')
    }
  }
}

function cpCodeCell(value) {
  const normalized = String(value || '').replace(/`/g, '').trim()
  return normalized && normalized !== '—' ? `\`${normalized}\`` : '—'
}

function cpArtifactPathCell(row) {
  const projected = String(row?.artifactPathCell || '').trim()
  if (/^\[.*\]\((?:<[^>]+>|[^)]+)\)$/.test(projected)) return projected
  return cpCodeCell(row?.artifactPath)
}

function cpTextCell(value, fallback = '—') {
  const normalized = String(value || '').replace(/[|\r\n]+/g, ' ').trim()
  return normalized || fallback
}

function existingCpPhaseRow(parsed, phase) {
  const row = parsed[phase]
  return {
    status: row?.confirmed ? '✅' : (row?.stale ? '⚠️ stale' : (phase === 'CP1' ? '⏳' : '⏹️')),
    artifactPath: cpArtifactPathCell(row),
    artifactVersion: cpTextCell(row?.artifactVersion),
    artifactSha256: cpCodeCell(row?.artifactSha256),
    sourceMessage: cpTextCell(row?.sourceMessage),
    confirmedAt: cpTextCell(row?.confirmedAt)
  }
}

function renderCpConfirmation(existing, args, binding) {
  const newline = String(existing || '').includes('\r\n') ? '\r\n' : '\n'
  // Drop orphan CP rows that were previously appended under ordinary tables (PF-162 repair)
  const sanitized = stripOrphanCpRowsOutsideBlock(existing)
  const location = locateCpTableBlock(sanitized)
  const priorBlock = location.found && !location.incomplete
    ? location.lines.slice(location.start, location.end).join('\n')
    : ''
  const parsed = parseCpTableRows(priorBlock)
  const phases = Object.fromEntries(['CP1', 'CP2', 'CP3'].map(phase => [phase, existingCpPhaseRow(parsed, phase)]))
  const active = phases[args.phase]
  active.status = '✅'
  active.confirmedAt = cpTextCell(binding.time)
  if (binding.hasDigest) {
    active.artifactPath = binding.artifactLink || cpCodeCell(binding.artifactPath)
    active.artifactVersion = cpTextCell(binding.artifactVersion)
    active.artifactSha256 = cpCodeCell(binding.sha)
    active.sourceMessage = cpTextCell(binding.sourceMessage)
  }

  const renderedLines = renderExtendedCpTable(phases).split('\n')
  renderedLines[0] = (location.found && location.headingLine) || '### CP 确认记录'
  const rendered = renderedLines.join('\n')
  let output
  if (location.found) {
    output = [
      ...location.lines.slice(0, location.start),
      ...rendered.split('\n'),
      ...location.lines.slice(location.end)
    ].join('\n')
  } else {
    // Never append a bare CP data row; always materialize heading + header + CP1~CP3
    output = `${String(sanitized || '').trimEnd()}${sanitized ? '\n\n' : ''}${rendered}`
  }
  if (!/^#\s+/m.test(output)) output = `# ${args.requirement} 任务会话记录\n\n${output}`
  const requiredSections = [
    ['## 本轮摘要', '- 本轮 CP 确认状态已由结构化表格记录。'],
    ['## 已确认事项', '- 以 CP 确认表及其 artifact digest 绑定为准。'],
    ['## 待确认事项', '- 无则保持本项。'],
    ['## 备注', '- 本文件由 Memory MCP 事务写入并读回。']
  ]
  for (const [heading, placeholder] of requiredSections) {
    if (!new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(output)) {
      output = `${output.trimEnd()}\n\n${heading}\n\n${placeholder}`
    }
  }
  return output.replace(/\n/g, newline).replace(new RegExp(`${newline}*$`), newline)
}

function fileDigest(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex')
}

function relativeToActiveRoot(target, filePath) {
  return path.relative(target.activeRoot, filePath).replace(/\\/g, '/')
}

function relativeExistingToActiveRoot(target, filePath) {
  const realpath = fs.realpathSync.native
    ? candidate => fs.realpathSync.native(candidate)
    : candidate => fs.realpathSync(candidate)
  return path.relative(realpath(target.activeRoot), realpath(filePath)).replace(/\\/g, '/')
}

function memoryLinkCapability(target, surface) {
  return createLinkCapabilityDecision({
    surface,
    evidenceState: 'verified',
    supportsMarkdown: true,
    supportsClickable: false,
    workspaceRoot: target.activeRoot,
    targetRelation: 'workspace',
    evidenceRefs: ['MemoryArtifactLinkProjectionV1:canonical-containment']
  })
}

function projectMemoryArtifactLinks(target, documentPath, artifacts, options = {}) {
  return createArtifactLinkProjectionSet({
    activeRoot: target.activeRoot,
    operation: options.operation || 'project',
    documentPath,
    artifacts,
    linkCapability: options.linkCapability || memoryLinkCapability(target, options.surface || 'memory-mcp-markdown')
  })
}

function joinMarkdownBlocks(content, block) {
  const source = String(content || '')
  if (!block) return source
  if (!source) return `${block}\n`
  if (source.endsWith('\n\n')) return `${source}${block}\n`
  if (source.endsWith('\n')) return `${source}\n${block}\n`
  return `${source}\n\n${block}\n`
}

function summaryArtifactDescriptor(value, defaultId) {
  if (!value) return null
  return { ...value, id: value.id || defaultId }
}

function escapeSummaryCell(value) {
  return String(value || '').replace(/(^|[^\\])\|/g, '$1\\|')
}

function canonicalMemoryPath(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  let existing = resolved
  const suffix = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    suffix.unshift(path.basename(existing))
    existing = parent
  }
  let canonical = existing
  try {
    const realpath = fs.realpathSync.native || fs.realpathSync
    canonical = realpath(existing)
  } catch {
    canonical = existing
  }
  const value = path.resolve(canonical, ...suffix).replace(/\\/g, '/')
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function memoryOperationIdentity(kind, target, value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 'MemoryPureOperationIdentityV1',
    kind,
    activeRoot: canonicalMemoryPath(target.activeRoot),
    project: target.project,
    agent: target.agent,
    value
  })).digest('hex')
}

function memoryTemplateLogicalTarget(kind, args = {}) {
  const project = encodeURIComponent(String(args.project || 'current'))
  const agent = encodeURIComponent(String(args.agent || 'current'))
  if (kind === 'session') {
    return `devcodex-memory://session/${project}/${agent}/${encodeURIComponent(String(args.date || 'current'))}`
  }
  if (kind === 'summary') return `devcodex-memory://summary/${project}/${agent}`
  if (kind === 'task') {
    return `devcodex-memory://task/${project}/${encodeURIComponent(String(args.kind || 'requirements'))}/${encodeURIComponent(String(args.requirement || 'unknown'))}/sessions`
  }
  throw memoryQueryError(`Unsupported memory template target kind: ${kind}`, null, 'MEMORY_TEMPLATE_TARGET_INVALID')
}

function createMemoryTemplateContext(target, logicalTarget) {
  const registry = readLayeredArtifactSlotRegistry({
    activeRoot: target.activeRoot,
    project: target.project,
    fs
  })
  const slot = registry.slots.find(item => item.slotId === 'project-memory')
  if (!slot) throw memoryQueryError('ArtifactSlotRegistryV2 is missing project-memory.', null, 'MEMORY_TEMPLATE_SLOT_MISSING')
  const binding = createArtifactTemplateBinding({
    slot,
    target: logicalTarget,
    intent: 'memory',
    bindingMode: 'producer-supplied'
  })
  if (!binding) throw memoryQueryError('No template applies to the formal memory target.', null, 'MEMORY_TEMPLATE_BINDING_MISSING')
  return { logicalTarget, binding }
}

function cpArtifactWorkflowIntent(taskKind) {
  return taskKind === 'bugs' ? 'fix' : 'dev'
}

/**
 * Qualify the CP artifact itself before AutoCheckpointDecision or sessions state can mutate.
 * The memory transaction template proves sessions.md only; it cannot stand in for the
 * candidate's own slot, phase, canonical template, or stable readback.
 */
function qualifyCpConfirmationArtifact({ target, taskKind, phase, candidate, artifactTargetPath }) {
  const registry = readLayeredArtifactSlotRegistry({
    activeRoot: target.activeRoot,
    project: target.project,
    fs
  })
  const classified = classifyRelativeTarget(artifactTargetPath, registry, 'active-root')
  const slot = classified?.slot || null
  const allowedMatch = ['canonical', 'versioned-candidate'].includes(classified?.matchType)
  if (!slot || !allowedMatch || slot.stage !== phase || !(slot.taskKinds || []).includes(taskKind)) {
    throw memoryQueryError(
      `CP artifact slot mismatch: phase=${phase}, taskKind=${taskKind}, path=${artifactTargetPath}, ` +
      `slot=${slot?.slotId || 'none'}, stage=${slot?.stage || 'none'}, matchType=${classified?.matchType || 'none'}.`,
      'Use the canonical or versioned candidate artifact owned by the same CP phase and task kind.',
      'MEMORY_CP_ARTIFACT_SLOT_MISMATCH'
    )
  }
  const binding = createArtifactTemplateBinding({
    slot,
    target: candidate,
    intent: cpArtifactWorkflowIntent(taskKind),
    bindingMode: 'runtime-prewrite'
  })
  if (!binding) {
    throw memoryQueryError(
      `No canonical template binding is available for CP artifact slot ${slot.slotId}.`,
      'Restore the shipped/overlay artifact template mapping before confirming this candidate.',
      'MEMORY_CP_ARTIFACT_TEMPLATE_BINDING_MISSING'
    )
  }
  const qualification = qualifyArtifactFile(binding, candidate, { slotId: slot.slotId }, { fs })
  const validation = validateArtifactTemplateQualification(qualification, binding)
  const valid = validation.valid &&
    qualification.readbackVerified === true && qualification.artifactDigest
  if (!valid) {
    const issues = [...new Set([
      ...(validation.errors || []),
      ...(qualification.errorCodes || []),
      ...(qualification.missingSemanticIds || []).map(id => `missing:${id}`)
    ])]
    throw memoryQueryError(
      `CP artifact template qualification failed for ${artifactTargetPath}: ${issues.join(', ') || 'unqualified'}.`,
      'Revise a new immutable candidate from the canonical template, re-hash it, and confirm that replacement.',
      'MEMORY_CP_ARTIFACT_TEMPLATE_UNQUALIFIED'
    )
  }
  return {
    slot: {
      schemaVersion: 'MemoryCpArtifactSlotV1',
      slotId: slot.slotId,
      artifactClass: slot.artifactClass,
      stage: slot.stage,
      matchType: classified.matchType,
      registryDigest: registry.mergedRegistryDigest || null
    },
    binding: projectArtifactTemplateBinding(binding),
    qualification
  }
}

function assertMemoryTemplateQualification(qualification, phase) {
  const validation = validateArtifactTemplateQualification(qualification)
  if (!validation.valid || (phase === 'readback' && qualification.readbackVerified !== true)) {
    const reasons = [...new Set([...validation.errors, ...(qualification?.errorCodes || [])])]
    const error = memoryQueryError(
      `Memory artifact template qualification failed during ${phase}: ${reasons.join(', ') || 'unknown qualification error'}.`,
      'Repair the artifact so it preserves the bound template semantics, then retry with a fresh binding.',
      'MEMORY_TEMPLATE_QUALIFICATION_REJECTED'
    )
    error.templateQualification = qualification
    error.validationErrors = validation.errors
    throw error
  }
}

function memoryLockDir(target, filePath) {
  const key = crypto
    .createHash('sha256')
    .update(`${canonicalMemoryPath(target.activeRoot)}\0${canonicalMemoryPath(filePath)}`)
    .digest('hex')
  return resolveInside(resolveRuntimeStateRoot(target.activeRoot, target.project).root, 'memory-locks', key)
}

const MEMORY_LOCK_LEGACY_STALE_MS = 30 * 60 * 1000

function readMemoryLockOwner(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
    return owner && typeof owner === 'object' && !Array.isArray(owner) ? owner : null
  } catch {
    return null
  }
}

function memoryLockAgeMs(lockDir) {
  try {
    return Math.max(0, Date.now() - fs.statSync(lockDir).mtimeMs)
  } catch {
    return 0
  }
}

function memoryLockProcessState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead'
    return 'unknown'
  }
}

function assessMemoryLockRecovery(lockDir) {
  const owner = readMemoryLockOwner(lockDir)
  const processState = memoryLockProcessState(owner?.pid)
  if (owner?.schemaVersion === 'MemoryWriterLockV2') {
    if (owner.host !== os.hostname()) {
      return { recoverable: false, reason: 'cross-host-owner', owner, processState }
    }
    return {
      recoverable: processState === 'dead',
      reason: processState === 'dead' ? 'same-host-dead-pid' : 'same-host-owner-not-proven-dead',
      owner,
      processState
    }
  }
  const ageMs = memoryLockAgeMs(lockDir)
  const oldEnough = ageMs >= MEMORY_LOCK_LEGACY_STALE_MS
  const ownerAllowsRecovery = owner?.pid
    ? processState === 'dead'
    : true
  return {
    recoverable: oldEnough && ownerAllowsRecovery,
    reason: !oldEnough
      ? 'legacy-lock-within-safety-window'
      : (ownerAllowsRecovery ? 'legacy-stale-owner' : 'legacy-owner-not-proven-dead'),
    owner,
    processState,
    ageMs
  }
}

function quarantineRecoverableMemoryLock(lockDir) {
  const assessment = assessMemoryLockRecovery(lockDir)
  if (!assessment.recoverable) return { reclaimed: false, raced: false, assessment }
  const quarantineDir = `${lockDir}.stale.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`
  try {
    fs.renameSync(lockDir, quarantineDir)
    return { reclaimed: true, raced: false, quarantineDir, assessment }
  } catch (error) {
    if (error?.code === 'ENOENT') return { reclaimed: false, raced: true, assessment }
    throw error
  }
}

function acquireMemoryLock(target, filePath) {
  const lockDir = memoryLockDir(target, filePath)
  fs.mkdirSync(path.dirname(lockDir), { recursive: true })
  const quarantines = []
  let acquired = false
  for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockDir)
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const recovery = quarantineRecoverableMemoryLock(lockDir)
      if (recovery.reclaimed) {
        quarantines.push(recovery.quarantineDir)
        continue
      }
      if (recovery.raced) continue
      throw new Error(`MEMORY_TRANSACTION_LOCKED: ${relativeToActiveRoot(target, filePath)} is locked by another writer (${recovery.assessment.reason})`)
    }
  }
  if (!acquired) {
    throw new Error(`MEMORY_TRANSACTION_LOCKED: ${relativeToActiveRoot(target, filePath)} lock acquisition raced repeatedly`)
  }
  const token = crypto.randomBytes(16).toString('hex')
  const owner = {
    schemaVersion: 'MemoryWriterLockV2',
    pid: process.pid,
    host: os.hostname(),
    token,
    file: relativeToActiveRoot(target, filePath),
    canonicalActiveRoot: canonicalMemoryPath(target.activeRoot),
    canonicalTargetPath: canonicalMemoryPath(filePath),
    acquiredAt: new Date().toISOString()
  }
  try {
    fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    try { fs.rmSync(lockDir, { recursive: true, force: true }) } catch { /* leave fail-closed */ }
    throw error
  }
  for (const quarantineDir of quarantines) {
    try { fs.rmSync(quarantineDir, { recursive: true, force: true }) } catch { /* status exposes residual quarantine */ }
  }
  return { lockDir, token }
}

function releaseMemoryLock(lock) {
  const owner = readMemoryLockOwner(lock.lockDir)
  if (!owner || owner.schemaVersion !== 'MemoryWriterLockV2' || owner.token !== lock.token) return
  try {
    fs.rmSync(lock.lockDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup. A stale lock is safer than deleting an unknown path.
  }
}

function withMemoryTransaction(target, filePath, operation, options = {}) {
  const lock = acquireMemoryLock(target, filePath)
  const startedAt = new Date().toISOString()
  const templateContent = content => options.templateContext?.selectContent
    ? options.templateContext.selectContent(content)
    : content
  try {
    const reconcileIdentity = String(options.reconcileIdentity || '')
    const operationFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      schemaVersion: 'MemoryPureOperationFingerprintV1',
      file: canonicalMemoryPath(filePath),
      reconcileIdentity
    })).digest('hex')
    const receipt = MEMORY_FILE_TRANSACTION.commitPureOperation({
      filePath,
      relativeFile: relativeToActiveRoot(target, filePath),
      operation: existing => {
        const planned = operation(existing)
        const normalized = typeof planned === 'string'
          ? { content: planned, reconcileIdentity }
          : { ...planned, reconcileIdentity }
        if (options.templateContext) {
          const qualification = qualifyArtifactContent(
            options.templateContext.binding,
            templateContent(normalized.content),
            {
              slotId: 'project-memory',
              target: options.templateContext.logicalTarget,
              artifactScope: options.templateContext.artifactScope?.(),
              readbackVerified: false,
              requireReadback: false
            }
          )
          assertMemoryTemplateQualification(qualification, 'prewrite')
        }
        return normalized
      },
      operationFingerprint,
      reconcileOnce: options.reconcileOnce !== false,
      startedAt,
      receiptContext: {
        activeRoot: target.activeRoot,
        project: target.project,
        scope: target.scope,
        agent: target.agent
      }
    })
    if (options.templateContext) {
      const persisted = readFile(filePath)
      const qualification = qualifyArtifactContent(
        options.templateContext.binding,
        templateContent(persisted),
        {
          slotId: 'project-memory',
          target: options.templateContext.logicalTarget,
          artifactScope: options.templateContext.artifactScope?.(),
          readbackVerified: true,
          requireReadback: true
        }
      )
      assertMemoryTemplateQualification(qualification, 'readback')
      receipt.templateBinding = projectArtifactTemplateBinding(options.templateContext.binding)
      receipt.templateQualification = qualification
      receipt.templateStatus = renderArtifactTemplateQualification(qualification, 'zh-CN')
    }
    return receipt
  } finally {
    releaseMemoryLock(lock)
  }
}

function parseExistingSessionNumbers(content) {
  const ids = []
  const re = /^##\s+会话\s+#?(\d+)\b/gm
  let match
  while ((match = re.exec(content || '')) !== null) {
    ids.push(Number(match[1]))
  }
  return ids.filter(Number.isFinite)
}

function formatSessionId(number) {
  return number < 100 ? String(number).padStart(2, '0') : String(number)
}

const MEMORY_SESSION_BINDING_RE = /^[a-f0-9]{64}$/
const MEMORY_SESSION_BINDING_MARKER_RE = /<!--\s*devcodex:memory-session-binding\s+v1\s+session=([^\s]+)\s+token=([a-f0-9]{64})\s*-->/gi
const MEMORY_SESSION_ALLOCATE_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'title', 'intent', 'sourceMessage'
])
const MEMORY_SESSION_WRITE_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'content', 'artifacts', 'sessionId', 'sessionBinding'
])
const MEMORY_ARTIFACT_LINK_PROJECT_FIELDS = new Set([
  'operation', 'documentPath', 'artifacts', 'linkCapability', 'scope', 'project'
])
const MEMORY_SUMMARY_APPEND_FIELDS = new Set([
  'agent', 'scope', 'project', 'row', 'entry', 'reportArtifact', 'memoryArtifact'
])

function memorySessionBindingMarker(sessionId, sessionBinding) {
  return `<!-- devcodex:memory-session-binding v1 session=${sessionId} token=${sessionBinding} -->`
}

function parseDailySessionBlocks(content) {
  const source = String(content || '')
  const headingRe = /^##[ \t]+会话[ \t]+([^\s—-]+)(?:[ \t]*[-—][ \t]*([^\r\n]*))?[ \t]*\r?$/gm
  const headings = []
  let match
  while ((match = headingRe.exec(source)) !== null) {
    let sessionId
    try {
      sessionId = normalizeSessionId(match[1])
    } catch (error) {
      throw memoryQueryError(
        `Daily memory contains an invalid session heading: ${match[1]}.`,
        'Repair the malformed daily session heading before retrying the write.',
        'MEMORY_SESSION_LAYOUT_INVALID'
      )
    }
    headings.push({ start: match.index, sessionId, title: String(match[2] || '').trim() })
  }
  const candidateHeadings = source.match(/^##[ \t]+会话(?:[ \t]|$).*$/gm) || []
  if (candidateHeadings.length !== headings.length) {
    throw memoryQueryError(
      'Daily memory contains a malformed canonical session heading.',
      'Repair the malformed daily session heading before retrying the write.',
      'MEMORY_SESSION_LAYOUT_INVALID'
    )
  }
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? source.length
    const raw = source.slice(heading.start, end)
    const bindings = []
    MEMORY_SESSION_BINDING_MARKER_RE.lastIndex = 0
    let bindingMatch
    while ((bindingMatch = MEMORY_SESSION_BINDING_MARKER_RE.exec(raw)) !== null) {
      let markerSessionId
      try {
        markerSessionId = normalizeSessionId(bindingMatch[1])
      } catch (error) {
        throw memoryQueryError(
          `Daily memory session ${heading.sessionId} contains an invalid binding marker identity.`,
          'Repair the invalid session binding marker before retrying the write.',
          'MEMORY_SESSION_LAYOUT_INVALID'
        )
      }
      if (markerSessionId !== heading.sessionId) {
        throw memoryQueryError(
          `Daily memory session ${heading.sessionId} contains a binding marker for session ${markerSessionId}.`,
          'Repair the cross-session binding marker before retrying the write.',
          'MEMORY_SESSION_LAYOUT_INVALID'
        )
      }
      bindings.push(bindingMatch[2])
    }
    if (bindings.length > 1) {
      throw memoryQueryError(
        `Daily memory session ${heading.sessionId} contains multiple binding markers.`,
        'Repair the duplicate session binding markers before retrying the write.',
        'MEMORY_SESSION_LAYOUT_INVALID'
      )
    }
    return {
      ...heading,
      end,
      raw,
      binding: bindings[0] || null,
      ownerKey: raw.match(/<!--\s*devcodex:memory-session-owner\s+v1\s+key=([a-f0-9]{64})\s*-->/)?.[1] || null,
      digest: fileDigest(raw)
    }
  })
}

function boundMemoryTemplateContent(content, binding) {
  const matches = parseDailySessionBlocks(content).filter(block => block.sessionId === binding.sessionId)
  if (matches.length !== 1 || !binding.sessionBinding || matches[0].binding !== binding.sessionBinding) {
    throw memoryQueryError('Template verification requires exactly one allocated memory session.',
      'Use the current allocation binding and reconcile duplicate or changed session blocks.',
      'MEMORY_TEMPLATE_SESSION_BINDING_INVALID')
  }
  return matches[0].raw
}

function normalizeMemorySessionWriteBinding(args) {
  const hasSessionId = args.sessionId !== undefined && args.sessionId !== null
  const hasSessionBinding = args.sessionBinding !== undefined && args.sessionBinding !== null
  if (hasSessionBinding && !hasSessionId) {
    throw memoryQueryError(
      'sessionBinding cannot be used without sessionId.',
      'Pass the exact sessionId and sessionBinding returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  const sessionId = hasSessionId ? normalizeSessionId(args.sessionId) : null
  if (hasSessionId && !sessionId) {
    throw memoryQueryError(
      'sessionId must not be empty.',
      'Pass the exact sessionId returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  if (hasSessionBinding && !MEMORY_SESSION_BINDING_RE.test(String(args.sessionBinding))) {
    throw memoryQueryError(
      'sessionBinding must be the exact 64-character lowercase value returned by memory_session_allocate.',
      'Pass the allocation receipt values without editing them.',
      'MEMORY_SESSION_BINDING_INVALID'
    )
  }
  return {
    sessionId,
    sessionBinding: hasSessionBinding ? String(args.sessionBinding) : null
  }
}

function currentMemorySessionOwnerKey(target) {
  let state = {}
  try { state = readServerOwnedLifecycleProjection(target).state || {} } catch { }
  const hostSessionId = process.env.DEVCODEX_HOST_SESSION_ID || state.contextAcquisition?.hostSessionId ||
    state.contextAcquisition?.receipt?.identity?.hostSessionId
  if (!hostSessionId) return null
  const observedSession = state.contextAcquisition?.hostSessionId || state.contextAcquisition?.receipt?.identity?.hostSessionId
  return fileDigest(JSON.stringify([String(hostSessionId), observedSession === hostSessionId ? state.taskRecoveryBinding?.taskId || null : null]))
}

function recoverMemorySessionWriteBinding(args, target) {
  if (args.sessionId != null && args.sessionBinding != null) return normalizeMemorySessionWriteBinding(args)
  const ownerKey = currentMemorySessionOwnerKey(target)
  const p = memoryClientPath(target, 'tasks', `${args.date || today()}.md`)
  const blocks = parseDailySessionBlocks(readFile(p))
  const matches = blocks.filter(block => block.binding &&
    (args.sessionBinding ? block.binding === args.sessionBinding : ownerKey && block.ownerKey === ownerKey) &&
    (args.sessionId == null || block.sessionId === normalizeSessionId(args.sessionId)))
  if (matches.length === 1) return { sessionId: matches[0].sessionId, sessionBinding: matches[0].binding }
  if (args.sessionId != null || args.sessionBinding != null || !ownerKey || matches.length > 1) {
    throw memoryQueryError('The exact current memory session cannot be recovered from observed evidence.',
      'Preserve this content and continue the task; retry the memory write after allocation is available.',
      'MEMORY_SESSION_BINDING_UNAVAILABLE')
  }
  const allocation = handleMemorySessionAllocate({ agent: args.agent, scope: args.scope, project: args.project, date: args.date })
  return { sessionId: allocation.structuredContent.sessionId, sessionBinding: allocation.structuredContent.sessionBinding }
}

function validateMemoryWriterArgs(args, allowedFields, toolName, requiredFields = []) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw memoryQueryError(
      `${toolName} arguments must be an object.`,
      `Pass only the published ${toolName} fields.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const unknown = Object.keys(args).filter(field => !allowedFields.has(field))
  if (unknown.length) {
    throw memoryQueryError(
      `${toolName} received unsupported fields: ${unknown.join(', ')}.`,
      `Remove unsupported fields and pass only the published ${toolName} schema.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const missing = requiredFields.filter(field => !Object.prototype.hasOwnProperty.call(args, field))
  if (missing.length) {
    throw memoryQueryError(
      `${toolName} is missing required fields: ${missing.join(', ')}.`,
      `Pass every field published in the ${toolName} required list.`,
      'MEMORY_WRITER_ARGUMENT_REQUIRED'
    )
  }
}

function normalizeMemoryAllocationLine(value, fallback, field, maxLength) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') {
    throw memoryQueryError(
      `${field} must be a string.`,
      `Pass one bounded single-line ${field} value.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const normalized = value.trim()
  if (!normalized) return fallback
  if (normalized.length > maxLength) {
    throw memoryQueryError(
      `${field} exceeds the ${maxLength}-character limit.`,
      `Shorten ${field} and retry the allocation.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized) ||
      /devcodex:memory-session-binding/i.test(normalized)) {
    throw memoryQueryError(
      `${field} must be a safe single line and cannot contain reserved memory binding syntax.`,
      `Remove line breaks, control characters, or reserved binding text from ${field}.`,
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  return normalized
}

function insertMemorySessionContent(existing, content, binding) {
  const blocks = parseDailySessionBlocks(existing)
  if (!binding.sessionId || !binding.sessionBinding) {
    throw memoryQueryError(
      'A memory write requires an allocated sessionId and sessionBinding.',
      'Pass the exact sessionId and sessionBinding returned by memory_session_allocate.',
      'MEMORY_SESSION_BINDING_REQUIRED'
    )
  }
  const matches = blocks.filter(block => block.sessionId === binding.sessionId)
  if (!matches.length) {
    throw memoryQueryError(
      `Memory session ${binding.sessionId} was not found in the selected daily file.`,
      'Reallocate or query the exact date/project/agent session before retrying.',
      'MEMORY_SESSION_NOT_FOUND'
    )
  }
  if (matches.length > 1) {
    throw memoryQueryError(
      `Memory session ${binding.sessionId} is ambiguous in the selected daily file.`,
      'Repair duplicate session headings before retrying.',
      'MEMORY_SESSION_AMBIGUOUS'
    )
  }
  const target = matches[0]
  if (!target.binding) {
    throw memoryQueryError(
      `Legacy memory session ${target.sessionId} has no allocation binding and is read-only.`,
      'Allocate a new managed session and write using its returned sessionId and sessionBinding.',
      'MEMORY_SESSION_BINDING_UNAVAILABLE'
    )
  }
  if (binding.sessionBinding !== target.binding) {
    throw memoryQueryError(
      `Memory session ${target.sessionId} rejected a mismatched allocation binding.`,
      'Use the sessionBinding from the same allocation receipt as sessionId.',
      'MEMORY_SESSION_BINDING_MISMATCH'
    )
  }

  const targetPrefix = existing.slice(0, target.end).replace(/[ \t]*$/, '')
  const suffix = existing.slice(target.end)
  const separator = targetPrefix.endsWith('\n') ? '' : '\n'
  const contentSuffix = String(content).endsWith('\n') ? '' : '\n'
  const next = `${targetPrefix}${separator}${content}${contentSuffix}${suffix}`

  const afterBlocks = parseDailySessionBlocks(next)
  const targetAfter = afterBlocks.find(block => block.sessionId === target.sessionId)
  const nonTargetBefore = blocks.filter(block => block.start !== target.start)
  const nonTargetAfter = afterBlocks.filter(block => block.start !== targetAfter?.start)
  const nonTargetStable = nonTargetBefore.length === nonTargetAfter.length && nonTargetBefore.every((block, index) => (
    block.sessionId === nonTargetAfter[index]?.sessionId && block.raw === nonTargetAfter[index]?.raw
  ))
  const targetChanged = Boolean(targetAfter && targetAfter.raw !== target.raw)
  const targetContainsWrite = Boolean(targetAfter && targetAfter.raw.includes(String(content)))
  if (!nonTargetStable || !targetChanged || !targetContainsWrite) {
    throw memoryQueryError(
      'Memory session write isolation verification failed before persistence.',
      'Do not retry blindly; inspect the daily session layout and writer contract.',
      'MEMORY_SESSION_WRITE_VERIFICATION_FAILED'
    )
  }

  return {
    content: next,
    receipt: {
      schemaVersion: 'MemorySessionWriteReceiptV1',
      mode: 'bound-session',
      sessionId: target.sessionId,
      bindingStatus: 'verified',
      writeDigest: fileDigest(content),
      targetBeforeDigest: target.digest,
      targetAfterDigest: targetAfter.digest,
      nonTargetStable,
      readbackVerified: true
    }
  }
}

// ─── Bounded read-only projection helpers ───────────────────────────────────

const MEMORY_QUERY_STATUSES = new Set(['active', 'completed', 'blocked', 'unresolved', 'all'])
const MEMORY_STATUS_FIELDS = new Set(['agent', 'scope', 'project', 'limit', 'contextBinding'])
const MEMORY_SESSION_QUERY_FIELDS = new Set([
  'agent', 'scope', 'project', 'date', 'sessionId', 'status', 'limit', 'handoffOnly', 'maxChars', 'cursor', 'contextBinding'
])
const MEMORY_SUMMARY_QUERY_FIELDS = new Set(['agent', 'scope', 'project', 'status', 'limit', 'since', 'cursor', 'contextBinding'])
const MAX_SUMMARY_ROWS_FOR_STATUS = 20

function elapsedMs(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3))
}

function yesterday() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return formatLocalDate(date)
}

function validateQueryDate(value, field = 'date') {
  if (!/^\d{8}$/.test(String(value || ''))) {
    throw memoryQueryError(`${field} must be YYYYMMDD.`)
  }
  if (!isRealCompactDate(value)) {
    throw memoryQueryError(`${field} is not a real calendar date.`)
  }
}

function validateSince(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw memoryQueryError('since must be YYYY-MM-DD.')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw memoryQueryError('since is not a real calendar date.')
  }
}

function memoryQueryError(message, nextStep, code = 'MEMORY_QUERY_INVALID') {
  const error = new Error(message)
  error.contextReadCode = code
  error.nextStep = nextStep || 'Correct the bounded memory query and retry once.'
  return error
}

const MEMORY_CURSOR_SCHEMA = 'MemoryCursorV1'
const MEMORY_CURSOR_PREFIX = 'mcv1'
const MEMORY_CURSOR_MAX_OFFSET = 1000000

function stableCursorValue(value) {
  if (Array.isArray(value)) return value.map(stableCursorValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().flatMap(key => (
    value[key] === undefined ? [] : [[key, stableCursorValue(value[key])]]
  )))
}

function memoryCursorDigest(value) {
  return fileDigest(JSON.stringify(stableCursorValue(value)))
}

function memoryCursorBinding(tool, target, contextBinding, query) {
  return {
    tool,
    targetDigest: memoryCursorDigest({
      activeRoot: comparableActiveRoot(target.activeRoot),
      project: target.project,
      scope: target.scope,
      agent: target.agent
    }),
    contextBindingDigest: memoryCursorDigest(contextBinding),
    queryDigest: memoryCursorDigest(query)
  }
}

function encodeMemoryCursor(input) {
  const payload = {
    schemaVersion: MEMORY_CURSOR_SCHEMA,
    tool: input.tool,
    targetDigest: input.targetDigest,
    contextBindingDigest: input.contextBindingDigest,
    queryDigest: input.queryDigest,
    sourceIdentity: input.sourceIdentity,
    offset: input.offset
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const integrity = fileDigest(`${MEMORY_CURSOR_SCHEMA}\0${body}`)
  return `${MEMORY_CURSOR_PREFIX}.${body}.${integrity}`
}

function decodeMemoryCursor(token, expected) {
  if (typeof token !== 'string' || !token || token.length > 8192 || token !== token.trim()) {
    throw memoryQueryError(
      'cursor must be one exact opaque MemoryCursorV1 token.',
      'Pass nextCursor unchanged with the same query.',
      'MEMORY_CURSOR_INVALID'
    )
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== MEMORY_CURSOR_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) {
    throw memoryQueryError('cursor encoding is invalid.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  const integrity = fileDigest(`${MEMORY_CURSOR_SCHEMA}\0${parts[1]}`)
  const supplied = Buffer.from(parts[2], 'hex')
  const computed = Buffer.from(integrity, 'hex')
  if (supplied.length !== computed.length || !crypto.timingSafeEqual(supplied, computed)) {
    throw memoryQueryError('cursor integrity check failed.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  let payload
  try {
    const decoded = Buffer.from(parts[1], 'base64url')
    if (decoded.toString('base64url') !== parts[1]) throw new Error('non-canonical base64url')
    payload = JSON.parse(decoded.toString('utf8'))
  } catch {
    throw memoryQueryError('cursor payload is invalid.', 'Pass nextCursor unchanged with the same query.', 'MEMORY_CURSOR_INVALID')
  }
  const validShape = payload && !Array.isArray(payload) && payload.schemaVersion === MEMORY_CURSOR_SCHEMA &&
    typeof payload.tool === 'string' && /^[a-f0-9]{64}$/.test(payload.targetDigest || '') &&
    /^[a-f0-9]{64}$/.test(payload.contextBindingDigest || '') && /^[a-f0-9]{64}$/.test(payload.queryDigest || '') &&
    /^[a-f0-9]{64}$/.test(payload.sourceIdentity || '') && Number.isInteger(payload.offset) &&
    payload.offset >= 0 && payload.offset <= MEMORY_CURSOR_MAX_OFFSET
  if (!validShape) {
    throw memoryQueryError('cursor payload does not satisfy MemoryCursorV1.', 'Use a current nextCursor from this tool.', 'MEMORY_CURSOR_INVALID')
  }
  for (const field of ['tool', 'targetDigest', 'contextBindingDigest', 'queryDigest']) {
    if (payload[field] !== expected[field]) {
      throw memoryQueryError(
        `cursor ${field} does not match this request.`,
        'Restart from the first page after changing tool, target, context binding, or query fields.',
        'MEMORY_CURSOR_BINDING_MISMATCH'
      )
    }
  }
  return payload
}

function memoryCursorSourceIdentity(projection) {
  const source = projection.source || {}
  return memoryCursorDigest({
    path: source.path || null,
    exists: source.exists === true,
    bytes: Number(source.bytes || 0),
    modifiedAt: source.modifiedAt || null,
    sourceDigest: source.sourceDigest || null,
    sourcePrefixDigest: source.sourcePrefixDigest || null,
    indexSourceIdentity: projection.coverage?.sourceIdentity || null
  })
}

function resolveMemoryCursor(inputCursor, binding) {
  if (inputCursor === undefined) return { offset: 0, payload: null }
  const payload = decodeMemoryCursor(inputCursor, binding)
  return { offset: payload.offset, payload }
}

function applyMemoryCursor(projection, options) {
  const sourceIdentity = memoryCursorSourceIdentity(projection)
  if (options.cursorState.payload && options.cursorState.payload.sourceIdentity !== sourceIdentity) {
    throw memoryQueryError(
      'Memory source changed after this cursor was issued.',
      'Restart from the first page so the result set is based on one source identity.',
      'MEMORY_CURSOR_SOURCE_CHANGED'
    )
  }
  const returned = Number(options.returned || 0)
  const hasMore = options.hasMore === true
  const nextOffset = options.cursorState.offset + returned
  const sourceComplete = projection.canonicalSourceTrust?.status !== 'partial' &&
    projection.fallbackCoverage?.status !== 'partial'
  const nextCursor = hasMore && sourceComplete && returned > 0
    ? encodeMemoryCursor({
        ...options.binding,
        sourceIdentity,
        offset: nextOffset
      })
    : null
  projection.pagination = {
    schemaVersion: 'MemoryPaginationV1',
    cursorAccepted: Boolean(options.cursorState.payload),
    returned,
    hasMore,
    sourceComplete,
    nextCursor,
    blockedReason: hasMore && !nextCursor
      ? (returned === 0 ? 'page-made-no-progress' : 'canonical-source-partial')
      : null
  }
  projection.nextCursor = nextCursor
  return projection
}

function comparableActiveRoot(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function resolveContextReadBinding(binding, target, sourceId) {
  if (binding === undefined || binding === null) {
    throw memoryQueryError(
      'A current ContextReadBindingV1 is required before reading governed Memory content.',
      'Generate a ContextReadPlanV2 for the resolved target and pass its exact contextBinding.',
      'CONTEXT_BINDING_REQUIRED'
    )
  }
  if (typeof binding !== 'object' || Array.isArray(binding)) {
    throw memoryQueryError(
      'contextBinding must be an object.',
      'Pass the exact ContextReadBindingV1 derived from the current ContextReadPlanV2.',
      'CONTEXT_BINDING_INVALID'
    )
  }
  const allowed = new Set(['schemaVersion', 'contextEpoch', 'planId', 'planContentId', 'activeRoot', 'project'])
  const unknown = Object.keys(binding).filter(key => !allowed.has(key))
  const requiredStrings = ['contextEpoch', 'planId', 'planContentId', 'activeRoot']
  if (unknown.length || binding.schemaVersion !== 'ContextReadBindingV1' ||
      requiredStrings.some(field => typeof binding[field] !== 'string' || !binding[field].trim()) ||
      typeof binding.project !== 'string') {
    throw memoryQueryError(
      'contextBinding does not match the published ContextReadBindingV1 request schema.',
      'Pass only schemaVersion/contextEpoch/planId/planContentId/activeRoot/project from the current plan.',
      'CONTEXT_BINDING_INVALID'
    )
  }
  if (comparableActiveRoot(binding.activeRoot) !== comparableActiveRoot(target.activeRoot) ||
      binding.project.trim() !== String(target.project || '').trim()) {
    throw memoryQueryError(
      'contextBinding target does not match the resolved active root and project.',
      'Regenerate the ContextReadPlanV2 for the resolved memory target.',
      'CONTEXT_BINDING_MISMATCH'
    )
  }
  const authorization = authorizeContextRead({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: binding,
    requestedSources: sourceId ? [sourceId] : []
  })
  if (authorization.status !== 'authorized') {
    throw memoryQueryError(
      authorization.message || 'Context read authorization failed.',
      'Generate a current ContextReadPlanV2 that selects this Memory source and retry once.',
      authorization.errorCode || 'CONTEXT_BINDING_INVALID'
    )
  }
  return authorization.binding
}

function normalizeBoundedInteger(value, fallback, max, field) {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw memoryQueryError(`${field} must be an integer between 1 and ${max}.`)
  }
  return value
}

function normalizeQueryStatus(value, fallback) {
  if (value !== undefined && value !== null && (
    typeof value !== 'string' || value !== value.trim() || value !== value.toLowerCase()
  )) {
    throw memoryQueryError('status must use one exact lowercase published value.')
  }
  const status = String(value === undefined || value === null ? fallback : value)
  if (!MEMORY_QUERY_STATUSES.has(status)) {
    throw memoryQueryError(`status must be one of: ${[...MEMORY_QUERY_STATUSES].join(', ')}.`)
  }
  return status
}

function normalizeSessionId(value) {
  const raw = String(value || '').trim().replace(/^#/, '').replace(/^会话\s*/i, '')
  if (!raw) return ''
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(raw)) {
    throw memoryQueryError('sessionId must be a bounded identifier such as 01 or 02a.')
  }
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw.toLowerCase()
}

function normalizeSummarySessionId(value) {
  const raw = String(value || '').trim().replace(/^#/, '').replace(/^会话\s*/i, '')
  if (!raw) return ''
  return /^\d+$/.test(raw) ? raw.padStart(2, '0') : clipText(raw, 64).text
}

function validateProjectionArgs(args, allowedFields) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw memoryQueryError('Memory query arguments must be an object.')
  }
  const unknown = Object.keys(args).filter(key => !allowedFields.has(key))
  if (unknown.length) throw memoryQueryError(`Unsupported memory query fields: ${unknown.join(', ')}.`)
  if (args.scope !== undefined && (
    typeof args.scope !== 'string' || !['project', 'workspace'].includes(args.scope)
  )) {
    throw memoryQueryError('scope must be project or workspace.')
  }
  if (args.project !== undefined && (typeof args.project !== 'string' || !args.project.trim())) {
    throw memoryQueryError('project must be a non-empty namespace when supplied.')
  }
}

function resolveMemoryAgent(agent, activeRoot) {
  const explicit = agent !== undefined && agent !== null && agent !== ''
  if (!explicit && EXPLICIT_RUNTIME_AGENT) return EXPLICIT_RUNTIME_AGENT
  if (!explicit) {
    const clientsRoot = resolveInside(activeRoot, '.memory', 'clients')
    let candidates = []
    try {
      candidates = fs.readdirSync(clientsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && VALID_AGENTS.has(entry.name.toLowerCase()))
        .map(entry => entry.name.toLowerCase())
        .sort()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) {
      // Prefer runtime-detected host when multi-client dirs exist (common in monorepos).
      // Only fail closed when inference is unknown or not among candidates.
      const inferred = normalizeAgent(DEFAULT_AGENT) || detectRuntimeAgent()
      if (inferred && inferred !== 'unknown-agent' && candidates.includes(inferred)) {
        return inferred
      }
      throw memoryQueryError(
        `memory agent is ambiguous; available clients: ${candidates.join(', ')}.`,
        'Pass the current actual host in agent.',
        'MEMORY_SCOPE_AMBIGUOUS'
      )
    }
  }
  const candidate = explicit ? assertSingleSegment(agent, 'agent') : DEFAULT_AGENT
  const safeAgent = normalizeAgent(candidate)
  if (!safeAgent) throw memoryQueryError('invalid agent')
  return safeAgent
}

function resolveMemoryTarget(args) {
  try {
    const activeRoot = getActiveRoot(args)
    const agent = resolveMemoryAgent(args.agent, activeRoot)
    if (!LAYOUT.enabled) {
      return {
        activeRoot,
        project: path.basename(resolveProjectRoot(args.project)) || path.basename(INPUT_ROOT),
        agent,
        scope: 'project'
      }
    }
    const explicitScope = Object.prototype.hasOwnProperty.call(args, 'scope') && String(args.scope || '').trim()
    const projectName = resolveProjectName(args.project)
    const scope = explicitScope ? resolveScope(args.scope) : (projectName ? 'project' : DEFAULT_SCOPE)
    return {
      activeRoot,
      project: scope === 'workspace' ? WORKSPACE_CONTEXT_PROJECT : (projectName || CONTEXT_PROJECT || ''),
      agent,
      scope
    }
  } catch (error) {
    if (error.contextReadCode) throw error
    if (error.workspaceBinding) {
      const bindingError = memoryQueryError(
        error.message,
        error.workspaceBinding.error?.nextStep || 'Resolve one physical workspace project and retry once.',
        error.code || 'HOST_WORKSPACE_UNRESOLVED'
      )
      bindingError.workspaceBinding = error.workspaceBinding
      throw bindingError
    }
    const code = /ambiguous|requires project|workspace root/i.test(error.message)
      ? 'MEMORY_SCOPE_AMBIGUOUS'
      : 'MEMORY_QUERY_INVALID'
    throw memoryQueryError(
      error.message,
      code === 'MEMORY_SCOPE_AMBIGUOUS'
        ? 'Pass one explicit project or scope:"workspace".'
        : 'Correct the active memory target and retry once.',
      code
    )
  }
}

function memoryClientPath(target, ...segments) {
  return resolveInside(target.activeRoot, '.memory', 'clients', target.agent, ...segments)
}

function memoryFileMetadata(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw memoryQueryError(`Memory source is not a file: ${filePath}`)
    return {
      path: filePath,
      exists: true,
      bytes: stat.size,
      chars: null,
      modifiedAt: stat.mtime.toISOString()
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { path: filePath, exists: false, bytes: 0, chars: 0, modifiedAt: null }
    }
    throw error
  }
}

function readMemoryDocument(filePath) {
  const document = readBoundedTextFileSync(filePath, {
    maxBytes: MEMORY_SOURCE_MAX_BYTES,
    allowMissing: true
  })
  if (!document.exists) {
    return {
      path: document.path,
      exists: false,
      bytes: 0,
      chars: 0,
      modifiedAt: null,
      sourceBytesRead: 0,
      maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
      content: ''
    }
  }
  return {
    path: document.path,
    exists: true,
    bytes: document.logicalBytes,
    chars: document.chars,
    modifiedAt: document.modifiedAt,
    sourceBytesRead: document.sourceBytesRead,
    maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
    content: document.content
  }
}

function memoryScanDocument(filePath, onLine) {
  let scannedChars = 0
  const scan = scanBoundedTextLinesSync(filePath, {
    maxBytes: MEMORY_SOURCE_MAX_BYTES,
    allowMissing: true,
    onLine(line) {
      if (line.text !== null) scannedChars += line.text.length + 1
      onLine(line)
    }
  })
  return {
    path: scan.path,
    exists: scan.exists,
    bytes: scan.logicalBytes,
    chars: scannedChars,
    modifiedAt: scan.modifiedAt || null,
    sourceBytesRead: scan.sourceBytesRead,
    maxSourceBytes: MEMORY_SOURCE_MAX_BYTES,
    sourceScanComplete: scan.scanComplete,
    sourceDigest: scan.sourceDigest,
    sourcePrefixDigest: scan.sourcePrefixDigest,
    continuation: scan.continuation
  }
}

function scanSummaryDocument(filePath) {
  const rows = []
  const warnings = []
  let headerFound = false
  let stopped = false
  let sawContent = false
  const document = memoryScanDocument(filePath, line => {
    if (stopped) return
    if (line.oversized) {
      warnings.push(`Skipped oversized SUMMARY line ${line.line}.`)
      return
    }
    const text = String(line.text || '')
    if (text.trim()) sawContent = true
    const cells = splitMarkdownRow(text)
    if (!headerFound) {
      if (cells.length >= 7 && cells[0] === '日期' && cells[1] === '会话' && cells[6] === '状态') {
        headerFound = true
      }
      return
    }
    if (!text.trim()) return
    if (!cells.length) {
      if (/^#/.test(text.trim())) stopped = true
      else warnings.push(`Skipped non-table SUMMARY line ${line.line}.`)
      return
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) return
    if (cells.length < 7) {
      warnings.push(`Skipped malformed SUMMARY row ${line.line}.`)
      return
    }
    try {
      const normalizedCells = cells.length === 7
        ? cells
        : [...cells.slice(0, 3), cells.slice(3, -3).join('|'), ...cells.slice(-3)]
      if (cells.length > 7) warnings.push(`Normalized unescaped SUMMARY separator at row ${line.line}.`)
      const row = projectSummaryRow(normalizedCells, line.line)
      if (!row.day || !row.sessionId) {
        warnings.push(`Skipped SUMMARY row ${line.line} without a canonical date/session.`)
        return
      }
      if (row.truncated) warnings.push(`SUMMARY row ${line.line} was field-bounded.`)
      rows.push(row)
    } catch (error) {
      warnings.push(`Skipped SUMMARY row ${line.line}: ${error.message}`)
    }
  })
  if (!headerFound && sawContent && document.sourceScanComplete) {
    warnings.push('SUMMARY table header was not found.')
  }
  if (!document.sourceScanComplete) {
    warnings.push('SUMMARY source scan reached its byte budget; continue from source.continuation before claiming complete coverage.')
  }
  return { document, rows, warnings: warnings.slice(0, 20) }
}

function appendSessionLine(session, line, maxChars) {
  const separator = session.contentParts.length ? '\n' : ''
  const fragment = `${separator}${line}`
  const remaining = Math.max(0, maxChars - session.contentChars)
  if (remaining > 0) {
    const selected = fragment.slice(0, remaining)
    session.contentParts.push(selected)
    session.contentChars += selected.length
  }
  if (fragment.length > remaining) session.contentTruncated = true
}

function appendHandoffLine(session, line, maxChars) {
  const separator = session.handoffParts.length ? '\n' : ''
  const fragment = `${separator}${line}`
  const remaining = Math.max(0, maxChars - session.handoffChars)
  if (remaining > 0) {
    const selected = fragment.slice(0, remaining)
    session.handoffParts.push(selected)
    session.handoffChars += selected.length
  }
  if (fragment.length > remaining) session.handoffTruncated = true
}

function scanDailyQueryDocument(filePath, date, query) {
  const sessions = []
  const warnings = []
  let matchedCount = 0
  let current = null
  let headingCount = 0
  let sawContent = false
  const maxSessionChars = query.maxChars

  const finalize = () => {
    if (!current || !current.sessionId) return
    const status = current.statuses[current.statuses.length - 1] || ''
    const state = normalizedMemoryState(status)
    const content = current.contentParts.join('').trim()
    const handoff = current.handoffParts.join('').trim()
    if (query.normalizedSession && current.sessionId !== query.normalizedSession) return
    if (!memoryStateMatches(state, query.status)) return
    if (query.handoffOnly && !handoff) return
    matchedCount += 1
    sessions.push({
      date,
      sessionId: current.sessionId,
      title: current.title,
      status,
      state,
      content,
      handoff,
      contentTruncated: current.contentTruncated,
      handoffTruncated: current.handoffTruncated
    })
    while (sessions.length > query.limit) sessions.shift()
  }

  const document = memoryScanDocument(filePath, line => {
    if (line.oversized) {
      if (current) current.contentTruncated = true
      warnings.push(`Skipped oversized daily-memory line ${line.line}.`)
      return
    }
    const text = String(line.text || '')
    if (text.trim()) sawContent = true
    const sessionHeading = /^##\s+会话\s+([^\s—-]+)(?:\s*[-—]\s*(.*))?$/.exec(text.trim())
    if (sessionHeading) {
      finalize()
      headingCount += 1
      let sessionId = ''
      try { sessionId = normalizeSessionId(sessionHeading[1]) } catch {}
      current = {
        sessionId,
        title: clipText(sessionHeading[2] || '', 300).text,
        statuses: [],
        contentParts: [],
        contentChars: 0,
        contentTruncated: false,
        handoffParts: [],
        handoffChars: 0,
        handoffTruncated: false,
        handoffActive: false,
        handoffLevel: 0
      }
      appendSessionLine(current, text, maxSessionChars)
      return
    }
    if (!current) return
    appendSessionLine(current, text, maxSessionChars)
    const statusMatch = /^\s*(?:-\s*)?(?:\*\*)?状态(?:\*\*)?\s*[：:]\s*(.*)$/.exec(text)
    if (statusMatch && normalizedMemoryState(statusMatch[1]) !== 'unknown') {
      current.statuses.push(statusMatch[1].trim())
    }
    const heading = /^(#{1,6})\s+/.exec(text.trim())
    const handoffHeading = /^(#{2,6})\s+.*ContextHandoffCard\b/i.exec(text.trim())
    if (handoffHeading) {
      current.handoffParts = []
      current.handoffChars = 0
      current.handoffTruncated = false
      current.handoffActive = true
      current.handoffLevel = handoffHeading[1].length
      appendHandoffLine(current, text, maxSessionChars)
    } else if (current.handoffActive) {
      if (heading && heading[1].length <= current.handoffLevel) {
        current.handoffActive = false
      } else {
        appendHandoffLine(current, text, maxSessionChars)
      }
    }
  })
  if (document.sourceScanComplete) finalize()
  else if (current) warnings.push('The final daily-memory session was deferred because the source scan ended mid-session.')
  if (!headingCount && sawContent && document.sourceScanComplete) {
    warnings.push('No canonical session headings were found.')
  }
  if (!document.sourceScanComplete) {
    warnings.push('Daily-memory source scan reached its byte budget; continue from source.continuation before claiming complete coverage.')
  }
  return { document, sessions, matchedCount, warnings: warnings.slice(0, 20) }
}

function publicSourceMetadata(document) {
  const { content, ...metadata } = document
  return metadata
}

function splitMarkdownRow(line) {
  const value = String(line || '').trim()
  if (!value.startsWith('|') || !value.endsWith('|')) return []
  const cells = []
  let current = ''
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index]
    if (char === '|' && value[index - 1] !== '\\') {
      cells.push(current.trim().replace(/\\\|/g, '|'))
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim().replace(/\\\|/g, '|'))
  return cells
}

function normalizedMemoryState(value) {
  const status = String(value || '').trim().toLowerCase()
  if (/✅|completed?|complete|closed|done|完成|已关闭/.test(status)) return 'completed'
  if (/⛔|blocked|paused|阻塞|暂停/.test(status)) return 'blocked'
  if (/🔄|⏳|active|in[- ]?progress|pending|进行中|处理中|等待/.test(status)) return 'active'
  return 'unknown'
}

function memoryStateMatches(actual, expected) {
  if (expected === 'all') return true
  if (expected === 'unresolved') return actual === 'active' || actual === 'blocked'
  return actual === expected
}

function clipText(value, maxChars) {
  const text = String(value || '')
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false }
}

function projectSummaryRow(cells, rowNumber) {
  const date = clipText(cells[0], 40)
  const session = clipText(cells[1], 64)
  const type = clipText(cells[2], 160)
  const summary = clipText(cells[3], 2000)
  const report = clipText(cells[4], 500)
  const memory = clipText(cells[5], 500)
  const status = clipText(cells[6], 100)
  const day = /^\d{4}-\d{2}-\d{2}/.test(date.text) ? date.text.slice(0, 10) : ''
  return {
    date: date.text,
    day,
    sessionId: normalizeSummarySessionId(session.text),
    sessionIdCanonical: /^[A-Za-z0-9._-]{1,64}$/.test(normalizeSummarySessionId(session.text)),
    type: type.text,
    summary: summary.text,
    report: report.text,
    memory: memory.text,
    status: status.text,
    state: normalizedMemoryState(status.text),
    rowNumber,
    truncated: [date, session, type, summary, report, memory, status].some(item => item.truncated)
  }
}

function parseSummaryRows(content) {
  const lines = String(content || '').split(/\r?\n/)
  const warnings = []
  let headerIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index])
    if (cells.length >= 7 && cells[0] === '日期' && cells[1] === '会话' && cells[6] === '状态') {
      headerIndex = index
      break
    }
  }
  if (headerIndex < 0) {
    if (String(content || '').trim()) warnings.push('SUMMARY table header was not found.')
    return { rows: [], warnings }
  }
  const rows = []
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    const cells = splitMarkdownRow(line)
    if (!cells.length) {
      if (/^#/.test(line.trim())) break
      warnings.push(`Skipped non-table SUMMARY line ${index + 1}.`)
      continue
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    if (cells.length < 7) {
      warnings.push(`Skipped malformed SUMMARY row ${index + 1}.`)
      continue
    }
    try {
      const normalizedCells = cells.length === 7
        ? cells
        : [...cells.slice(0, 3), cells.slice(3, -3).join('|'), ...cells.slice(-3)]
      if (cells.length > 7) warnings.push(`Normalized unescaped SUMMARY separator at row ${index + 1}.`)
      const row = projectSummaryRow(normalizedCells, index + 1)
      if (!row.day || !row.sessionId) {
        warnings.push(`Skipped SUMMARY row ${index + 1} without a canonical date/session.`)
        continue
      }
      if (row.truncated) warnings.push(`SUMMARY row ${index + 1} was field-bounded.`)
      rows.push(row)
    } catch (error) {
      warnings.push(`Skipped SUMMARY row ${index + 1}: ${error.message}`)
    }
  }
  return { rows, warnings: warnings.slice(0, 20) }
}

function findSummaryConflicts(rows) {
  return summaryStateConflicts(rows)
}

function extractHandoffCard(content) {
  const lines = String(content || '').split(/\r?\n/)
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,6})\s+.*ContextHandoffCard\b/i.exec(lines[index].trim())
    if (match) {
      start = index
      level = match[1].length
    }
  }
  if (start < 0) return ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+/.exec(lines[index].trim())
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

function parseDailySessions(content, date) {
  const lines = String(content || '').split(/\r?\n/)
  const headings = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+会话\s+([^\s—-]+)(?:\s*[-—]\s*(.*))?$/.exec(lines[index].trim())
    if (match) headings.push({ index, id: match[1], title: match[2] || '' })
  }
  if (!headings.length) {
    return {
      sessions: [],
      warnings: String(content || '').trim() ? ['No canonical session headings were found.'] : []
    }
  }
  const sessions = []
  for (let cursor = 0; cursor < headings.length; cursor += 1) {
    const heading = headings[cursor]
    const end = headings[cursor + 1]?.index ?? lines.length
    const raw = lines.slice(heading.index, end).join('\n').trim()
    const statuses = raw.split(/\r?\n/)
      .map(line => /^\s*(?:-\s*)?(?:\*\*)?状态(?:\*\*)?\s*[：:]\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(match => match[1].trim())
      .filter(value => normalizedMemoryState(value) !== 'unknown')
    const status = statuses[statuses.length - 1] || ''
    try {
      sessions.push({
        date,
        sessionId: normalizeSessionId(heading.id),
        title: clipText(heading.title, 300).text,
        status,
        state: normalizedMemoryState(status),
        content: raw,
        handoff: extractHandoffCard(raw),
        ordinal: cursor + 1
      })
    } catch (error) {
      // A malformed heading is ignored without fabricating a session identity.
    }
  }
  return { sessions, warnings: [] }
}

function indexedSourceMetadata(source) {
  if (!source) return null
  const { mtimeMs, ...metadata } = source
  return metadata
}

function memoryIndexFallbackReceipt(kind, result) {
  return {
    schemaVersion: 'MemoryIndexReceiptV1',
    status: 'fallback',
    kind,
    reason: result?.reason || 'index-unavailable',
    receipt: result?.envelope?.receipt || null
  }
}

function memoryIndexProjectionState(kind, result, canonicalDocument = null) {
  const fresh = result?.status === 'fresh'
  const reason = fresh ? null : (result?.reason || 'index-unavailable')
  const freshnessTier = fresh
    ? (result?.envelope?.freshnessTier || 'content-verified')
    : (result?.envelope?.freshnessTier || (reason === 'index-module-unavailable' ? 'invalid' : 'stale'))
  const canonicalMetadata = canonicalDocument
    ? publicSourceMetadata(canonicalDocument)
    : indexedSourceMetadata(result?.source)
  const missingIndexAndSource = reason === 'index-missing' && canonicalDocument?.exists === false
  const runtimeUnavailable = reason === 'index-module-unavailable'
  const repairNeeded = !fresh && !missingIndexAndSource && !runtimeUnavailable
  const canonicalComplete = !canonicalDocument || canonicalDocument.exists === false ||
    canonicalDocument.sourceScanComplete !== false
  const repairFingerprint = repairNeeded
    ? fileDigest(JSON.stringify({
        schemaVersion: 'MemoryIndexRepairDiagnosticV1',
        kind,
        reason,
        canonicalSource: canonicalMetadata,
        canonicalContentDigest: canonicalDocument
          ? (canonicalDocument.sourceDigest || canonicalDocument.sourcePrefixDigest ||
              (canonicalDocument.content !== undefined ? fileDigest(canonicalDocument.content) : null))
          : null,
        observedIndexSource: result?.envelope?.receipt?.observedSource || null
      }))
    : null

  return {
    derivedIndexFreshness: {
      status: fresh
        ? 'fresh'
        : (runtimeUnavailable ? 'unavailable' : (freshnessTier === 'invalid' ? 'invalid' : 'stale')),
      freshnessTier,
      reason
    },
    canonicalSourceTrust: {
      status: canonicalComplete ? 'trusted' : 'partial',
      authority: 'canonical-markdown',
      basis: canonicalDocument
        ? (canonicalDocument.exists
            ? (canonicalComplete ? 'bounded-source-scan-complete' : 'bounded-source-scan-partial')
            : 'source-absence-observed')
        : 'writer-attested-metadata-reconciled',
      source: canonicalMetadata
    },
    fallbackCoverage: {
      status: fresh ? 'not-used' : (canonicalComplete ? 'complete' : 'partial'),
      source: fresh ? null : 'canonical-markdown',
      reason,
      continuation: canonicalComplete ? null : canonicalDocument?.continuation || null
    },
    repairState: {
      status: runtimeUnavailable
        ? 'blocked'
        : (repairNeeded ? 'repair-needed' : 'not-needed'),
      owner: runtimeUnavailable ? 'runtime-package' : 'memory-mcp-writer',
      mode: repairNeeded ? 'next-specialized-write' : null,
      diagnosticFingerprint: repairFingerprint,
      dedupeKey: repairFingerprint ? `memory-index-repair:${repairFingerprint}` : null
    }
  }
}

function queryStatusIndex(target, sourcePath, limit) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.queryStatusIndex({ target, sourcePath, limit })
}

function querySummaryIndex(target, sourcePath, status, limit, since, offset = 0) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.querySummaryIndex({ target, sourcePath, status, limit, since, offset })
}

function queryDailyIndex(target, sourcePath, input) {
  if (!MEMORY_INDEX_CONTRACT) return { status: 'fallback', reason: 'index-module-unavailable' }
  return MEMORY_INDEX_CONTRACT.queryDailyIndex({
    target,
    sourcePath,
    date: input.date,
    sessionId: input.sessionId,
    status: input.status,
    limit: input.limit,
    handoffOnly: input.handoffOnly,
    maxChars: input.maxChars,
    offset: input.offset,
    extractHandoffCard
  })
}

function refreshSummaryMemoryIndex(target, filePath) {
  if (!MEMORY_INDEX_CONTRACT) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'bypassed',
      kind: 'summary',
      reason: 'index-module-unavailable'
    }
  }
  try {
    const document = readMemoryDocument(filePath)
    return MEMORY_INDEX_CONTRACT.refreshSummaryIndex({
      target,
      document,
      parsed: parseSummaryRows(document.content),
      freshnessTier: 'writer-attested'
    })
  } catch (error) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'error',
      kind: 'summary',
      errorCode: 'MEMORY_INDEX_REFRESH_FAILED',
      message: error.message
    }
  }
}

function refreshDailyMemoryIndex(target, filePath, date) {
  if (!MEMORY_INDEX_CONTRACT) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'bypassed',
      kind: 'daily',
      date,
      reason: 'index-module-unavailable'
    }
  }
  try {
    const document = readMemoryDocument(filePath)
    return MEMORY_INDEX_CONTRACT.refreshDailyIndex({
      target,
      date,
      document,
      parsed: parseDailySessions(document.content, date),
      freshnessTier: 'writer-attested'
    })
  } catch (error) {
    return {
      schemaVersion: 'MemoryIndexReceiptV1',
      status: 'error',
      kind: 'daily',
      date,
      errorCode: 'MEMORY_INDEX_REFRESH_FAILED',
      message: error.message
    }
  }
}

function projectionTelemetry(value, sourceDocuments, startedAt) {
  const serialized = JSON.stringify(value)
  const sourceBytesRead = sourceDocuments.reduce(
    (sum, item) => sum + Number(item.sourceBytesRead ?? item.bytes ?? 0),
    0
  )
  return {
    bytes: Buffer.byteLength(serialized, 'utf8'),
    chars: serialized.length,
    sourceBytes: sourceBytesRead,
    sourceBytesRead,
    sourceChars: sourceDocuments.reduce((sum, item) => sum + Number(item.chars || 0), 0),
    filesRead: sourceDocuments.filter(item =>
      item.exists && (item.content !== undefined || Number(item.sourceBytesRead || 0) > 0)
    ).length,
    latencyMs: elapsedMs(startedAt),
    tokens: null
  }
}

function withProjectionIdentity(projection, toolName, target, sourceDocuments, startedAt, telemetryOverride = null) {
  const contentIdentity = buildJsonContentIdentity({
    sourceKey: `memory://${target.project}/${toolName}#delivered`,
    value: projection,
    contractVersion: projection.schemaVersion
  }).identity
  const identified = { ...projection, contentIdentity }
  const telemetry = projectionTelemetry(identified, sourceDocuments, startedAt)
  let contextObservation
  try {
    contextObservation = recordMcpContextSourceObservations({
      activeRoot: target.activeRoot,
      project: target.project,
      workspaceNamespace: LAYOUT.enabled,
      contextBinding: projection.contextBinding,
      hostSessionId: String(process.env.DEVCODEX_HOST_SESSION_ID || ''),
      sourceResults: [{
        sourceId: `memory:${toolName}`,
        sourceLayer: 'memory-query',
        outcome: 'observed-success',
        successful: true,
        observable: true,
        transportSuccess: true,
        sourceRefsMatch: true,
        schemaMatch: true,
        targetMatch: true,
        contentIdentity,
        bodyObserved: true,
        bytes: contentIdentity.bytes,
        chars: contentIdentity.bytes,
        hostDeliveredBytes: telemetry.bytes
      }]
    })
  } catch (error) {
    contextObservation = {
      status: 'degraded',
      errorCode: error.code || 'CONTEXT_SOURCE_OBSERVATION_FAILED',
      message: error.message
    }
  }
  return {
    ...identified,
    contextObservation: {
      schemaVersion: 'ContextSourceObservationWriteReceiptV1',
      status: contextObservation?.status || 'degraded',
      errorCode: contextObservation?.errorCode || null,
      ledgerStatus: contextObservation?.ledgerStatus || null,
      lifecycleStatus: contextObservation?.lifecycleStatus || null,
      receiptStatus: contextObservation?.receiptStatus || null,
      contextSnapshotId: contextObservation?.contextSnapshotId || null,
      observationLease: contextObservation?.observationLease || null,
      satisfiedSourceIds: (contextObservation?.satisfiedSourceIds || []).slice(0, 20),
      missingSourceIds: (contextObservation?.missingSourceIds || []).slice(0, 20)
    },
    telemetry: telemetryOverride
      ? {
          ...telemetry,
          sourceBytes: telemetryOverride.sourceBytes,
          sourceBytesRead: telemetryOverride.sourceBytesRead ?? telemetryOverride.sourceBytes,
          filesRead: telemetryOverride.filesRead,
          tokens: telemetryOverride.tokens ?? null,
          indexLatencyMs: telemetryOverride.latencyMs ?? null,
          ...(Number.isFinite(telemetryOverride.indexBytesRead)
            ? { indexBytesRead: telemetryOverride.indexBytesRead }
            : {})
        }
      : telemetry
  }
}

function memoryProjectionResult(value) {
  const isError = value?.schemaVersion === CONTEXT_READ_CONTRACT.schemas.error
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  }
}

function runMemoryProjection(args, allowedFields, handler) {
  try {
    validateProjectionArgs(args, allowedFields)
    return memoryProjectionResult(handler(args))
  } catch (error) {
    const errorCode = error.contextReadCode || (/ambiguous|requires project|workspace root/i.test(error.message)
      ? 'MEMORY_SCOPE_AMBIGUOUS'
      : 'MEMORY_QUERY_INVALID')
    return memoryProjectionResult(buildContextReadError(
      errorCode,
      error.message,
      error.nextStep || 'Correct the bounded memory query and retry once.'
    ))
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleMemoryStatus(args) {
  return runMemoryProjection(args, MEMORY_STATUS_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_status'
    )
    const limit = normalizeBoundedInteger(input.limit, 5, 20, 'limit')
    const todayDate = today()
    const yesterdayDate = yesterday()
    const todayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${todayDate}.md`))
    const yesterdayMetadata = memoryFileMetadata(memoryClientPath(target, 'tasks', `${yesterdayDate}.md`))
    const summaryPath = memoryClientPath(target, 'SUMMARY.md')
    const indexed = queryStatusIndex(target, summaryPath, limit)
    if (indexed.status === 'fresh') {
      const activeSessionIds = indexed.activeSessionIds.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
      const conflicts = indexed.conflicts.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
      const boundWarnings = []
      if (indexed.activeSessionIds.length > activeSessionIds.length) {
        boundWarnings.push(`activeSessionIds was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
      }
      if (indexed.conflicts.length > conflicts.length) {
        boundWarnings.push(`conflicts was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
      }
      if (indexed.nonCanonicalActiveCount) {
        boundWarnings.push(`${indexed.nonCanonicalActiveCount} active SUMMARY row(s) use non-canonical session labels; inspect latestRows.`)
      }
      const projection = {
        schemaVersion: 'MemoryStatusV1',
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        today: { date: todayDate, ...todayMetadata },
        yesterday: { date: yesterdayDate, ...yesterdayMetadata },
        summary: indexedSourceMetadata(indexed.source),
        latestRows: indexed.latestRows,
        activeSessionIds,
        conflicts,
        warnings: [...boundWarnings, ...indexed.warnings].slice(0, 20),
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('summary', indexed),
        contextBinding
      }
      return withProjectionIdentity(
        projection,
        'memory_status',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedSummary = scanSummaryDocument(summaryPath)
    const summaryDocument = scannedSummary.document
    const parsed = { rows: scannedSummary.rows, warnings: scannedSummary.warnings }
    const latestRows = parsed.rows.slice().reverse().slice(0, limit)
    const currentRows = rowsByCurrentState(parsed.rows, 'unresolved')
    const nonCanonicalActiveRows = currentRows.filter(row => row.state === 'active' && !row.sessionIdCanonical)
    const allActiveSessionIds = currentActiveSessionIds(parsed.rows)
    const allConflicts = findSummaryConflicts(parsed.rows)
    const activeSessionIds = allActiveSessionIds.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
    const conflicts = allConflicts.slice(0, MAX_SUMMARY_ROWS_FOR_STATUS)
    const boundWarnings = []
    if (allActiveSessionIds.length > activeSessionIds.length) {
      boundWarnings.push(`activeSessionIds was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
    }
    if (allConflicts.length > conflicts.length) {
      boundWarnings.push(`conflicts was bounded to ${MAX_SUMMARY_ROWS_FOR_STATUS}.`)
    }
    if (nonCanonicalActiveRows.length) {
      boundWarnings.push(`${nonCanonicalActiveRows.length} active SUMMARY row(s) use non-canonical session labels; inspect latestRows.`)
    }
    const summary = publicSourceMetadata(summaryDocument)
    const projection = {
      schemaVersion: 'MemoryStatusV1',
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      today: { date: todayDate, ...todayMetadata },
      yesterday: { date: yesterdayDate, ...yesterdayMetadata },
      summary,
      latestRows,
      activeSessionIds,
      conflicts,
      warnings: [...boundWarnings, ...parsed.warnings].slice(0, 20),
      indexReceipt: memoryIndexFallbackReceipt('summary', indexed),
      coverage: {
        status: summaryDocument.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: summaryDocument.continuation
      },
      ...memoryIndexProjectionState('summary', indexed, summaryDocument),
      contextBinding
    }
    return withProjectionIdentity(projection, 'memory_status', target, [summaryDocument], startedAt)
  })
}

function handleMemorySessionQuery(args) {
  return runMemoryProjection(args, MEMORY_SESSION_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_session_query'
    )
    if (input.date !== undefined && (typeof input.date !== 'string' || !input.date)) {
      throw memoryQueryError('date must be a non-empty YYYYMMDD string when supplied.')
    }
    const date = input.date === undefined ? today() : input.date
    validateQueryDate(date)
    if (input.sessionId !== undefined && (
      typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId !== input.sessionId.trim()
    )) {
      throw memoryQueryError('sessionId must be a non-empty exact identifier when supplied.')
    }
    const requestedSessionId = input.sessionId === undefined ? '' : input.sessionId
    const normalizedSession = requestedSessionId ? normalizeSessionId(requestedSessionId) : ''
    const status = normalizeQueryStatus(input.status, 'all')
    const limit = normalizeBoundedInteger(input.limit, 1, 20, 'limit')
    const maxChars = normalizeBoundedInteger(input.maxChars, 12000, 50000, 'maxChars')
    if (input.handoffOnly !== undefined && typeof input.handoffOnly !== 'boolean') {
      throw memoryQueryError('handoffOnly must be boolean.')
    }
    const handoffOnly = input.handoffOnly === true
    const query = {
      date,
      sessionId: requestedSessionId || null,
      status,
      limit,
      handoffOnly,
      maxChars
    }
    const cursorBinding = memoryCursorBinding('memory_session_query', target, contextBinding, query)
    const cursorState = resolveMemoryCursor(input.cursor, cursorBinding)
    const dailyPath = memoryClientPath(target, 'tasks', `${date}.md`)
    const indexed = queryDailyIndex(target, dailyPath, {
      date,
      sessionId: normalizedSession,
      status,
      limit,
      handoffOnly,
      maxChars,
      offset: cursorState.offset
    })
    if (indexed.status === 'fresh') {
      const source = {
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        date,
        ...indexedSourceMetadata(indexed.source)
      }
      const projection = {
        schemaVersion: 'MemorySessionQueryV1',
        query,
        matches: indexed.matches,
        totalMatched: indexed.totalMatched,
        truncated: indexed.envelope.truncated,
        source,
        warnings: indexed.warnings,
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('daily', indexed),
        contextBinding
      }
      applyMemoryCursor(projection, {
        binding: cursorBinding,
        cursorState,
        returned: indexed.matches.length,
        hasMore: Boolean(indexed.envelope.nextPointer)
      })
      return withProjectionIdentity(
        projection,
        'memory_session_query',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedDaily = scanDailyQueryDocument(dailyPath, date, {
      normalizedSession,
      status,
      limit: Math.min(MEMORY_CURSOR_MAX_OFFSET, cursorState.offset + limit),
      handoffOnly,
      maxChars
    })
    const document = scannedDaily.document
    const candidates = scannedDaily.sessions.slice().reverse().slice(cursorState.offset, cursorState.offset + limit)
    const matches = []
    let remainingChars = maxChars
    let contentTruncated = false
    for (const session of candidates) {
      if (remainingChars <= 0) {
        contentTruncated = true
        break
      }
      const sourceContent = handoffOnly ? session.handoff : session.content
      const boundedContent = sourceContent.slice(0, remainingChars)
      const truncated = boundedContent.length < sourceContent.length ||
        (handoffOnly ? session.handoffTruncated : session.contentTruncated)
      matches.push({
        date: session.date,
        sessionId: session.sessionId,
        title: session.title,
        status: session.status,
        state: session.state,
        content: boundedContent,
        chars: boundedContent.length,
        truncated
      })
      remainingChars -= boundedContent.length
      if (truncated) {
        contentTruncated = true
        break
      }
    }
    const source = {
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      date,
      ...publicSourceMetadata(document)
    }
    const projection = {
      schemaVersion: 'MemorySessionQueryV1',
      query,
      matches,
      totalMatched: scannedDaily.matchedCount,
      truncated: !document.sourceScanComplete || scannedDaily.matchedCount > cursorState.offset + matches.length || contentTruncated,
      source,
      warnings: scannedDaily.warnings,
      indexReceipt: memoryIndexFallbackReceipt('daily', indexed),
      coverage: {
        status: document.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: document.continuation
      },
      ...memoryIndexProjectionState('daily', indexed, document),
      contextBinding
    }
    applyMemoryCursor(projection, {
      binding: cursorBinding,
      cursorState,
      returned: matches.length,
      hasMore: scannedDaily.matchedCount > cursorState.offset + matches.length
    })
    return withProjectionIdentity(projection, 'memory_session_query', target, [document], startedAt)
  })
}

function handleMemorySummaryQuery(args) {
  return runMemoryProjection(args, MEMORY_SUMMARY_QUERY_FIELDS, input => {
    const startedAt = process.hrtime.bigint()
    const target = resolveMemoryTarget(input)
    const contextBinding = resolveContextReadBinding(
      input.contextBinding,
      target,
      'memory:memory_summary_query'
    )
    const status = normalizeQueryStatus(input.status, 'active')
    const limit = normalizeBoundedInteger(input.limit, 5, 50, 'limit')
    if (input.since !== undefined && (
      typeof input.since !== 'string' || !input.since || input.since !== input.since.trim()
    )) {
      throw memoryQueryError('since must be a non-empty exact YYYY-MM-DD string when supplied.')
    }
    const since = input.since === undefined ? null : input.since
    if (since !== null) validateSince(since)
    const query = { status, limit, since }
    const cursorBinding = memoryCursorBinding('memory_summary_query', target, contextBinding, query)
    const cursorState = resolveMemoryCursor(input.cursor, cursorBinding)
    const summaryPath = memoryClientPath(target, 'SUMMARY.md')
    const indexed = querySummaryIndex(target, summaryPath, status, limit, since, cursorState.offset)
    if (indexed.status === 'fresh') {
      const source = {
        activeRoot: target.activeRoot,
        project: target.project,
        agent: target.agent,
        ...indexedSourceMetadata(indexed.source)
      }
      const projection = {
        schemaVersion: 'MemorySummaryQueryV1',
        query,
        rows: indexed.rows,
        totalMatched: indexed.totalMatched,
        truncated: indexed.envelope.truncated,
        source,
        warnings: indexed.warnings,
        indexReceipt: indexed.envelope.receipt,
        coverage: indexed.envelope.coverage,
        ...memoryIndexProjectionState('summary', indexed),
        contextBinding
      }
      applyMemoryCursor(projection, {
        binding: cursorBinding,
        cursorState,
        returned: indexed.rows.length,
        hasMore: Boolean(indexed.envelope.nextPointer)
      })
      return withProjectionIdentity(
        projection,
        'memory_summary_query',
        target,
        [],
        startedAt,
        indexed.envelope.telemetry
      )
    }
    const scannedSummary = scanSummaryDocument(summaryPath)
    const document = scannedSummary.document
    const filtered = rowsByCurrentState(scannedSummary.rows, status).filter(row => !since || row.day >= since)
    const rows = filtered.slice().reverse().slice(cursorState.offset, cursorState.offset + limit)
    const source = {
      activeRoot: target.activeRoot,
      project: target.project,
      agent: target.agent,
      ...publicSourceMetadata(document)
    }
    const projection = {
      schemaVersion: 'MemorySummaryQueryV1',
      query,
      rows,
      totalMatched: filtered.length,
      truncated: !document.sourceScanComplete || filtered.length > cursorState.offset + rows.length,
      source,
      warnings: scannedSummary.warnings,
      indexReceipt: memoryIndexFallbackReceipt('summary', indexed),
      coverage: {
        status: document.sourceScanComplete ? 'legacy-complete' : 'partial',
        reason: indexed.reason || 'index-fallback',
        continuation: document.continuation
      },
      ...memoryIndexProjectionState('summary', indexed, document),
      contextBinding
    }
    applyMemoryCursor(projection, {
      binding: cursorBinding,
      cursorState,
      returned: rows.length,
      hasMore: filtered.length > cursorState.offset + rows.length
    })
    return withProjectionIdentity(projection, 'memory_summary_query', target, [document], startedAt)
  })
}

function handleMemorySessionRead(args) {
  validateDate(args.date)
  const target = resolveMemoryTarget(args)
  resolveContextReadBinding(
    args.contextBinding,
    target,
    'memory:memory_session_query'
  )
  const p = memoryClientPath(target, 'tasks', `${args.date || today()}.md`)
  const document = readMemoryDocument(p)
  return { content: [{ type: 'text', text: document.content || '（文件不存在或为空）' }] }
}

function handleMemorySessionWrite(args) {
  validateMemoryWriterArgs(
    args,
    MEMORY_SESSION_WRITE_FIELDS,
    'memory_session_write',
    MEMORY_SESSION_WRITE_REQUIRED_FIELDS
  )
  if (typeof args.content !== 'string' || !args.content.length) {
    throw memoryQueryError(
      'content must be a non-empty string.',
      'Pass bounded Markdown content from the current task.',
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  validateDate(args.date)
  const target = resolveMemoryTarget(args)
  const binding = recoverMemorySessionWriteBinding(args, target)
  const p = memoryClientPath(target, 'tasks', `${args.date || today()}.md`)
  const documentPath = relativeToActiveRoot(target, p)
  let artifactLinks = null
  let renderedContent = args.content
  if (args.artifacts !== undefined) {
    artifactLinks = projectMemoryArtifactLinks(target, documentPath, args.artifacts, {
      surface: 'memory-session-artifacts'
    })
    renderedContent = joinMarkdownBlocks(renderedContent, renderArtifactLinkBlock(artifactLinks))
  }
  if (renderedContent.length > MAX_MEMORY_SESSION_WRITE_CHARS) {
    throw memoryQueryError(
      `content plus projected artifacts exceeds the ${MAX_MEMORY_SESSION_WRITE_CHARS}-character limit.`,
      'Split the memory update into bounded writes using the same allocation binding.',
      'MEMORY_WRITER_ARGUMENT_INVALID'
    )
  }
  const localLinkValidation = validateMarkdownLocalLinks({
    activeRoot: target.activeRoot,
    documentPath,
    markdown: renderedContent
  })
  const templateContext = createMemoryTemplateContext(target, memoryTemplateLogicalTarget('session', args))
  let sessionWriteReceipt = null
  templateContext.selectContent = content => boundMemoryTemplateContent(content, binding)
  templateContext.artifactScope = () => ({ kind: 'memory-session', sessionId: binding.sessionId })
  const receipt = withMemoryTransaction(target, p, existing => {
    const rendered = insertMemorySessionContent(existing, renderedContent, binding)
    sessionWriteReceipt = rendered.receipt
    return {
      content: rendered.content,
      appendText: rendered.content.startsWith(existing)
        ? rendered.content.slice(existing.length)
        : null
    }
  }, {
    reconcileIdentity: memoryOperationIdentity('session-write', target, {
      date: args.date || today(),
      sessionId: binding.sessionId,
      sessionBinding: binding.sessionBinding,
      contentDigest: crypto.createHash('sha256').update(renderedContent).digest('hex')
    }),
    templateContext
  })
  receipt.sessionWrite = sessionWriteReceipt
  receipt.indexReceipt = refreshDailyMemoryIndex(target, p, args.date || today())
  receipt.localLinkValidation = localLinkValidation
  if (artifactLinks) {
    receipt.artifactLinks = artifactLinks
    receipt.artifactLinkReadback = projectMemoryArtifactLinks(target, documentPath, args.artifacts, {
      operation: 'validate-existing',
      surface: 'memory-session-artifacts'
    })
  }
  return {
    content: [{
      type: 'text',
      text: `已追加到 ${relativeToActiveRoot(target, p)}\n${JSON.stringify(receipt)}`
    }],
    structuredContent: receipt
  }
}

function handleMemoryArtifactLinkProject(args) {
  validateMemoryWriterArgs(
    args,
    MEMORY_ARTIFACT_LINK_PROJECT_FIELDS,
    'memory_artifact_link_project',
    ['documentPath', 'artifacts', 'linkCapability']
  )
  const target = resolveMemoryTarget(args)
  const projection = projectMemoryArtifactLinks(target, args.documentPath, args.artifacts, {
    operation: args.operation || 'project',
    linkCapability: args.linkCapability,
    surface: 'memory-artifact-link-project'
  })
  return {
    content: [{ type: 'text', text: JSON.stringify(projection) }],
    structuredContent: projection
  }
}

function handleMemorySessionAllocate(args) {
  validateMemoryWriterArgs(args, MEMORY_SESSION_ALLOCATE_FIELDS, 'memory_session_allocate')
  validateDate(args.date)
  const input = { ...args, date: args.date || today() }
  const target = resolveMemoryTarget(input)
  const p = memoryClientPath(target, 'tasks', `${input.date}.md`)
  const templateContext = createMemoryTemplateContext(target, memoryTemplateLogicalTarget('session', args))
  let allocatedId = null
  let sessionBinding = crypto.randomBytes(32).toString('hex')
  let templateProduction = null
  templateContext.selectContent = content => boundMemoryTemplateContent(content, {
    sessionId: allocatedId, sessionBinding
  })
  templateContext.artifactScope = () => ({ kind: 'memory-session', sessionId: allocatedId })
  const ownerKey = currentMemorySessionOwnerKey(target)
  const receipt = withMemoryTransaction(target, p, existing => {
    const prior = ownerKey ? parseDailySessionBlocks(existing).filter(block => block.ownerKey === ownerKey && block.binding) : []
    if (prior.length === 1) {
      allocatedId = prior[0].sessionId
      sessionBinding = prior[0].binding
      return { content: existing, appendText: '' }
    }
    if (prior.length > 1) throw memoryQueryError('Multiple current memory sessions need reconciliation.',
      'Keep the content recoverable and continue the original task.', 'MEMORY_SESSION_AMBIGUOUS')
    const maxId = Math.max(0, ...parseExistingSessionNumbers(existing))
    allocatedId = formatSessionId(maxId + 1)
    const title = normalizeMemoryAllocationLine(input.title, '未命名任务', 'title', 160)
    let intent = normalizeMemoryAllocationLine(input.intent, 'unspecified', 'intent', 120)
    if (SUMMARY_TYPE_CANON) {
      const intentCheck = SUMMARY_TYPE_CANON.validateAllocateIntent(intent)
      if (!intentCheck.ok) {
        throw memoryQueryError(
          `Invalid allocate intent: ${intentCheck.message}`,
          'Use canonical workflow intents (dev|fix|analyze|audit|self-fix|chat|resume|other) joined by +, or unspecified.',
          intentCheck.errorCode || 'SUMMARY_TYPE_NON_CANONICAL'
        )
      }
      intent = intentCheck.normalized
    }
    const sourceMessage = normalizeMemoryAllocationLine(input.sourceMessage, '—', 'sourceMessage', 300)
    const rendered = renderArtifactTemplate({
      templateRef: 'content/prompts/memory-session.prompt.md', blockId: 'memory-session',
      producer: 'memory-session-allocate',
      values: {
        sessionId: allocatedId, title, timestamp: formatLocalDateTime(), intent, sourceMessage,
        bindingMarker: memorySessionBindingMarker(allocatedId, sessionBinding),
        ownerMarker: ownerKey ? `<!-- devcodex:memory-session-owner v1 key=${ownerKey} -->` : ''
      }
    })
    const block = rendered.content
    templateProduction = rendered.production
    const separator = existing ? '\n\n' : ''
    const appendText = separator + block
    return { content: existing + appendText, appendText }
  }, {
    reconcileIdentity: memoryOperationIdentity('session-allocate', target, {
      date: input.date,
      title: input.title || null,
      intent: input.intent || null,
      sourceMessage: input.sourceMessage || null,
      sessionBinding
    }),
    templateContext
  })
  receipt.indexReceipt = refreshDailyMemoryIndex(target, p, input.date)
  if (templateProduction) {
    receipt.templateProduction = templateProduction
    receipt.templateProductionScope = { kind: 'memory-session', sessionId: allocatedId }
    receipt.templateProductionReadback = templateProduction.artifactDigest === receipt.templateQualification.artifactDigest
      ? 'PASS' : 'UNVERIFIED'
  }
  const allocation = {
    schemaVersion: 'MemorySessionAllocationReceiptV1',
    sessionId: allocatedId,
    sessionBinding,
    sessionBindingSchemaVersion: 'MemorySessionBindingV1',
    transaction: receipt
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(allocation) }],
    structuredContent: allocation
  }
}

function cpAutoPortablePath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function cpAutoPathWithin(relativePath, prefix) {
  const candidate = cpAutoPortablePath(relativePath)
  const boundary = cpAutoPortablePath(prefix)
  return Boolean(candidate && boundary && (candidate === boundary || candidate.startsWith(`${boundary}/`)))
}

function readCpFormalTaskIdentity(taskDir) {
  const candidates = [
    path.join(taskDir, '.memory', 'task-identity-v2.json'),
    path.join(taskDir, '.memory', 'task.json')
  ]
  const identityPath = candidates.find(candidate => fs.existsSync(candidate))
  if (!identityPath) return null
  let resolved
  try {
    resolved = resolveExistingRegularFileInside(taskDir, path.relative(taskDir, identityPath), {
      fs,
      label: 'CP TaskIdentityV2'
    })
  } catch (error) {
    throw memoryQueryError(
      `CP TaskIdentityV2 is unsafe or unavailable: ${error.message}`,
      'Repair the canonical task identity before confirming the checkpoint.',
      'MEMORY_CP_TASK_IDENTITY_INVALID'
    )
  }
  const stat = fs.lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 256 * 1024) {
    throw memoryQueryError(
      'CP TaskIdentityV2 must be one bounded regular non-symlink file.',
      'Repair the canonical task identity before confirming the checkpoint.',
      'MEMORY_CP_TASK_IDENTITY_INVALID'
    )
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw memoryQueryError(
      `CP TaskIdentityV2 JSON is invalid: ${error.message}`,
      'Repair the canonical task identity before confirming the checkpoint.',
      'MEMORY_CP_TASK_IDENTITY_INVALID'
    )
  }
}

function currentCpArtifactDigest(sessionsPath, phase) {
  const current = readFile(sessionsPath)
  const row = parseCpTableRows(current)[phase]
  return row?.confirmed && /^[a-f0-9]{64}$/i.test(String(row.artifactSha256 || ''))
    ? String(row.artifactSha256).toLowerCase()
    : null
}

function prepareCpAutoCheckpointDecision({ args, target, sessionsPath, taskDir, artifactTargetPath, artifactSha256 }) {
  const identity = readCpFormalTaskIdentity(taskDir)
  if (!identity) {
    if (args.autoDecisionEvidence) {
      throw memoryQueryError(
        'autoDecisionEvidence cannot be used without one canonical formal TaskIdentityV2.',
        'Bind or admit the exact formal task first, then retry the CP confirmation.',
        'MEMORY_CP_AUTO_TASK_REQUIRED'
      )
    }
    return null
  }
  if (target.scope !== 'project' || !target.project) {
    throw memoryQueryError(
      'Task-scoped Auto CP confirmation requires one exact project namespace.',
      'Retry with scope:"project" and the canonical task project.',
      'MEMORY_CP_AUTO_PROJECT_REQUIRED'
    )
  }
  const taskId = String(identity.taskId || '').trim().toLowerCase()
  const recoveryIdentity = {
    activeRoot: target.activeRoot,
    project: target.project,
    taskId,
    taskStatus: 'active'
  }
  const metaDir = resolveTaskRecoveryMetaDir(recoveryIdentity)
  const recoveryRead = readTaskRecoveryState({ metaDir, identity: recoveryIdentity }, { fs })
  if (recoveryRead.status !== 'fresh' || !recoveryRead.state?.admissionTransaction) {
    if (args.autoDecisionEvidence) {
      throw memoryQueryError(
        'Task-scoped Auto state is unavailable for this formal task.',
        'Resume the exact formal task and current owner before retrying the CP confirmation.',
        recoveryRead.errorCode || 'MEMORY_CP_AUTO_STATE_UNAVAILABLE'
      )
    }
    return null
  }
  const transaction = recoveryRead.state.admissionTransaction
  const taskRootRelative = path.relative(target.activeRoot, taskDir).replace(/\\/g, '/')
  const portableBinding = evaluatePortableTaskIdentityBinding(identity, {
    taskId,
    project: target.project,
    taskKind: String(transaction.taskKind || ''),
    taskRootRelative,
    currentProjectRootIdentityDigest: transaction.projectRootIdentityDigest
  })
  if (identity.schemaVersion !== 'TaskIdentityV2' || !portableBinding.valid ||
      identity.identityDigest !== transaction.taskIdentityDigest ||
      transaction.taskRootRelative !== taskRootRelative) {
    throw memoryQueryError(
      'Task-scoped Auto CP confirmation does not match the canonical task identity/admission.',
      'Repair or resume the exact formal task binding before retrying.',
      'MEMORY_CP_AUTO_TASK_BINDING_MISMATCH'
    )
  }
  const grant = recoveryRead.state.taskScopedAutoContinuationGrant || null
  const grantValidation = validateTaskScopedAutoContinuationGrant(grant, {
    taskId,
    project: target.project,
    projectRootIdentityDigest: transaction.projectRootIdentityDigest
  })
  if (!grantValidation.valid || grant?.status !== 'active') {
    if (args.autoDecisionEvidence) {
      throw memoryQueryError(
        'autoDecisionEvidence was supplied but no active task-scoped Auto grant matches this task/root.',
        'Use a fresh explicit user Auto authorization, or confirm this checkpoint through the ordinary manual path.',
        'MEMORY_CP_AUTO_GRANT_UNAVAILABLE'
      )
    }
    return null
  }
  if (!args.autoDecisionEvidence) {
    throw memoryQueryError(
      'An active task-scoped Auto grant requires an independent AutoCheckpointDecisionV1 for this CP candidate.',
      'Pass autoDecisionEvidence with the current ReviewGradeCard, risk class, blockers and side-effect categories.',
      'MEMORY_CP_AUTO_DECISION_REQUIRED'
    )
  }
  const evidence = args.autoDecisionEvidence
  const artifactInScope = cpAutoPortablePath(grant.allowedScope.taskRootRelative) === cpAutoPortablePath(taskRootRelative) &&
    grant.allowedScope.pathPrefixes.some(prefix => cpAutoPathWithin(artifactTargetPath, prefix))
  const candidateScopeDigest = artifactInScope
    ? grant.allowedScope.scopeDigest
    : crypto.createHash('sha256').update(JSON.stringify({
        schemaVersion: 'ExpandedCpCandidateScopeV1',
        grantDigest: grant.grantDigest,
        artifactTargetPath
      })).digest('hex')
  const previousCandidateDigest = currentCpArtifactDigest(sessionsPath, args.phase)
  const decision = createAutoCheckpointDecision({
    grant,
    checkpoint: args.phase,
    previousCandidateDigest,
    newCandidateDigest: String(artifactSha256 || '').toLowerCase(),
    candidateScopeDigest,
    scopeDelta: artifactInScope ? 'none' : 'expanded',
    riskClass: evidence.riskClass,
    sideEffectCategories: evidence.sideEffectCategories || [],
    blockers: evidence.blockers || [],
    reviewGradeCard: evidence.reviewGradeCard
  })
  const commit = updateTaskRecoveryState({ metaDir, identity: recoveryIdentity }, state => {
    const currentGrant = state.taskScopedAutoContinuationGrant
    const currentGrantValidation = validateTaskScopedAutoContinuationGrant(currentGrant, {
      taskId,
      project: target.project,
      projectRootIdentityDigest: transaction.projectRootIdentityDigest
    })
    if (!currentGrantValidation.valid || currentGrant.status !== 'active' ||
        currentGrant.grantDigest !== grant.grantDigest) {
      throw memoryQueryError(
        'The task-scoped Auto grant changed before the CP decision could be committed.',
        'Re-read the current task grant and review the candidate again.',
        'MEMORY_CP_AUTO_GRANT_CAS_MISMATCH'
      )
    }
    const history = (Array.isArray(state.autoCheckpointDecisions) ? state.autoCheckpointDecisions : [])
      .filter(item => validateAutoCheckpointDecision(item).valid &&
        !(item.grantDigest === decision.grantDigest && item.checkpoint === decision.checkpoint))
    state.autoCheckpointDecision = decision
    state.autoCheckpointDecisions = [...history, decision].slice(-12)
    return state
  }, { fs, reason: 'auto-checkpoint-decision', force: true, touchSessionMapping: true })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    throw memoryQueryError(
      'AutoCheckpointDecisionV1 could not be persisted and read back.',
      'Repair the reported TaskRecovery state condition and retry; no CP confirmation was written.',
      commit.errorCode || 'MEMORY_CP_AUTO_DECISION_COMMIT_FAILED'
    )
  }
  const readback = readTaskRecoveryState({ metaDir, identity: recoveryIdentity }, { fs })
  const persistedDecision = readback.state?.autoCheckpointDecision
  const persistedValidation = validateAutoCheckpointDecision(persistedDecision, {
    grantDigest: grant.grantDigest,
    checkpoint: args.phase,
    newCandidateDigest: String(artifactSha256 || '').toLowerCase(),
    candidateScopeDigest
  })
  if (readback.status !== 'fresh' || !persistedValidation.valid ||
      persistedDecision.decisionDigest !== decision.decisionDigest) {
    throw memoryQueryError(
      'AutoCheckpointDecisionV1 readback did not match the current CP candidate.',
      'Re-read TaskRecovery and retry only after the decision lineage is stable.',
      'MEMORY_CP_AUTO_DECISION_READBACK_FAILED'
    )
  }
  if (decision.decision !== 'auto-pass') {
    throw memoryQueryError(
      `Task-scoped Auto cannot confirm ${args.phase}: ${decision.reasons.join(', ')}.`,
      'Resolve the reported scope/risk/review delta or obtain one fresh explicit confirmation for this candidate.',
      'MEMORY_CP_AUTO_RECONFIRM_REQUIRED'
    )
  }
  return {
    decision,
    stateSequence: readback.envelope?.sequence || null,
    stateDigest: readback.envelope?.payloadDigest || null
  }
}

function checkpointEpochIso(value, fallbackMs = Date.now()) {
  const parsed = Date.parse(String(value || ''))
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString()
}

function checkpointEpochRuntime() {
  return {
    stateSchemaVersion: 'TaskRecoveryStateV5',
    packageVersion: MEMORY_RUNTIME_IDENTITY.activeVersion,
    mcpProtocolVersion: '2024-11-05',
    sourceHead: MEMORY_RUNTIME_IDENTITY.generationId,
    epochCapability: 1
  }
}

function checkpointEpochAuthority(state) {
  const transaction = state.admissionTransaction || {}
  const owner = state.fencedWriteOwner || {}
  const canonical = state.taskCanonicalRevision || {}
  const context = state.contextAcquisition || {}
  return {
    taskKind: transaction.taskKind,
    project: transaction.project,
    activeRootDigest: transaction.projectRootIdentityDigest,
    admissionId: transaction.admissionId,
    owner: {
      ownerGeneration: owner.ownerGeneration,
      leaseRevision: owner.leaseRevision,
      leaseDigest: owner.leaseDigest
    },
    lineage: {
      canonicalRevision: canonical.revision,
      canonicalHeadDigest: canonical.currentOverviewDigest,
      canonicalParentRevision: canonical.revision > 1 ? canonical.revision - 1 : null,
      scopeDigest: transaction.workItemDigest
    },
    context: {
      contextEpoch: owner.contextEpoch || context.contextEpoch || null,
      planContentId: context.plan?.planContentId || context.binding?.planContentId ||
        context.planContentId || state.contextHandoffCard?.planContentId || null,
      autoGrantDigest: state.taskScopedAutoContinuationGrant?.grantDigest || null,
      autoDecisionDigest: state.autoCheckpointDecision?.decisionDigest || null,
      validationAuthorityDigest: state.validationExecution?.authorityDigest ||
        state.validationControl?.authorityDigest || null
    }
  }
}

function cpEpochRecoveryContext({ target, taskDir, identity, recoverOwner = true }) {
  if (!identity || identity.schemaVersion !== 'TaskIdentityV2') return null
  const taskId = String(identity.taskId || '').trim().toLowerCase()
  const recoveryIdentity = {
    activeRoot: target.activeRoot,
    project: target.project,
    taskId,
    taskStatus: 'active'
  }
  const metaDir = resolveTaskRecoveryMetaDir(recoveryIdentity)
  const recoveryRead = readTaskRecoveryState({ metaDir, identity: recoveryIdentity }, { fs })
  if (recoveryRead.status !== 'fresh') {
    throw memoryQueryError(
      'The formal task recovery state is unavailable for checkpoint mutation.',
      'Continue reading/analysis, then safely adopt the current task writer and retry this checkpoint.',
      recoveryRead.errorCode || 'MEMORY_CP_EPOCH_STATE_UNAVAILABLE'
    )
  }
  const state = recoveryRead.state || {}
  const transaction = state.admissionTransaction || {}
  // Admission itself still owns its legacy CP1 bootstrap until it reaches the
  // finalized formal-task boundary. Epoch mutation starts only after that
  // boundary; this preserves old admission callers without letting them
  // overwrite an already epoch-aware state.
  if (transaction.phase !== 'finalized' || transaction.status !== 'finalized') return null
  const taskRootRelative = path.relative(target.activeRoot, taskDir).replace(/\\/gu, '/')
  const portable = evaluatePortableTaskIdentityBinding(identity, {
    taskId,
    project: target.project,
    taskKind: transaction.taskKind,
    taskRootRelative,
    currentProjectRootIdentityDigest: transaction.projectRootIdentityDigest
  })
  if (!portable.valid || transaction.taskIdentityDigest !== identity.identityDigest ||
      transaction.taskRootRelative !== taskRootRelative) {
    throw memoryQueryError(
      'The checkpoint candidate is not bound to the current finalized task identity.',
      'Continue read-only and repair or resume the exact formal task binding before retrying.',
      'MEMORY_CP_EPOCH_TASK_BINDING_MISMATCH'
    )
  }
  const owner = state.fencedWriteOwner
  if (recoverOwner && owner?.taskId === taskId && owner.projectRootIdentity === transaction.projectRootIdentityDigest &&
      ((owner.status === 'active' && Date.parse(String(owner.expiresAt || '')) <= Date.now()) || owner.status === 'released')) {
    handleMemoryTaskWriteOwner({ scope: 'project', project: target.project,
      operation: owner.status === 'released' ? 'acquire' : 'renew', taskId, admissionId: transaction.admissionId,
      expectedOwner: { ownerGeneration: owner.ownerGeneration, ownerNonce: owner.ownerNonce,
        leaseRevision: owner.leaseRevision, leaseDigest: owner.leaseDigest } })
    return cpEpochRecoveryContext({ target, taskDir, identity, recoverOwner: false })
  }
  if (!owner || owner.status !== 'active' || Date.parse(String(owner.expiresAt || '')) <= Date.now() ||
      owner.taskId !== taskId || owner.projectRootIdentity !== transaction.projectRootIdentityDigest) {
    throw memoryQueryError(
      'The current task writer is absent, expired, or belongs to another lineage.',
      'Reading and analysis remain available; safely adopt the exact task writer before retrying this checkpoint.',
      'MEMORY_CP_EPOCH_OWNER_UNAVAILABLE'
    )
  }
  try {
    readFinalizedResumeCanonicalEvidence(transaction, target.activeRoot, fs, { state })
  } catch (error) {
    throw memoryQueryError(
      `The current canonical task lineage is not stable: ${error.message}`,
      'Continue read-only and repair the exact canonical/CP lineage before retrying this mutation.',
      error.code || 'MEMORY_CP_EPOCH_CANONICAL_INVALID'
    )
  }
  return { identity, recoveryIdentity, metaDir, recoveryRead, state, transaction, owner, taskId, taskRootRelative }
}

function checkpointPhaseBinding({ phase, artifactPath, artifactSha256, artifactVersion, templateQualificationDigest, sourceMessage, confirmedAt, autoCheckpoint }) {
  return sealCheckpointPhaseBinding({
    phase,
    role: 'primary',
    artifactPath,
    artifactSha256: String(artifactSha256 || '').toLowerCase(),
    artifactVersion,
    templateQualificationDigest: String(templateQualificationDigest || '').toLowerCase(),
    confirmationSourceDigest: crypto.createHash('sha256').update(String(sourceMessage || '')).digest('hex'),
    confirmedAt: checkpointEpochIso(confirmedAt),
    confirmationMode: autoCheckpoint ? 'task-scoped-auto' : 'explicit'
  })
}

function legacyCheckpointBinding(row, phase, fallbackMs) {
  if (!row?.confirmed || !/^[a-f0-9]{64}$/i.test(String(row.artifactSha256 || '')) ||
      !String(row.artifactPath || '').trim()) return null
  const normalized = {
    phase,
    role: 'primary',
    artifactPath: String(row.artifactPath).replace(/`/gu, ''),
    artifactSha256: String(row.artifactSha256).toLowerCase(),
    artifactVersion: String(row.artifactVersion || 'legacy'),
    templateQualificationDigest: checkpointDigestValue({
      schemaVersion: 'LegacyCheckpointQualificationRefV1',
      phase,
      artifactPath: row.artifactPath,
      artifactSha256: String(row.artifactSha256).toLowerCase()
    }),
    confirmationSourceDigest: crypto.createHash('sha256').update(String(row.sourceMessage || 'legacy-import')).digest('hex'),
    confirmedAt: checkpointEpochIso(row.confirmedAt, fallbackMs),
    confirmationMode: 'bootstrap-import'
  }
  return sealCheckpointPhaseBinding(normalized)
}

function legacyCheckpointSlot(parsed, phase, fallbackMs) {
  const binding = legacyCheckpointBinding(parsed[phase], phase, fallbackMs)
  return sealCheckpointPhaseSlot({
    phase,
    state: binding ? 'confirmed' : 'unstarted',
    currentBinding: binding,
    supplements: [],
    history: [],
    slotSequence: binding ? 1 : 0
  })
}

function legacyHistoricalEpoch(context, sessionsText, stageKey, nowMs) {
  const parsed = parseCpTableRows(sessionsText)
  const cp1 = legacyCheckpointBinding(parsed.CP1, 'CP1', nowMs)
  if (!cp1) return []
  const authority = checkpointEpochAuthority(context.state)
  const cp2 = legacyCheckpointSlot(parsed, 'CP2', nowMs)
  const cp3 = cp2.state === 'confirmed' ? legacyCheckpointSlot(parsed, 'CP3', nowMs) : legacyCheckpointSlot({}, 'CP3', nowMs)
  const legacyStageKey = `legacy-before-${stageKey}`
  const createdAt = cp1.confirmedAt
  return [sealTaskCheckpointEpoch({
    ordinal: 1,
    parentEpochId: null,
    stageKey: legacyStageKey,
    status: 'superseded',
    terminalStatus: null,
    task: {
      taskId: context.taskId,
      taskKind: context.transaction.taskKind,
      project: context.transaction.project,
      activeRootDigest: context.transaction.projectRootIdentityDigest,
      admissionId: context.transaction.admissionId
    },
    owner: authority.owner,
    lineage: authority.lineage,
    context: authority.context,
    phases: {
      CP1: sealCheckpointPhaseSlot({ phase: 'CP1', state: 'confirmed', currentBinding: cp1, supplements: [], history: [], slotSequence: 1 }),
      CP2: cp2,
      CP3: cp3
    },
    runtime: checkpointEpochRuntime(),
    createdAt,
    activatedAt: createdAt,
    supersededAt: checkpointEpochIso(null, nowMs),
    terminalAt: null,
    trigger: 'legacy-flat-cp-import'
  })]
}

function commitCheckpointEpochState(context, updater, reason) {
  const commit = updateTaskRecoveryState({
    metaDir: context.metaDir,
    identity: context.recoveryIdentity
  }, updater, { fs, reason, force: true, touchSessionMapping: true })
  if (!['committed', 'semantic-noop'].includes(commit.status)) {
    throw memoryQueryError(
      `Checkpoint epoch state did not commit: ${commit.errorCode || commit.status}.`,
      'The task remains readable; retry after the exact recovery-store condition is repaired.',
      commit.errorCode || 'MEMORY_CP_EPOCH_COMMIT_FAILED'
    )
  }
  const readback = readTaskRecoveryState({ metaDir: context.metaDir, identity: context.recoveryIdentity }, { fs })
  if (readback.status !== 'fresh') {
    throw memoryQueryError(
      'Checkpoint epoch state could not be read back after commit.',
      'The task remains readable; retry reconciliation before another checkpoint mutation.',
      readback.errorCode || 'MEMORY_CP_EPOCH_READBACK_FAILED'
    )
  }
  context.recoveryRead = readback
  context.state = readback.state
  return readback
}

function prepareCheckpointEpochOperation(context, input) {
  const state = context.state
  const existing = state.checkpointEpochOperation
  const prospective = createCheckpointEpochOperation({
    taskId: context.taskId,
    phase: input.phase,
    stageKey: input.stageKey,
    bindingDigest: input.binding.bindingDigest,
    expectedStateSequence: context.recoveryRead.envelope.sequence,
    expectedWriterGeneration: context.recoveryRead.envelope.writerGeneration,
    expectedOwnerLeaseDigest: context.owner.leaseDigest,
    confirmationMode: input.binding.confirmationMode
  })
  if (existing?.status === 'complete' && existing.requestDigest === prospective.requestDigest) {
    return context.recoveryRead
  }
  if (existing && existing.status !== 'complete') {
    if (existing.requestDigest === prospective.requestDigest) return context.recoveryRead
    throw memoryQueryError(
      'Another checkpoint operation must be reconciled before this candidate can start.',
      'Retry once; the server will finish the earlier machine/projection operation first.',
      'MEMORY_CP_EPOCH_RECONCILE_REQUIRED'
    )
  }
  return commitCheckpointEpochState(context, next => {
    let epochSet = next.taskCheckpointEpochSet || null
    let bootstrapAuthority = next.checkpointEpochBootstrapAuthority || null
    let targetEpochId = epochSet?.currentEpochId || null
    const authority = checkpointEpochAuthority(next)
    if (!epochSet) {
      const legacyRows = parseCpTableRows(input.sessionsText)
      const legacyCp1 = legacyCheckpointBinding(legacyRows.CP1, 'CP1', Date.now())
      if (input.phase !== 'CP1' && !legacyCp1) {
        throw memoryQueryError(
          'The first epoch-aware CP2/CP3 confirmation requires one verified legacy CP1.',
          'Confirm the current stage CP1 once; reading and analysis remain available.',
          'MEMORY_CP_EPOCH_CP1_BOOTSTRAP_REQUIRED'
        )
      }
      const targetCp1 = input.phase === 'CP1' ? input.binding : legacyCp1
      const historical = input.phase === 'CP1' && legacyCp1 &&
        legacyCp1.bindingDigest !== input.binding.bindingDigest
        ? legacyHistoricalEpoch(context, input.sessionsText, input.stageKey, Date.now())
        : []
      const ordinal = historical.length ? 2 : 1
      bootstrapAuthority = sealCheckpointEpochBootstrapAuthority({
        task: {
          taskId: context.taskId,
          taskKind: context.transaction.taskKind,
          project: context.transaction.project,
          activeRootDigest: context.transaction.projectRootIdentityDigest
        },
        target: {
          stageKey: input.stageKey,
          expectedOrdinal: ordinal,
          parentEpochId: historical[0]?.epochId || null
        },
        evidence: [targetCp1],
        runtime: checkpointEpochRuntime(),
        fence: {
          expectedStateSequence: context.recoveryRead.envelope.sequence,
          expectedWriterGeneration: context.recoveryRead.envelope.writerGeneration,
          expectedOwnerGeneration: context.owner.ownerGeneration
        },
        createdBy: 'workflow-single-writer'
      })
      const prepared = prepareTaskCheckpointEpochBootstrap({
        authority: bootstrapAuthority,
        historicalEpochs: historical,
        targetBinding: {
          admissionId: authority.admissionId,
          owner: authority.owner,
          lineage: authority.lineage,
          context: authority.context
        },
        legacyProjectionDigest: input.sessionsText ? fileDigest(input.sessionsText) : null
      })
      epochSet = prepared.epochSet
      targetEpochId = prepared.epochSet.epochs.find(item => item.status === 'preparing')?.epochId || null
      next.checkpointEpochBootstrapImport = input.phase === 'CP1'
        ? null
        : {
            schemaVersion: 'CheckpointEpochLegacyImportV1',
            CP2: legacyCheckpointBinding(legacyRows.CP2, 'CP2', Date.now()),
            CP3: legacyCheckpointBinding(legacyRows.CP3, 'CP3', Date.now())
          }
    } else {
      const current = epochSet.epochs.find(item => item.epochId === epochSet.currentEpochId)
      if (input.expectedEpochId && current?.epochId !== input.expectedEpochId) {
        throw memoryQueryError(
          'The requested checkpoint epoch is no longer current.',
          'Re-read the continuity view and retry against its current epoch.',
          'MEMORY_CP_EPOCH_CAS_MISMATCH'
        )
      }
      if (input.phase === 'CP1' && current?.phases?.CP1?.currentBinding?.bindingDigest !== input.binding.bindingDigest) {
        const prepared = prepareTaskCheckpointEpochSuccessor({
          epochSet,
          stageKey: input.stageKey,
          cp1Binding: input.binding,
          authority,
          runtime: checkpointEpochRuntime(),
          trigger: 'checkpoint-cp1-successor'
        })
        epochSet = prepared.epochSet
        targetEpochId = prepared.epoch.epochId
      }
    }
    next.taskCheckpointEpochSet = epochSet
    if (bootstrapAuthority) next.checkpointEpochBootstrapAuthority = bootstrapAuthority
    next.checkpointEpochCandidateBinding = {
      schemaVersion: 'CheckpointEpochCandidateBindingV1',
      binding: input.binding,
      sourceMessage: String(input.sourceMessage || '')
    }
    next.checkpointEpochOperation = sealCheckpointEpochOperation({ ...prospective, epochId: targetEpochId })
    delete next.checkpointEpochReceipt
    return next
  }, 'checkpoint-epoch-prepare')
}

function machineCommitCheckpointEpochOperation(context) {
  return commitCheckpointEpochState(context, next => {
    const operation = next.checkpointEpochOperation
    const candidate = next.checkpointEpochCandidateBinding
    if (!operation || operation.status !== 'prepared' || !candidate?.binding ||
        candidate.binding.bindingDigest !== operation.bindingDigest) {
      throw memoryQueryError(
        'Prepared checkpoint operation evidence is incomplete.',
        'Keep the task read-only and retry after repairing the bounded operation record.',
        'MEMORY_CP_EPOCH_PREPARE_INVALID'
      )
    }
    let epochSet = next.taskCheckpointEpochSet
    let epochId = operation.epochId
    if (epochSet.migration?.status === 'prepared' && next.checkpointEpochBootstrapAuthority) {
      const activated = activateTaskCheckpointEpochBootstrap({
        epochSet,
        authority: next.checkpointEpochBootstrapAuthority,
        observedEvidence: next.checkpointEpochBootstrapAuthority.evidence
      })
      epochSet = activated.epochSet
      next.checkpointEpochBootstrapAuthority = activated.authority
      epochId = epochSet.currentEpochId
      const legacyImport = next.checkpointEpochBootstrapImport
      if (legacyImport?.CP2 && operation.phase !== 'CP2') {
        epochSet = confirmTaskCheckpointPhase({
          epochSet,
          phase: 'CP2',
          expectedEpochId: epochId,
          binding: legacyImport.CP2
        }).epochSet
      }
      if (operation.phase !== 'CP1') {
        epochSet = confirmTaskCheckpointPhase({
          epochSet,
          phase: operation.phase,
          expectedEpochId: epochId,
          binding: candidate.binding
        }).epochSet
      }
      delete next.checkpointEpochBootstrapImport
    } else if (epochSet.epochs.some(item => item.status === 'preparing' && item.epochId === epochId)) {
      const activated = activateTaskCheckpointEpochSuccessor({ epochSet, epochId })
      epochSet = activated.epochSet
      epochId = activated.epoch.epochId
    } else {
      const confirmed = confirmTaskCheckpointPhase({
        epochSet,
        phase: operation.phase,
        expectedEpochId: operation.epochId || epochSet.currentEpochId,
        binding: candidate.binding
      })
      epochSet = confirmed.epochSet
      epochId = confirmed.epoch.epochId
    }
    next.taskCheckpointEpochSet = epochSet
    next.checkpointEpochOperation = advanceCheckpointEpochOperation(operation, 'machine-committed', {
      epochId,
      desiredProjectionDigest: checkpointEpochProjectionDigest(epochSet)
    })
    return next
  }, 'checkpoint-epoch-machine-commit')
}

function projectCheckpointEpochOperation(context, sessionsPath, templateContext, requirement) {
  const operation = context.state.checkpointEpochOperation
  const candidate = context.state.checkpointEpochCandidateBinding
  if (!operation || operation.status !== 'machine-committed' || !candidate?.binding) {
    throw memoryQueryError('Checkpoint projection has no machine-committed source.', null, 'MEMORY_CP_EPOCH_MACHINE_SOURCE_INVALID')
  }
  const transaction = withMemoryTransaction(context.target, sessionsPath, existing => {
    const rendered = renderTaskCheckpointProjection(existing, context.state.taskCheckpointEpochSet, {
      requirement,
      sourceMessagesByArtifactDigest: {
        [candidate.binding.artifactSha256]: candidate.sourceMessage
      }
    })
    return { content: rendered.content }
  }, {
    reconcileIdentity: memoryOperationIdentity('checkpoint-epoch-projection', context.target, {
      operationId: operation.operationId,
      desiredProjectionDigest: operation.desiredProjectionDigest
    }),
    templateContext
  })
  const persisted = readFile(sessionsPath)
  const marker = parseCurrentEpochMarker(persisted)
  if (!marker.found || marker.epochId !== operation.epochId ||
      marker.projectionDigest !== operation.desiredProjectionDigest) {
    throw memoryQueryError(
      'Checkpoint projection readback does not match the machine authority.',
      'The machine state remains authoritative; retry forward projection reconciliation.',
      'MEMORY_CP_EPOCH_PROJECTION_READBACK_FAILED'
    )
  }
  const observedDigest = fileDigest(persisted)
  commitCheckpointEpochState(context, next => {
    const current = next.checkpointEpochOperation
    if (current.operationId !== operation.operationId || current.status !== 'machine-committed') {
      throw memoryQueryError('Checkpoint operation changed during projection.', null, 'MEMORY_CP_EPOCH_PROJECTION_CAS_MISMATCH')
    }
    next.taskCheckpointEpochSet = finalizeTaskCheckpointProjection(next.taskCheckpointEpochSet, observedDigest)
    next.checkpointEpochOperation = advanceCheckpointEpochOperation(current, 'projection-committed', { observedProjectionDigest: observedDigest })
    next.checkpointEpochProjectionTransaction = {
      schemaVersion: 'MemoryCpProjectionTransactionRefV1',
      operationId: operation.operationId,
      transactionDigest: transaction.transactionDigest || transaction.operationDigest || fileDigest(JSON.stringify(transaction)),
      observedDigest
    }
    return next
  }, 'checkpoint-epoch-projection-commit')
}

function completeCheckpointEpochOperation(context) {
  commitCheckpointEpochState(context, next => {
    const operation = next.checkpointEpochOperation
    if (!operation || operation.status !== 'projection-committed') {
      throw memoryQueryError('Checkpoint operation cannot finalize from its current state.', null, 'MEMORY_CP_EPOCH_FINALIZE_INVALID')
    }
    next.checkpointEpochOperation = advanceCheckpointEpochOperation(operation, 'complete')
    delete next.checkpointEpochCandidateBinding
    return next
  }, 'checkpoint-epoch-finalize')
  return createCheckpointEpochReceipt({
    operation: context.state.checkpointEpochOperation,
    epochSet: context.state.taskCheckpointEpochSet
  })
}

function reconcileCheckpointEpochOperation(context, sessionsPath, templateContext, requirement) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const operation = context.state.checkpointEpochOperation
    if (!operation || operation.status === 'complete') {
      return operation?.status === 'complete'
        ? createCheckpointEpochReceipt({ operation, epochSet: context.state.taskCheckpointEpochSet })
        : null
    }
    if (operation.status === 'prepared') {
      machineCommitCheckpointEpochOperation(context)
      continue
    }
    if (operation.status === 'machine-committed') {
      projectCheckpointEpochOperation(context, sessionsPath, templateContext, requirement)
      continue
    }
    if (operation.status === 'projection-committed') return completeCheckpointEpochOperation(context)
    throw memoryQueryError(
      `Unsupported checkpoint operation state: ${operation.status}.`,
      'Keep the task read-only and upgrade or repair the epoch-capable runtime.',
      'MEMORY_CP_EPOCH_OPERATION_UNSUPPORTED'
    )
  }
  throw memoryQueryError('Checkpoint reconciliation exceeded its bounded transition budget.', null, 'MEMORY_CP_EPOCH_RECONCILE_EXCEEDED')
}

function handleMemoryCpConfirm(args) {
  if (!args.requirement) throw new Error('requirement is required')
  if (!args.phase) throw new Error('phase is required')
  const kind = args.kind || 'requirements'
  if (!TASK_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...TASK_KINDS].join(', ')}`)

  const p = taskSessionsPath(kind, args.requirement, args)
  const target = taskMemoryTransactionTarget(args)
  const templateContext = createMemoryTemplateContext(target, memoryTemplateLogicalTarget('task', args))
  const time = args.time || currentTime()
  const hasDigest = Boolean(args.artifactPath || args.artifactSha256 || args.artifactVersion)
  if (hasDigest && (!args.artifactPath || !args.artifactSha256)) {
    throw new Error('ConfirmBindingGate: artifactPath and artifactSha256 are required together')
  }
  if (!hasDigest) {
    throw memoryQueryError(
      'CP confirmation is unbound and cannot be recorded as authoritative.',
      'Pass the canonical artifactPath, its current SHA-256, artifactVersion, and the exact confirmation sourceMessage.',
      'MEMORY_CP_CONFIRMATION_UNBOUND'
    )
  }
  const sha = args.artifactSha256 ? String(args.artifactSha256).replace(/`/g, '').toUpperCase() : null
  let artifactPath = args.artifactPath ? String(args.artifactPath).replace(/\\/g, '/') : null
  const artifactVersion = args.artifactVersion || '—'
  const sourceMessage = args.sourceMessage || '—'
  let artifactAuthority = null
  let artifactTargetPath = null
  let artifactLinks = null
  let artifactTemplate = null
  let autoCheckpoint = null

  if (hasDigest && artifactPath) {
    const taskDir = path.dirname(path.dirname(p)) // .../<task>/.memory/sessions.md
    let candidate
    try {
      candidate = resolveExistingRegularFileInside(taskDir, artifactPath, { label: 'artifactPath' })
    } catch (error) {
      throw new Error(`ConfirmBindingGate: invalid artifactPath ${artifactPath}: ${error.message}`)
    }
    const descriptor = fs.openSync(candidate, 'r')
    let actual
    try {
      const descriptorStat = fstatSnapshot(fs, descriptor)
      if (!descriptorStat.isFile()) {
        throw new Error(`ConfirmBindingGate: artifactPath is not a regular file: ${artifactPath}`)
      }
      const canonicalRoot = fs.realpathSync.native
        ? fs.realpathSync.native(taskDir)
        : fs.realpathSync(taskDir)
      const verifyCurrentPathIdentity = () => {
        const currentPath = fs.realpathSync.native
          ? fs.realpathSync.native(candidate)
          : fs.realpathSync(candidate)
        const relative = path.relative(canonicalRoot, currentPath)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error(`ConfirmBindingGate: artifactPath escaped its task root during verification: ${artifactPath}`)
        }
        const currentStat = filePathSnapshot(fs, currentPath)
        if (!currentStat.isFile() || String(currentStat.dev) !== String(descriptorStat.dev) ||
            String(currentStat.ino) !== String(descriptorStat.ino)) {
          throw new Error(`ConfirmBindingGate: artifactPath identity changed during verification: ${artifactPath}`)
        }
        return { currentPath, relative: relative.replace(/\\/g, '/') }
      }
      const beforeRead = verifyCurrentPathIdentity()
      actual = crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex').toUpperCase()
      const afterRead = verifyCurrentPathIdentity()
      if (beforeRead.currentPath !== afterRead.currentPath || beforeRead.relative !== afterRead.relative) {
        throw new Error(`ConfirmBindingGate: artifactPath changed during verification: ${artifactPath}`)
      }
      artifactPath = afterRead.relative
      artifactTargetPath = relativeExistingToActiveRoot(target, afterRead.currentPath)
      const rootStat = fs.statSync(canonicalRoot)
      artifactAuthority = {
        schemaVersion: 'MemoryCpArtifactAuthorityV1',
        rootKind: 'task',
        canonicalRoot,
        canonicalRelativePath: artifactPath,
        rootIdentity: crypto.createHash('sha256')
          .update(`${canonicalRoot.replace(/\\/g, '/')}\0${rootStat.dev}\0${rootStat.ino}`)
          .digest('hex')
      }
    } finally {
      fs.closeSync(descriptor)
    }
    if (actual !== sha) {
      throw new Error(
        `ConfirmBindingGate: artifactSha256 mismatch for ${artifactPath} (disk=${actual}). ` +
        'Re-hash the file on disk AFTER the last edit (sha256 of current bytes), then call memory_cp_confirm again. ' +
        'Do not reuse a hash computed before subsequent writes.'
      )
    }
    artifactTemplate = qualifyCpConfirmationArtifact({
      target,
      taskKind: kind,
      phase: args.phase,
      candidate,
      artifactTargetPath
    })
    if (String(artifactTemplate.qualification.artifactDigest || '').toUpperCase() !== sha) {
      throw memoryQueryError(
        `CP artifact changed between digest verification and template qualification: ${artifactPath}.`,
        'Re-hash the stable candidate after its final edit and retry once.',
        'MEMORY_CP_ARTIFACT_QUALIFICATION_DIGEST_MISMATCH'
      )
    }
    artifactLinks = projectMemoryArtifactLinks(target, relativeToActiveRoot(target, p), [{
      id: `cp-${String(args.phase).toLowerCase()}-artifact`,
      label: artifactPath,
      targetPath: artifactTargetPath,
      purpose: `${args.phase} confirmation artifact`
    }], { surface: 'memory-cp-confirmation' })
  }

  if (hasDigest) {
    const taskDir = path.dirname(path.dirname(p))
    const predecessor = args.phase === 'CP2' ? 'CP1' : (args.phase === 'CP3' ? 'CP2' : null)
    if (predecessor && readCpFormalTaskIdentity(taskDir)?.schemaVersion === 'TaskIdentityV2' &&
        !parseCpTableRows(readFile(p))[predecessor]?.confirmed) {
      throw memoryQueryError(`Confirmed ${args.phase} requires confirmed ${predecessor}.`,
        'Persist the already-authorized predecessor first, then continue this checkpoint.',
        'CHECKPOINT_EPOCH_CP_PREDECESSOR_MISSING')
    }
    autoCheckpoint = prepareCpAutoCheckpointDecision({
      args,
      target,
      sessionsPath: p,
      taskDir,
      artifactTargetPath,
      artifactSha256: sha
    })
  }

  const taskDir = path.dirname(path.dirname(p))
  const formalIdentity = readCpFormalTaskIdentity(taskDir)
  if (formalIdentity?.schemaVersion === 'TaskIdentityV2') {
    const epochContext = cpEpochRecoveryContext({ target, taskDir, identity: formalIdentity })
    if (epochContext) epochContext.target = target
    if (epochContext) {
    if (epochContext.state.checkpointEpochOperation &&
        epochContext.state.checkpointEpochOperation.status !== 'complete') {
      reconcileCheckpointEpochOperation(epochContext, p, templateContext, args.requirement)
    }
    const currentEpoch = epochContext.state.taskCheckpointEpochSet?.epochs?.find(
      item => item.epochId === epochContext.state.taskCheckpointEpochSet?.currentEpochId
    ) || null
    const stageKey = normalizeStageKey(
      args.stageKey || (args.phase === 'CP1' ? artifactVersion : currentEpoch?.stageKey) || artifactVersion || args.phase
    )
    const epochBinding = checkpointPhaseBinding({
      phase: args.phase,
      artifactPath,
      artifactSha256: sha,
      artifactVersion,
      templateQualificationDigest: artifactTemplate.qualification.qualificationDigest,
      sourceMessage,
      confirmedAt: time,
      autoCheckpoint
    })
    prepareCheckpointEpochOperation(epochContext, {
      phase: args.phase,
      stageKey,
      expectedEpochId: args.expectedEpochId || null,
      binding: epochBinding,
      sourceMessage,
      sessionsText: readFile(p)
    })
    const epochReceipt = reconcileCheckpointEpochOperation(epochContext, p, templateContext, args.requirement)
    const persisted = readFile(p)
    assertNoCpRowsOutsideDedicatedBlock(persisted)
    const block = locateCpTableBlock(persisted)
    const blockText = block.found ? block.lines.slice(block.start, block.end).join('\n') : ''
    const parsed = parseCpTableRows(blockText)
    const phaseRow = parsed[args.phase]
    const cpRowCount = (blockText.match(/^\|\s*CP[123]\s*\|/gm) || []).length
    const marker = parseCurrentEpochMarker(persisted)
    if (!block.found || block.incomplete || cpRowCount !== 3 || !phaseRow?.confirmed ||
        String(phaseRow.artifactPath || '').replace(/`/gu, '') !== artifactPath ||
        phaseRow.artifactSha256 !== sha || !marker.found || marker.epochId !== epochReceipt.epochId ||
        marker.projectionDigest !== epochReceipt.projection.desiredDigest) {
      throw memoryQueryError(
        'The finalized checkpoint projection failed its current-epoch readback.',
        'The machine checkpoint remains authoritative; retry forward reconciliation.',
        'MEMORY_CP_EPOCH_FINAL_READBACK_FAILED'
      )
    }
    const confirmation = {
      schemaVersion: 'MemoryCpConfirmationReceiptV2',
      phase: args.phase,
      status: 'confirmed',
      digestBound: true,
      artifactPath,
      artifactSha256: sha,
      artifactAuthority,
      artifactSlot: artifactTemplate.slot,
      artifactTemplateBinding: artifactTemplate.binding,
      artifactTemplateQualification: artifactTemplate.qualification,
      artifactLinks,
      artifactLinkReadback: projectMemoryArtifactLinks(target, relativeToActiveRoot(target, p), [{
        id: `cp-${String(args.phase).toLowerCase()}-artifact`,
        label: artifactPath,
        targetPath: artifactTargetPath,
        purpose: `${args.phase} confirmation artifact`
      }], { operation: 'validate-existing', surface: 'memory-cp-confirmation' }),
      autoCheckpointDecision: autoCheckpoint?.decision || null,
      autoCheckpointState: autoCheckpoint
        ? { stateSequence: autoCheckpoint.stateSequence, stateDigest: autoCheckpoint.stateDigest, readbackVerified: true }
        : null,
      checkpointEpoch: epochReceipt,
      confirmedAt: time,
      cpRowCount,
      readbackVerified: true,
      mutationAuthority: false
    }
    return {
      content: [{
        type: 'text',
        text: `已确认 ${args.phase}，当前任务代际 ${epochReceipt.epochId} 已完成机器状态、会话投影与读回对账。`
      }],
      structuredContent: confirmation
    }
    }
  }

  const transaction = withMemoryTransaction(target, p, existing => {
    if (autoCheckpoint) {
      const current = parseCpTableRows(existing)[args.phase]
      const currentDigest = current?.confirmed && /^[a-f0-9]{64}$/i.test(String(current.artifactSha256 || ''))
        ? String(current.artifactSha256).toLowerCase()
        : null
      const expectedPrior = autoCheckpoint.decision.previousCandidateDigest
      const nextDigest = autoCheckpoint.decision.newCandidateDigest
      if (currentDigest !== expectedPrior && currentDigest !== nextDigest) {
        throw memoryQueryError(
          'The CP row changed after AutoCheckpointDecisionV1 was frozen.',
          'Re-read the current CP artifact/row and generate a new decision before retrying.',
          'MEMORY_CP_AUTO_DECISION_CP_CAS_MISMATCH'
        )
      }
    }
    return renderCpConfirmation(existing, args, {
      hasDigest,
      sha,
      artifactPath,
      artifactVersion,
      sourceMessage,
      artifactLink: artifactLinks?.links?.[0]?.markdown || null,
      time
    })
  }, {
    reconcileIdentity: memoryOperationIdentity('cp-confirm', target, {
      kind,
      requirement: args.requirement,
      phase: args.phase,
      artifactPath,
      artifactSha256: sha,
      artifactVersion,
      sourceMessage,
      artifactTemplateQualificationDigest: artifactTemplate?.qualification?.qualificationDigest || null,
      autoCheckpointDecisionDigest: autoCheckpoint?.decision.decisionDigest || null,
      time
    }),
    templateContext
  })
  const persisted = readFile(p)
  assertNoCpRowsOutsideDedicatedBlock(persisted)
  const block = locateCpTableBlock(persisted)
  const blockText = block.found ? block.lines.slice(block.start, block.end).join('\n') : ''
  const parsed = parseCpTableRows(blockText)
  const phaseRow = parsed[args.phase]
  const cpRowCount = (blockText.match(/^\|\s*CP[123]\s*\|/gm) || []).length
  if (!block.found || block.incomplete ||
      !EXTENDED_CP_TABLE_HEADER_RE.test(blockText.split('\n').find(line => EXTENDED_CP_TABLE_HEADER_RE.test(line.trim())) || '') ||
      cpRowCount !== 3 || !phaseRow?.confirmed) {
    throw new Error('ConfirmBindingGate: CP confirmation readback is incomplete or malformed')
  }
  if (hasDigest) {
    const persistedPath = String(phaseRow.artifactPath || '').replace(/`/g, '')
    if (persistedPath !== artifactPath || phaseRow.artifactSha256 !== sha) {
      throw new Error('ConfirmBindingGate: CP confirmation readback does not match artifact binding')
    }
  }
  const confirmation = {
    schemaVersion: 'MemoryCpConfirmationReceiptV1',
    phase: args.phase,
    status: 'confirmed',
    digestBound: hasDigest,
    artifactPath,
    artifactSha256: sha,
    artifactAuthority,
    artifactSlot: artifactTemplate?.slot || null,
    artifactTemplateBinding: artifactTemplate?.binding || null,
    artifactTemplateQualification: artifactTemplate?.qualification || null,
    artifactLinks,
    artifactLinkReadback: artifactLinks
      ? projectMemoryArtifactLinks(target, relativeToActiveRoot(target, p), [{
          id: `cp-${String(args.phase).toLowerCase()}-artifact`,
          label: artifactPath,
          targetPath: artifactTargetPath,
          purpose: `${args.phase} confirmation artifact`
        }], { operation: 'validate-existing', surface: 'memory-cp-confirmation' })
      : null,
    autoCheckpointDecision: autoCheckpoint?.decision || null,
    autoCheckpointState: autoCheckpoint
      ? {
          stateSequence: autoCheckpoint.stateSequence,
          stateDigest: autoCheckpoint.stateDigest,
          readbackVerified: true
        }
      : null,
    confirmedAt: time,
    cpRowCount,
    readbackVerified: true,
    transaction
  }
  return {
    content: [{ type: 'text', text: `已在 sessions.md 记录 ${args.phase} ✅ (${time})${hasDigest ? ' digest-bound' : ''}\n${JSON.stringify(confirmation)}` }],
    structuredContent: confirmation
  }
}

function handleMemorySummaryRead(args) {
  const target = resolveMemoryTarget(args)
  resolveContextReadBinding(
    args.contextBinding,
    target,
    'memory:memory_summary_query'
  )
  const p = memoryClientPath(target, 'SUMMARY.md')
  const document = readMemoryDocument(p)
  return { content: [{ type: 'text', text: document.content || '（SUMMARY.md 不存在或为空）' }] }
}

function handleMemorySummaryAppend(args) {
  validateMemoryWriterArgs(args, MEMORY_SUMMARY_APPEND_FIELDS, 'memory_summary_append')
  let rowProduction = null
  let headerProduction = null
  if (args.entry && args.row) throw memoryQueryError('Pass either a structured entry or a legacy row, not both.')
  if (args.entry) {
    const entry = args.entry
    if (!entry || typeof entry !== 'object' || typeof entry.summary !== 'string' || !entry.summary.trim() ||
        !['active', 'completed', 'blocked'].includes(entry.status)) throw memoryQueryError('A summary and actual status are required.')
    const target = resolveMemoryTarget(args)
    let type = entry.type
    if (!type) {
      try { type = readServerOwnedLifecycleProjection(target).state.workflowRouteDecision?.topIntent } catch { }
    }
    if (!type) throw memoryQueryError('The workflow type is not observed; supply entry.type without inventing a default.')
    const date = String(entry.date || today()).replace(/-/g, '')
    validateDate(date)
    const sessionId = entry.sessionId || recoverMemorySessionWriteBinding({ ...args, date }, target).sessionId
    const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    const rendered = renderSummaryRow([day, sessionId, type, entry.summary, '—', '—', entry.status])
    rowProduction = rendered.production
    args = { ...args, row: rendered.content.trimEnd() }
  }
  if (!args.row) throw new Error('row is required')
  if (typeof args.row !== 'string' || args.row !== args.row.trim() || /[\r\n]/.test(args.row)) {
    throw memoryQueryError('Invalid SUMMARY row: pass one trimmed Markdown table row.')
  }
  const cells = splitMarkdownRow(args.row)
  if (cells.length !== 7) {
    throw memoryQueryError('Invalid SUMMARY row: exactly seven columns are required; escape literal pipes as \\|.')
  }
  const day = String(cells[0] || '').slice(0, 10)
  validateSince(day)
  if (!/^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(cells[0])) {
    throw memoryQueryError('Invalid SUMMARY date: use YYYY-MM-DD or YYYY-MM-DD HH:mm.')
  }
  if (!normalizeSessionId(cells[1])) {
    throw memoryQueryError('Invalid SUMMARY row: session is required.')
  }
  if (!String(cells[2] || '').trim() || !String(cells[3] || '').trim()) {
    throw memoryQueryError('Invalid SUMMARY row: type and summary are required.')
  }
  // SummaryTypeCanonGate：类型列仅允许 canonical 工作流意图（+ 连接）
  let normalizedType = String(cells[2] || '').trim()
  if (SUMMARY_TYPE_CANON) {
    const typeCheck = SUMMARY_TYPE_CANON.validateSummaryType(normalizedType)
    if (!typeCheck.ok) {
      throw memoryQueryError(
        `Invalid SUMMARY type: ${typeCheck.message}`,
        'Allowed: dev|fix|analyze|audit|self-fix|chat|resume|other joined by + only (no slash/free labels).',
        typeCheck.errorCode || 'SUMMARY_TYPE_NON_CANONICAL'
      )
    }
    normalizedType = typeCheck.normalized
  }
  if (normalizedMemoryState(cells[6]) === 'unknown') {
    throw memoryQueryError('Invalid SUMMARY row: status must map to active, completed, or blocked.')
  }
  const target = resolveMemoryTarget(args)
  const p = memoryClientPath(target, 'SUMMARY.md')
  const documentPath = relativeToActiveRoot(target, p)
  const reportArtifact = summaryArtifactDescriptor(args.reportArtifact, 'summary-report')
  const memoryArtifact = summaryArtifactDescriptor(args.memoryArtifact, 'summary-memory')
  const artifactInputs = [reportArtifact, memoryArtifact].filter(Boolean)
  let artifactLinks = null
  if (artifactInputs.length) {
    artifactLinks = projectMemoryArtifactLinks(target, documentPath, artifactInputs, {
      surface: 'memory-summary-artifacts'
    })
    const projectedById = new Map(artifactLinks.links.map(link => [link.id, link.markdown]))
    cells[4] = reportArtifact ? (projectedById.get(reportArtifact.id) || '—') : cells[4]
    cells[5] = memoryArtifact ? (projectedById.get(memoryArtifact.id) || '—') : cells[5]
  }
  // Preserve the legacy row byte shape when no normalization or structured projection is needed.
  let finalRow = args.row
  if (String(cells[2] || '').trim() !== normalizedType || artifactInputs.length) {
    const rendered = renderSummaryRow(cells.map((cell, index) => index === 2 ? normalizedType : cell))
    finalRow = rendered.content.trimEnd()
    rowProduction = rendered.production
  }
  const localLinkValidation = validateMarkdownLocalLinks({
    activeRoot: target.activeRoot,
    documentPath,
    markdown: finalRow
  })
  const templateContext = createMemoryTemplateContext(target, memoryTemplateLogicalTarget('summary', args))
  const receipt = withMemoryTransaction(target, p, existing => {
    const header = existing ? null : summaryHeader(args.agent || target.agent, args)
    headerProduction = header?.production || null
    const appendText = (header?.content || '') + finalRow + '\n'
    return { content: existing + appendText, appendText }
  }, {
    reconcileIdentity: memoryOperationIdentity('summary-append', target, { row: finalRow }),
    templateContext
  })
  receipt.indexReceipt = refreshSummaryMemoryIndex(target, p)
  receipt.templateProductions = [headerProduction, rowProduction].filter(Boolean)
  receipt.rowProductionMode = rowProduction ? 'template-rendered' : 'legacy-caller-row'
  const parsed = parseSummaryRows(readFile(p))
  const appended = parsed.rows[parsed.rows.length - 1]
  if (!appended || appended.day !== day || appended.sessionId !== normalizeSessionId(cells[1])) {
    throw memoryQueryError(
      'SUMMARY write completed but readback did not reproduce the appended row.',
      'Inspect SUMMARY.md and retry after repairing the writer-reader contract.',
      'MEMORY_SUMMARY_READBACK_FAILED'
    )
  }
  receipt.summaryEvent = {
    schemaVersion: 'MemorySummaryEventReceiptV1',
    semantics: 'append-only-last-event-wins',
    sessionKey: `${appended.day}#${appended.sessionId}`,
    currentState: appended.state,
    rowNumber: appended.rowNumber
  }
  receipt.localLinkValidation = localLinkValidation
  if (artifactLinks) {
    receipt.artifactLinks = artifactLinks
    receipt.artifactLinkReadback = projectMemoryArtifactLinks(target, documentPath, artifactInputs, {
      operation: 'validate-existing',
      surface: 'memory-summary-artifacts'
    })
  }
  return {
    content: [{ type: 'text', text: `已追加到 SUMMARY.md\n${JSON.stringify(receipt)}` }],
    structuredContent: receipt
  }
}

function handleMemoryTaskResolve(args) {
  if (!String(args.name || '').trim()) throw new TaskContinuationError('TASK_NAME_REQUIRED', 'name is required')
  const resolution = resolveTaskContinuation({
    cwd: INPUT_ROOT,
    name: args.name,
    project: args.project || '',
    scope: args.scope || 'auto',
    persistIndex: args.persistIndex !== false
  })
  const candidates = resolution.candidates || resolution.suggestions || []
  const languageEvidence = `${String(args.name || '')}${String(resolution.candidate?.displayName || '')}${candidates.map(item => item.displayName || '').join('')}`
  const chinese = /[\u3400-\u9fff]/u.test(languageEvidence)
  let humanText
  if (resolution.status === 'resolved-active') {
    humanText = chinese
      ? `已唯一定位任务：${resolution.candidate.project}/${resolution.candidate.kind}/${resolution.candidate.displayName}。本结果只负责定位，不授予写权；写入前仍须验证当前 canonical/owner。`
      : `Uniquely located task: ${resolution.candidate.project}/${resolution.candidate.kind}/${resolution.candidate.displayName}. This result locates only and grants no write authority; verify current canonical/owner evidence before mutation.`
  } else if (resolution.status === 'ambiguous') {
    humanText = chinese
      ? `存在 ${candidates.length} 个任务候选，未自动猜选。当前分析可继续；写入既有任务前必须完成唯一消歧。`
      : `${candidates.length} task candidates remain; none was guessed. Analysis may continue, but an existing task must be uniquely disambiguated before mutation.`
  } else if (resolution.status === 'not-found') {
    humanText = chinese
      ? '未找到精确任务候选。当前分析可继续，也可走普通新任务准入；不得把记忆或报告提示直接当成既有任务写权。'
      : 'No exact task candidate was found. Analysis may continue or use normal new-task admission; memory/report hints do not grant existing-task write authority.'
  } else {
    humanText = chinese
      ? '已找到任务线索，但当前 canonical 证据未通过。当前分析可继续；在复证前不得写入该既有任务。'
      : 'A task hint was found, but current canonical evidence did not verify. Analysis may continue; do not mutate the existing task before re-verification.'
  }
  const continuationDisposition = resolution.status === 'resolved-active'
    ? 'resolved-readonly'
    : 'provisional-continue'
  const protocolLine = `TaskResolutionV1 status=${resolution.status}; continuation=${continuationDisposition}; mutationAuthority=false${resolution.errorCode ? `; errorCode=${resolution.errorCode}` : ''}`
  const response = {
    humanSummary: humanText,
    protocolSummary: protocolLine,
    continuationAllowed: true,
    continuationDisposition,
    ...resolution
  }
  return {
    content: [{ type: 'text', text: `${humanText}\n${protocolLine}` }],
    structuredContent: response,
    isError: false
  }
}

function provisionalTaskResolution(error, selector, project) {
  return {
    schemaVersion: 'TaskResolutionV1',
    status: 'not-found',
    errorCode: error?.code || 'TASK_CONTINUITY_SOURCE_UNAVAILABLE',
    message: error?.message || 'bounded task continuity sources are unavailable',
    displayQuery: String(selector || ''),
    project: String(project || ''),
    candidates: [],
    suggestions: [],
    mutationAuthority: false
  }
}

function handleMemoryTaskContinuityViewV1(args) {
  const selector = String(args.taskId || args.name || '').trim()
  let resolution
  try {
    resolution = selector
      ? resolveTaskContinuation({
          cwd: INPUT_ROOT,
          name: selector,
          project: args.project || '',
          scope: args.scope || 'auto',
          persistIndex: false
        })
      : resolveUniqueActiveTaskContinuation({
          cwd: INPUT_ROOT,
          project: args.project || '',
          scope: args.scope || 'auto'
        })
  } catch (error) {
    resolution = provisionalTaskResolution(error, selector, args.project)
  }

  const candidate = resolution.status === 'resolved-active' ? resolution.candidate : null
  const candidateProject = candidate?.project || args.project || ''
  let target = null
  let recoveryRead = { status: 'missing', errorCode: 'TASK_RECOVERY_STATE_UNAVAILABLE' }
  let projectionMarker = { found: false, epochId: null, projectionDigest: null }
  let canonicalEvidence = null
  if (candidate?.taskId && candidateProject) {
    try {
      target = taskMemoryTransactionTarget({ project: candidateProject, scope: 'project' })
      const identity = {
        activeRoot: target.activeRoot,
        project: target.project,
        taskId: candidate.taskId,
        taskStatus: 'active'
      }
      const metaDir = resolveTaskRecoveryMetaDir(identity)
      recoveryRead = readTaskRecoveryState({ metaDir, identity }, { fs })
      const sessionsPath = path.join(candidate.taskRoot, '.memory', 'sessions.md')
      projectionMarker = parseCurrentEpochMarker(readFile(sessionsPath))
      if (recoveryRead.status === 'fresh' && recoveryRead.state?.admissionTransaction) {
        try {
          canonicalEvidence = readFinalizedResumeCanonicalEvidence(
            recoveryRead.state.admissionTransaction,
            target.activeRoot,
            fs,
            { state: recoveryRead.state }
          )
        } catch (error) {
          canonicalEvidence = { errorCode: error.code || 'TASK_CANONICAL_EVIDENCE_UNAVAILABLE' }
        }
      }
    } catch (error) {
      recoveryRead = {
        status: 'error',
        errorCode: error.code || 'TASK_RECOVERY_STATE_UNAVAILABLE',
        message: error.message
      }
    }
  }

  const view = buildTaskContinuityView({
    resolution,
    recoveryRead,
    projectionMarker,
    canonicalEvidence,
    project: candidateProject,
    activeRoot: target?.activeRoot || '',
    priorDisambiguationReceiptDigest: args.priorDisambiguationReceiptDigest || null
  })
  const persistedLanguage = recoveryRead.state?.languageContext || {}
  const requestedLocale = normalizeLanguageTag(args.locale)
  const durableLocale = normalizeLanguageTag(
    persistedLanguage.responseLanguage ||
    persistedLanguage.primaryLanguage ||
    persistedLanguage.durablePrimaryLocale
  )
  const languageEvidence = `${args.name || ''}${candidate?.displayName || ''}`
  const locale = requestedLocale || durableLocale || (/\p{Script=Han}/u.test(languageEvidence) ? 'zh-CN' : 'en-US')
  return {
    content: [{ type: 'text', text: renderTaskContinuityViewHuman(view, { locale }) }],
    structuredContent: view,
    isError: false
  }
}

function taskAdmissionIngressError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

function sameStableFileStat(left, right) {
  return String(left?.dev) === String(right?.dev) &&
    String(left?.ino) === String(right?.ino) &&
    Number(left?.size) === Number(right?.size) &&
    Number(left?.mtimeMs) === Number(right?.mtimeMs) &&
    Number(left?.ctimeMs) === Number(right?.ctimeMs)
}

function currentPhysicalProjectRoot(target) {
  if (!LAYOUT.enabled) return path.resolve(INPUT_ROOT)
  const binding = resolveProjectBinding(target.project, { requireProfile: false })
  if (!binding?.physicalRoot || !path.isAbsolute(binding.physicalRoot)) {
    throw taskAdmissionIngressError(
      'TASK_ADMISSION_PROJECT_ROOT_UNAVAILABLE',
      'the current physical project root cannot be resolved from the workspace layout'
    )
  }
  return path.resolve(binding.physicalRoot)
}

function readServerOwnedLifecycleProjection(target) {
  const scopeKey = LAYOUT.enabled ? assertSingleSegment(target.project, 'project') : 'legacy'
  const relativeStatePath = path.join('.memory', 'hooks', scopeKey, 'lifecycle-state.json')
  let statePath
  try {
    statePath = resolveExistingRegularFileInside(target.activeRoot, relativeStatePath, {
      fs,
      label: 'server-owned lifecycle projection'
    })
  } catch (error) {
    throw taskAdmissionIngressError(
      'TASK_ADMISSION_INGRESS_STATE_UNAVAILABLE',
      `current server-owned lifecycle projection is unavailable: ${error.message}`
    )
  }
  let descriptor
  let raw
  let before
  let after
  try {
    descriptor = fs.openSync(statePath, 'r')
    before = fstatSnapshot(fs, descriptor)
    if (!before.isFile() || before.size <= 0 || before.size > 2 * 1024 * 1024) {
      throw taskAdmissionIngressError('TASK_ADMISSION_INGRESS_STATE_INVALID', 'lifecycle projection size or type is invalid')
    }
    raw = fs.readFileSync(descriptor, 'utf8')
    after = fstatSnapshot(fs, descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  const current = filePathSnapshot(fs, statePath)
  if (!current.isFile() || current.isSymbolicLink() || !sameStableFileStat(before, after) ||
      !sameStableFileStat(after, current) || Buffer.byteLength(raw, 'utf8') !== after.size) {
    throw taskAdmissionIngressError('TASK_ADMISSION_INGRESS_STATE_DRIFT', 'lifecycle projection changed during authority readback')
  }
  let state
  try { state = JSON.parse(raw) } catch (error) {
    throw taskAdmissionIngressError('TASK_ADMISSION_INGRESS_STATE_INVALID', `lifecycle projection JSON is invalid: ${error.message}`)
  }
  return { state, statePath, raw }
}

function verifiedResumeLifecycleContext(target, binding) {
  let projection
  try {
    projection = readServerOwnedLifecycleProjection(target)
  } catch (error) {
    return { status: 'unavailable', reasonCode: error.code || 'TASK_ADMISSION_INGRESS_STATE_UNAVAILABLE' }
  }
  const state = projection.state
  const acquisition = state?.contextAcquisition || {}
  if (String(acquisition.contextEpoch || '') !== binding.contextEpoch) {
    return { status: 'unavailable', reasonCode: 'lifecycle-context-epoch-not-current' }
  }
  const planBinding = acquisition.plan?.contextBinding || {}
  const receipt = acquisition.receipt || {}
  const exactPlanBinding = planBinding.contextEpoch === binding.contextEpoch &&
    planBinding.planId === binding.planId && planBinding.planContentId === binding.planContentId &&
    comparableActiveRoot(planBinding.activeRoot) === comparableActiveRoot(binding.activeRoot) &&
    String(planBinding.project || '') === binding.project
  const exactReceiptBinding = receipt.contextEpoch === binding.contextEpoch && receipt.planId === binding.planId &&
    receipt.planContentId === binding.planContentId &&
    comparableActiveRoot(receipt.identity?.activeRoot) === comparableActiveRoot(binding.activeRoot) &&
    String(receipt.identity?.project || '') === binding.project
  if (!exactPlanBinding || !exactReceiptBinding) {
    return { status: 'invalid', reasonCode: 'lifecycle-context-binding-mismatch' }
  }
  const receiptHostSessionId = String(receipt.identity?.hostSessionId || '').trim()
  const acquisitionHostSessionId = String(acquisition.hostSessionId || '').trim()
  if (receiptHostSessionId && acquisitionHostSessionId && receiptHostSessionId !== acquisitionHostSessionId) {
    return { status: 'invalid', reasonCode: 'lifecycle-host-session-binding-mismatch' }
  }
  const hostSessionId = receiptHostSessionId || acquisitionHostSessionId
  if (!hostSessionId) return { status: 'unavailable', reasonCode: 'lifecycle-host-session-missing' }
  const hostSessionDigest = crypto.createHash('sha256').update(hostSessionId).digest('hex')
  const envelope = state.actualInstructionEnvelope || {}
  const workItemSet = state.workItemSet || {}
  const routeDecision = state.workflowRouteDecision || {}
  const projectTargetLease = state.stickyProject || null
  const envelopePresent = Object.keys(envelope).length > 0
  const workItemSetPresent = Object.keys(workItemSet).length > 0
  const routeDecisionPresent = Object.keys(routeDecision).length > 0
  const projectTargetLeasePresent = !!(
    projectTargetLease && typeof projectTargetLease === 'object' && Object.keys(projectTargetLease).length
  )
  if (envelope.hostSessionDigest && envelope.hostSessionDigest !== hostSessionDigest) {
    return { status: 'invalid', reasonCode: 'lifecycle-host-session-mismatch' }
  }
  if (!envelopePresent && !workItemSetPresent && !routeDecisionPresent && !projectTargetLeasePresent) {
    return {
      status: 'context-only',
      reasonCode: 'lifecycle-read-only-resume-bootstrap',
      hostSessionId,
      hostSessionDigest,
      projectTargetLease: null
    }
  }
  if (!envelopePresent || !workItemSetPresent || !routeDecisionPresent || !projectTargetLeasePresent ||
      envelope.contextEpoch !== binding.contextEpoch || envelope.hostSessionDigest !== hostSessionDigest ||
      workItemSet.envelopeId !== envelope.envelopeId || workItemSet.envelopeDigest !== envelope.envelopeDigest ||
      routeDecision.envelopeId !== envelope.envelopeId || routeDecision.envelopeDigest !== envelope.envelopeDigest ||
      routeDecision.topIntent !== 'resume' || routeDecision.routeKey !== 'resume' || routeDecision.stage !== 'rehydrate') {
    return { status: 'context-only', reasonCode: 'lifecycle-ingress-rebuild-required',
      hostSessionId, hostSessionDigest, projectTargetLease: null }
  }
  const envelopeValidation = validateActualInstructionEnvelope(envelope)
  const workItemValidation = validateWorkItemSet(workItemSet, envelope)
  const routeValidation = verifyWorkflowRouteDecision(routeDecision, {
    envelopeDigest: envelope.envelopeDigest,
    workItemDigest: routeDecision.workItemDigest,
    routeRevision: routeDecision.routeRevision,
    actualInstructionEnvelope: envelope,
    workItemSet
  })
  if (!envelopeValidation.valid || envelope.instructionAuthority !== true ||
      envelope.authorityScope !== 'trusted-host-workflow-ingress' || !workItemValidation.valid ||
      !routeValidation.fresh || routeDecision.decisionStatus !== 'selected') {
    return {
      status: 'context-only',
      reasonCode: 'lifecycle-ingress-rebuild-required',
      hostSessionId, hostSessionDigest, projectTargetLease: null,
      errors: [...new Set([...envelopeValidation.errors, ...workItemValidation.errors, ...routeValidation.errors])]
    }
  }
  const leaseValidation = validateProjectTargetLease(projectTargetLease, {
    project: target.project,
    activeRoot: target.activeRoot,
    physicalRoot: currentPhysicalProjectRoot(target),
    contextEpoch: binding.contextEpoch,
    routeRevision: acquisition.plan?.workflowRoute?.routeRevision
  }, { nowMs: Date.now() })
  const receiptComplete = ['relevant-complete', 'completed'].includes(String(receipt.status || '')) &&
    !(receipt.missingSourceIds || []).length
  const leaseExpiredOnly = !leaseValidation.valid && leaseValidation.errors.length > 0 &&
    leaseValidation.errors.every(error => error === 'lease-time')
  const ingressRef = {
    schemaVersion: 'WorkflowIngressProjectionRefV1',
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    decisionDigest: routeDecision.decisionDigest,
    routeRevision: routeDecision.routeRevision
  }
  if (!leaseValidation.valid && !leaseExpiredOnly) {
    return {
      status: 'invalid',
      reasonCode: 'lifecycle-project-target-lease-invalid',
      errors: leaseValidation.errors
    }
  }
  if (!receiptComplete || leaseExpiredOnly) {
    return {
      status: 'recoverable-stale',
      reasonCode: !receiptComplete
        ? 'lifecycle-context-receipt-stale'
        : 'lifecycle-project-target-lease-expired',
      hostSessionId,
      hostSessionDigest,
      projectTargetLease: leaseValidation.valid ? projectTargetLease : null,
      errors: leaseValidation.valid ? [] : leaseValidation.errors,
      lifecycleState: state,
      ingressRef
    }
  }
  return {
    status: 'verified',
    hostSessionId,
    hostSessionDigest,
    projectTargetLease,
    lifecycleState: state,
    ingressRef
  }
}

function readServerOwnedAdmissionIngress(target, ingressRef, options = {}) {
  let ref = ingressRef && typeof ingressRef === 'object' && !Array.isArray(ingressRef) ? ingressRef : null
  if (!ref) {
    const { state } = readServerOwnedLifecycleProjection(target)
    const envelope = state?.actualInstructionEnvelope
    const route = state?.workflowRouteDecision
    const observedSession = process.env.DEVCODEX_HOST_SESSION_ID || state?.contextAcquisition?.hostSessionId
    if (observedSession && envelope?.hostSessionDigest &&
        crypto.createHash('sha256').update(observedSession).digest('hex') !== envelope.hostSessionDigest) {
      throw taskAdmissionIngressError('TASK_ADMISSION_HOST_SESSION_MISMATCH', 'current host session does not match the observed ingress')
    }
    ref = {
      schemaVersion: 'WorkflowIngressProjectionRefV1',
      envelopeId: envelope?.envelopeId, envelopeDigest: envelope?.envelopeDigest,
      decisionDigest: route?.decisionDigest, routeRevision: route?.routeRevision
    }
  }
  const digestPattern = /^[a-f0-9]{64}$/
  if (!ref || ref.schemaVersion !== 'WorkflowIngressProjectionRefV1' ||
      !/^aie-[a-f0-9]{40}$/.test(String(ref.envelopeId || '')) ||
      !digestPattern.test(String(ref.envelopeDigest || '')) ||
      !digestPattern.test(String(ref.decisionDigest || '')) ||
      !digestPattern.test(String(ref.routeRevision || ''))) {
    throw taskAdmissionIngressError(
      'TASK_ADMISSION_INGRESS_REF_INVALID',
      'ingressRef must be the exact compact WorkflowIngressProjectionRefV1 shown by the current hook projection'
    )
  }
  const scopeKey = LAYOUT.enabled ? assertSingleSegment(target.project, 'project') : 'legacy'
  const ingressMetaDir = path.join(target.activeRoot, '.memory', 'hooks', scopeKey)
  // A bounded resume capability is narrower than the immutable host snapshot:
  // it is additionally bound to the exact finalized task generation and
  // fenced owner. Prefer it when both share the same ingressRef so relocation
  // rebinding remains authoritative for renew/release/terminal calls.
  const resumeRead = readBoundedResumeIngressCapability({
    metaDir: ingressMetaDir,
    ingressRef: ref,
    project: target.project,
    activeRoot: target.activeRoot,
    taskId: options.taskId || readServerOwnedLifecycleProjection(target).state?.taskRecoveryBinding?.taskId
  }, { fs, nowMs: Date.now(), requireAuthority: true })
  if (resumeRead.status === 'fresh' && resumeRead.authority === true) {
    const candidate = resumeRead.candidate
    const state = candidate.ingress
    const projectRoot = currentPhysicalProjectRoot(target)
    const leaseValidation = validateProjectTargetLease(state.stickyProject, {
      project: target.project,
      activeRoot: target.activeRoot,
      physicalRoot: projectRoot,
      contextEpoch: state.actualInstructionEnvelope.contextEpoch,
      routeRevision: state.workflowRouteDecision.routeRevision
    }, { nowMs: Date.now() })
    if (!leaseValidation.valid) {
      throw taskAdmissionIngressError(
        'BOUNDED_RESUME_PROJECT_LEASE_INVALID',
        'the bounded resume ingress is bound to a stale or different project target lease',
        { errors: leaseValidation.errors }
      )
    }
    return {
      actualInstructionEnvelope: state.actualInstructionEnvelope,
      workItemSet: state.workItemSet,
      workflowRouteDecision: state.workflowRouteDecision,
      projectTargetLease: state.stickyProject,
      projectRoot,
      lifecycleState: resumeRead.state,
      ingressSnapshotRef: null,
      resumeCandidate: candidate,
      authorityReceipt: {
        schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
        source: 'bounded-resume-fallback',
        sourceDigest: candidate.candidateDigest,
        envelopeDigest: state.actualInstructionEnvelope.envelopeDigest,
        decisionDigest: state.workflowRouteDecision.decisionDigest,
        projectTargetLeaseDigest: state.stickyProject.leaseDigest,
        candidateId: candidate.candidateId,
        admissionGeneration: resumeRead.transaction.admissionGeneration,
        ownerGeneration: resumeRead.owner.ownerGeneration
      }
    }
  }
  // A preparation record cannot shadow committed ingress. Its failure remains
  // diagnostic; snapshots and the current trusted projection are independent.
  const snapshotRead = options.allowSnapshot === true
    ? readAdmissionIngressSnapshot({
        metaDir: ingressMetaDir,
        ingressRef: ref,
        project: target.project,
        activeRoot: target.activeRoot
      }, { fs, nowMs: Date.now() })
    : { status: 'missing' }
  if (snapshotRead.status === 'fresh') {
    const snapshot = snapshotRead.snapshot
    const projectRoot = currentPhysicalProjectRoot(target)
    const leaseValidation = validateProjectTargetLease(snapshot.projectTargetLease, {
      project: target.project,
      activeRoot: target.activeRoot,
      physicalRoot: projectRoot,
      contextEpoch: snapshot.actualInstructionEnvelope.contextEpoch,
      routeRevision: snapshot.workflowRouteDecision.routeRevision
    }, { nowMs: Date.now() })
    if (!leaseValidation.valid) {
      throw taskAdmissionIngressError(
        'TASK_ADMISSION_CONTINUATION_PROJECT_LEASE_INVALID',
        'the immutable admission ingress is bound to a stale or different project target lease',
        { errors: leaseValidation.errors, snapshotKey: snapshot.snapshotKey }
      )
    }
    return {
      actualInstructionEnvelope: snapshot.actualInstructionEnvelope,
      workItemSet: snapshot.workItemSet,
      workflowRouteDecision: snapshot.workflowRouteDecision,
      projectTargetLease: snapshot.projectTargetLease,
      projectRoot,
      lifecycleState: snapshotRead.state,
      ingressSnapshotRef: snapshotRead.ref,
      authorityReceipt: {
        schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
        source: 'immutable-snapshot',
        sourceDigest: snapshot.snapshotDigest,
        envelopeDigest: snapshot.actualInstructionEnvelope.envelopeDigest,
        decisionDigest: snapshot.workflowRouteDecision.decisionDigest,
        projectTargetLeaseDigest: snapshot.projectTargetLease.leaseDigest,
        snapshotKey: snapshot.snapshotKey
      }
    }
  }
  const { state, statePath, raw } = readServerOwnedLifecycleProjection(target)
  const envelope = state?.actualInstructionEnvelope
  const workItemSet = state?.workItemSet
  const decision = state?.workflowRouteDecision
  const lease = state?.stickyProject
  if (state?.activeScope !== 'project' || String(state?.activeProject || '') !== target.project ||
      envelope?.envelopeId !== ref.envelopeId || envelope?.envelopeDigest !== ref.envelopeDigest ||
      decision?.decisionDigest !== ref.decisionDigest || decision?.routeRevision !== ref.routeRevision ||
      decision?.envelopeId !== envelope?.envelopeId || decision?.envelopeDigest !== envelope?.envelopeDigest ||
      workItemSet?.envelopeId !== envelope?.envelopeId || workItemSet?.envelopeDigest !== envelope?.envelopeDigest ||
      lease?.schemaVersion !== 'ProjectTargetLeaseV2' || lease?.project !== target.project ||
      lease?.routeRevision !== decision?.routeRevision || comparableActiveRoot(lease?.activeRoot) !== comparableActiveRoot(target.activeRoot)) {
    throw taskAdmissionIngressError(
      'TASK_ADMISSION_INGRESS_STATE_MISMATCH',
      'ingressRef does not match the current server-owned envelope, work item, route, project or lease'
    )
  }
  const projectRoot = currentPhysicalProjectRoot(target)
  const leaseValidation = validateProjectTargetLease(lease, {
    project: target.project,
    activeRoot: target.activeRoot,
    physicalRoot: projectRoot,
    contextEpoch: envelope.contextEpoch,
    routeRevision: decision.routeRevision
  }, { nowMs: Date.now() })
  if (!leaseValidation.valid) {
    throw taskAdmissionIngressError(
      'TASK_ADMISSION_PROJECT_LEASE_INVALID',
      'the current server-owned ProjectTargetLeaseV2 is stale, tampered or bound to a different project root',
      { errors: leaseValidation.errors }
    )
  }
  const snapshotWrite = writeAdmissionIngressSnapshot({ metaDir: ingressMetaDir, state }, { fs, nowMs: Date.now() })
  if (!['persisted', 'semantic-noop'].includes(snapshotWrite.status)) {
    throw taskAdmissionIngressError(
      snapshotWrite.errorCode || 'ADMISSION_INGRESS_SNAPSHOT_WRITE_FAILED',
      'current ingress was verified but could not be frozen for task admission continuation',
      { snapshot: snapshotWrite }
    )
  }
  return {
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: decision,
    projectTargetLease: lease,
    projectRoot,
    lifecycleState: state,
    ingressSnapshotRef: snapshotWrite.ref,
    ingressWarnings: [resumeRead, snapshotRead].filter(item => !['fresh', 'missing'].includes(item.status)).map(item => item.errorCode || item.status),
    authorityReceipt: {
      schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
      source: path.relative(target.activeRoot, statePath).replace(/\\/g, '/'),
      sourceDigest: crypto.createHash('sha256').update(raw).digest('hex'),
      envelopeDigest: envelope.envelopeDigest,
      decisionDigest: decision.decisionDigest,
      projectTargetLeaseDigest: lease.leaseDigest,
      snapshotKey: snapshotWrite.ref.snapshotKey
    }
  }
}

function workflowRouteIndexMetaDir(target) {
  return LAYOUT.enabled
    ? path.join(LAYOUT.workspaceRoot, '.devcodex', 'workspace', '.memory', 'hooks', 'workspace')
    : path.join(target.activeRoot, '.memory', 'hooks', 'legacy')
}

function stableTaskIdentityReadback(target, transaction, ingress, taskId) {
  const taskRootRelative = String(transaction?.taskRootRelative || '').trim().replace(/\\/g, '/')
  if (!taskRootRelative || path.isAbsolute(taskRootRelative) || /^[A-Za-z]:/.test(taskRootRelative) ||
      taskRootRelative.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw taskAdmissionIngressError(
      'TASK_WRITE_OWNER_CANONICAL_TASK_INVALID',
      'durable admission transaction does not contain one canonical task root'
    )
  }
  const taskMemoryRelative = path.join(...taskRootRelative.split('/'), '.memory')
  const migratedIdentityRelative = path.join(taskMemoryRelative, 'task-identity-v2.json')
  const nativeIdentityRelative = path.join(taskMemoryRelative, 'task.json')
  let migratedIdentityPresent = false
  try {
    fs.lstatSync(path.join(target.activeRoot, migratedIdentityRelative))
    migratedIdentityPresent = true
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw taskAdmissionIngressError(
        'TASK_WRITE_OWNER_CANONICAL_TASK_UNAVAILABLE',
        `canonical TaskIdentityV2 cannot be inspected: ${error.message}`
      )
    }
  }
  const relativeIdentityPath = migratedIdentityPresent
    ? migratedIdentityRelative
    : nativeIdentityRelative
  let identityPath
  try {
    identityPath = resolveExistingRegularFileInside(target.activeRoot, relativeIdentityPath, {
      fs,
      label: 'canonical TaskIdentityV2'
    })
  } catch (error) {
    throw taskAdmissionIngressError(
      'TASK_WRITE_OWNER_CANONICAL_TASK_UNAVAILABLE',
      `canonical TaskIdentityV2 is unavailable: ${error.message}`
    )
  }
  let descriptor
  let before
  let after
  let raw
  try {
    descriptor = fs.openSync(identityPath, 'r')
    before = fstatSnapshot(fs, descriptor)
    if (!before.isFile() || before.size < 1 || before.size > 256 * 1024) {
      throw taskAdmissionIngressError('TASK_WRITE_OWNER_CANONICAL_TASK_INVALID', 'canonical TaskIdentityV2 size or type is invalid')
    }
    raw = fs.readFileSync(descriptor, 'utf8')
    after = fstatSnapshot(fs, descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  const current = filePathSnapshot(fs, identityPath)
  if (!current.isFile() || current.isSymbolicLink() || !sameStableFileStat(before, after) ||
      !sameStableFileStat(after, current) ||
      Buffer.byteLength(raw, 'utf8') !== after.size) {
    throw taskAdmissionIngressError('TASK_WRITE_OWNER_CANONICAL_TASK_DRIFT', 'canonical TaskIdentityV2 changed during readback')
  }
  let identity
  try { identity = JSON.parse(raw) } catch (error) {
    throw taskAdmissionIngressError('TASK_WRITE_OWNER_CANONICAL_TASK_INVALID', `canonical TaskIdentityV2 JSON is invalid: ${error.message}`)
  }
  const portableBinding = evaluatePortableTaskIdentityBinding(identity, {
    taskId,
    project: target.project,
    taskKind: String(transaction?.taskKind || ''),
    taskRootRelative,
    currentProjectRootIdentityDigest: ingress.projectTargetLease.rootIdentityDigest
  })
  if (identity?.schemaVersion !== 'TaskIdentityV2' || !portableBinding.valid ||
      identity.identityDigest !== transaction.taskIdentityDigest) {
    throw taskAdmissionIngressError(
      'TASK_WRITE_OWNER_CANONICAL_TASK_MISMATCH',
      'canonical TaskIdentityV2 does not match the portable task identity and exact admission transaction'
    )
  }
  return {
    source: path.relative(target.activeRoot, identityPath).replace(/\\/g, '/'),
    sourceDigest: crypto.createHash('sha256').update(raw).digest('hex'),
    identityDigest: identity.identityDigest,
    taskRootRelative,
    portableBinding
  }
}

function buildServerOwnedTakeoverObservation(target, ingress, taskId) {
  const identity = {
    activeRoot: target.activeRoot,
    project: target.project,
    taskId,
    taskStatus: 'active'
  }
  const metaDir = resolveTaskRecoveryMetaDir(identity)
  const ownerRead = readFencedTaskWriteOwner({ metaDir, identity }, { fs })
  if (ownerRead.status !== 'fresh' || ownerRead.source !== 'primary' || !ownerRead.transaction || !ownerRead.owner) {
    throw taskAdmissionIngressError(
      ownerRead.errorCode || 'TASK_WRITE_OWNER_TAKEOVER_STATE_UNAVAILABLE',
      'takeover requires the current primary owner and admission state'
    )
  }
  const taskReadback = stableTaskIdentityReadback(target, ownerRead.transaction, ingress, taskId)
  const routeIndex = createWorkspaceSessionRouteIndex({ metaDir: workflowRouteIndexMetaDir(target), fs, path })
  const priorRoute = routeIndex.read({ sessionDigest: ownerRead.owner.sessionDigest })
  // Observe the prior writer's canonical state, never the caller's new idle turn.
  const turn = ownerRead.state?.turnLiveness || {}
  const durableOperation = taskOperationTerminalSnapshot(turn)
  const currentSessionDigest = ingress.projectTargetLease.authorityDigest
  const currentContextEpoch = ingress.actualInstructionEnvelope.contextEpoch
  const inFlight = turn.inFlightOperation?.ownedByAgent === true &&
    Date.parse(String(turn.inFlightOperation.leaseExpiresAt || '')) > Date.now()
  const inFlightForPriorOwner = inFlight
  const terminalTurnForPriorOwner = ['completed', 'error', 'interrupted', 'idle'].includes(String(turn.state || ''))
  const previousContextTerminal = ownerRead.state?.contextAcquisition?.contextEpoch !== ownerRead.owner.contextEpoch &&
    ['completed', 'error', 'interrupted'].includes(String(turn.previousTurn?.terminalState || ''))
  const routeQuiescent = ['unbound', 'expired'].includes(priorRoute.status)
  const routeTaskMatches = !priorRoute.entry?.taskId || String(priorRoute.entry.taskId).toLowerCase() === taskId
  const noLiveTurn = !inFlightForPriorOwner && durableOperation.terminalReady && routeTaskMatches &&
    (terminalTurnForPriorOwner || previousContextTerminal || (routeQuiescent && !turn.turnKey))
  const receiptCore = {
    schemaVersion: 'ServerOwnedTaskTakeoverObservationV1',
    taskId,
    priorOwnerLeaseDigest: ownerRead.owner.leaseDigest,
    priorOwnerSessionDigest: ownerRead.owner.sessionDigest,
    canonicalTaskIdentityDigest: taskReadback.identityDigest,
    canonicalTaskSourceDigest: taskReadback.sourceDigest,
    priorRouteStatus: priorRoute.status,
    priorRouteEntryDigest: priorRoute.entry?.entryDigest || null,
    currentSessionDigest,
    currentContextEpoch,
    observedTurnState: String(turn.state || 'missing'),
    observedPreviousTurnState: String(turn.previousTurn?.terminalState || ''),
    activeOperationLease: inFlight,
    activeOperationLeaseForPriorOwner: inFlightForPriorOwner,
    unresolvedOperationId: durableOperation.unresolvedOperationId,
    operationEvidenceValid: durableOperation.valid,
    canonicalTaskReadback: true,
    noLiveTurn
  }
  const reconcileReceiptDigest = crypto.createHash('sha256').update(JSON.stringify(receiptCore)).digest('hex')
  return {
    ...receiptCore,
    reconcileReceiptDigest,
    canonicalTaskReadback: true,
    noLiveTurn
  }
}

function unbindTerminalWorkflowRoute(target, ingress, terminalReceipt, terminalOwner = null) {
  const routeIndex = createWorkspaceSessionRouteIndex({ metaDir: workflowRouteIndexMetaDir(target), fs, path })
  return routeIndex.update({
    sessionDigest: terminalOwner?.sessionDigest || ingress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: terminalOwner?.projectRootIdentity || terminalReceipt.projectRootIdentity ||
      ingress.projectTargetLease.rootIdentityDigest,
    taskId: '',
    routeRevision: terminalOwner?.routeRevision || ingress.projectTargetLease.routeRevision,
    trigger: 'terminal-unbind',
    lastTerminalReceiptDigest: terminalReceipt.receiptDigest
  })
}

function bindFormalWorkflowRoute(target, ingress, taskId) {
  const routeIndex = createWorkspaceSessionRouteIndex({ metaDir: workflowRouteIndexMetaDir(target), fs, path })
  return routeIndex.update({
    sessionDigest: ingress.projectTargetLease.authorityDigest,
    projectRootIdentityDigest: ingress.projectTargetLease.rootIdentityDigest,
    taskId,
    routeRevision: ingress.workflowRouteDecision.routeRevision,
    trigger: 'admission-bind'
  })
}

function formalWorkflowRouteBound(receipt) {
  return ['persisted', 'semantic-noop'].includes(String(receipt?.status || '')) &&
    String(receipt?.entry?.taskId || '') !== ''
}

function readFormalWorkflowRouteBinding(target, ingress, taskId) {
  const routeIndex = createWorkspaceSessionRouteIndex({ metaDir: workflowRouteIndexMetaDir(target), fs, path })
  const route = routeIndex.read({ sessionDigest: ingress.projectTargetLease.authorityDigest })
  if (route.status !== 'fresh' || route.entry?.taskId !== taskId ||
      route.entry?.projectRootIdentityDigest !== ingress.projectTargetLease.rootIdentityDigest ||
      route.entry?.routeRevision !== ingress.workflowRouteDecision.routeRevision) {
    throw taskAdmissionIngressError(
      'ARTIFACT_RECONCILIATION_ROUTE_MISMATCH',
      'artifact reconciliation requires the current exact same-session formal task route binding'
    )
  }
  return route
}

function stableRuntimeDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function exactResumeTaskState(target, taskId, options = {}) {
  const identity = {
    activeRoot: target.activeRoot,
    project: target.project,
    taskId: String(taskId || '').trim().toLowerCase(),
    taskStatus: 'active'
  }
  const metaDir = resolveTaskRecoveryMetaDir(identity)
  const ownerRead = readFencedTaskWriteOwner({ metaDir, identity }, { fs })
  if (!['fresh', 'missing'].includes(ownerRead.status) || ownerRead.source !== 'primary' || !ownerRead.transaction) {
    throw taskAdmissionIngressError(
      ownerRead.errorCode || 'FINALIZED_TASK_RESUME_STATE_UNAVAILABLE',
      'finalized resume requires the exact current primary admission; a legacy missing owner is adopted by the resume CAS'
    )
  }
  const ownerFencedRecoveryCandidate = options.allowOwnerFenced === true &&
    ownerRead.transaction.phase === 'owner-fenced' && ownerRead.transaction.status === 'admitting'
  if (!ownerFencedRecoveryCandidate &&
      (ownerRead.transaction.phase !== 'finalized' || ownerRead.transaction.status !== 'finalized')) {
    throw taskAdmissionIngressError(
      ownerRead.transaction.phase === 'terminal-closeout'
        ? 'FINALIZED_TASK_RESUME_TERMINAL'
        : 'FINALIZED_TASK_RESUME_ADMISSION_PHASE_INVALID',
      ownerRead.transaction.phase === 'terminal-closeout'
        ? 'terminal tasks require an explicit reopen'
        : 'resume requires one non-terminal finalized admission'
    )
  }
  return { identity, metaDir, ownerRead }
}

function compactContextBinding(value) {
  return {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch: String(value?.contextEpoch || ''),
    planId: String(value?.planId || ''),
    planContentId: String(value?.planContentId || ''),
    activeRoot: String(value?.activeRoot || ''),
    project: String(value?.project || '')
  }
}

function resolveResumeContextAuthorization(target, contextBinding, continuingTaskId = null) {
  const verifiedBinding = resolveContextReadBinding(contextBinding, target, null)
  const authorization = authorizeContextRead({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: verifiedBinding,
    requestedSources: []
  })
  if (authorization.status !== 'authorized') {
    throw taskAdmissionIngressError(
      authorization.errorCode || 'FINALIZED_TASK_RESUME_CONTEXT_INVALID',
      authorization.message || 'resume ContextReadBinding is not authorized'
    )
  }
  const route = authorization.plan?.workflowRoute || {}
  const continuedWork = continuingTaskId && ['fix', 'dev', 'self-fix', 'analyze', 'audit'].includes(route.topIntent) &&
    authorization.plan?.identity?.finalIntent === route.topIntent
  if (!continuedWork && (authorization.plan?.identity?.finalIntent !== 'resume' || route.topIntent !== 'resume' ||
      route.routeKey !== 'resume' || route.stage !== 'rehydrate')) {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_ROUTE_INVALID',
      'resumeContextBinding must belong to an exact resume/rehydrate ContextReadPlanV2'
    )
  }
  const rawObservations = readMcpContextSourceObservations({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: verifiedBinding,
    plan: authorization.plan
  }, { fs })
  const observedSessions = [...new Set((rawObservations.sourceResults || [])
    .map(item => String(item.hostSessionId || '').trim()).filter(Boolean))]
  if (observedSessions.length > 1) {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_SESSION_AMBIGUOUS',
      'durable context observations belong to more than one host session'
    )
  }
  const lifecycleContext = verifiedResumeLifecycleContext(target, verifiedBinding)
  if (lifecycleContext.status === 'invalid') {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_SESSION_MISMATCH',
      'the current lifecycle context does not bind one verified host session and project target',
      { reasonCode: lifecycleContext.reasonCode, errors: lifecycleContext.errors || [] }
    )
  }
  const environmentSession = String(process.env.DEVCODEX_HOST_SESSION_ID || '').trim()
  const sessionCandidates = [...new Set([
    ...observedSessions,
    ['verified', 'recoverable-stale', 'context-only'].includes(lifecycleContext.status)
      ? lifecycleContext.hostSessionId
      : '',
    environmentSession
  ].filter(Boolean))]
  if (sessionCandidates.length > 1) {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_SESSION_AMBIGUOUS',
      'context observations, lifecycle state and the explicit host session identify different sessions'
    )
  }
  const hostSessionId = sessionCandidates[0]
  if (!hostSessionId) {
    throw taskAdmissionIngressError('FINALIZED_TASK_RESUME_HOST_SESSION_UNOBSERVED',
      'recover actual host session evidence before acquiring a writer; read-only work remains available')
  }
  const durable = readMcpContextSourceObservations({
    activeRoot: target.activeRoot,
    project: target.project,
    contextBinding: verifiedBinding,
    plan: authorization.plan,
    hostSessionId
  }, { fs })
  let receipt = createContextReadReceipt(authorization.plan, {
    verificationMode: 'structured-plan',
    planObserved: true,
    hostSessionId
  })
  for (const result of durable.sourceResults || []) {
    receipt = recordContextReadOutcome(receipt, authorization.plan, result, { hostSessionId })
  }
  if (!['relevant-complete', 'completed'].includes(String(receipt?.status || '')) ||
      (receipt.missingSourceIds || []).length) {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_CONTEXT_INCOMPLETE',
      'resume ContextReadPlan sources are not relevant-complete',
      { missingSourceIds: receipt?.missingSourceIds || [], observationStatus: durable.status }
    )
  }
  return {
    authorization,
    binding: compactContextBinding(verifiedBinding),
    hostSessionId,
    lifecycleProjectTargetLease: ['verified', 'recoverable-stale'].includes(lifecycleContext.status)
      ? lifecycleContext.projectTargetLease
      : null,
    lifecycleIngressRef: ['verified', 'recoverable-stale'].includes(lifecycleContext.status)
      ? lifecycleContext.ingressRef
      : null,
    lifecycleState: ['verified', 'recoverable-stale'].includes(lifecycleContext.status)
      ? lifecycleContext.lifecycleState
      : null,
    receipt
  }
}

/** Build the fallback project lease from the verified raw session, not the envelope's plain event digest. */
function boundedResumeProjectLease(target, transaction, envelope, routeDecision, contextBinding, nowMs,
  hostSessionId, lifecycleProjectTargetLease = null) {
  const physicalRoot = currentPhysicalProjectRoot(target)
  const issuedAtMs = nowMs
  const expiresAtMs = Math.min(Date.parse(envelope.expiresAt), nowMs + 10 * 60 * 1000)
  const currentTarget = lifecycleProjectTargetLease?.schemaVersion === 'ProjectTargetLeaseV2'
    ? lifecycleProjectTargetLease
    : null
  const core = {
    schemaVersion: 'ProjectTargetLeaseV2',
    targetDigest: currentTarget?.targetDigest || stableRuntimeDigest({
      projectRootIdentityDigest: transaction.projectRootIdentityDigest,
      physicalRoot: comparableActiveRoot(physicalRoot),
      activeRoot: comparableActiveRoot(target.activeRoot)
    }),
    rootIdentityDigest: currentTarget?.rootIdentityDigest || transaction.projectRootIdentityDigest,
    layoutIdentity: currentTarget?.layoutIdentity || stableRuntimeDigest({
      mode: LAYOUT.enabled ? 'workspace-namespace' : 'legacy',
      workspaceRoot: comparableActiveRoot(LAYOUT.workspaceRoot || INPUT_ROOT)
    }),
    project: target.project,
    physicalRoot,
    activeRoot: target.activeRoot,
    ...(currentTarget?.physicalMarker ? { physicalMarker: currentTarget.physicalMarker } : {}),
    authorityKind: 'session',
    authorityDigest: digestSessionRef(hostSessionId),
    contextEpoch: envelope.contextEpoch,
    contextBindingDigest: stableRuntimeDigest(contextBinding),
    routeRevision: routeDecision.routeRevision,
    revocationEpoch: currentTarget ? Math.max(0, Number(currentTarget.revocationEpoch || 0)) + 1 : 0,
    issuedAt: new Date(issuedAtMs).toISOString(),
    issuedAtMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs
  }
  const leaseDigest = computeProjectTargetLeaseDigest(core)
  return {
    ...core,
    leaseId: `project-target-lease-${leaseDigest.slice(0, 24)}`,
    leaseDigest,
    source: currentTarget ? 'bounded-resume-lifecycle-context' : 'bounded-resume-fallback',
    validatedAt: new Date(nowMs).toISOString(),
    validatedAtMs: nowMs,
    invalidationReason: '',
    observedSessionRef: '',
    sessionKey: '',
    updatedAt: new Date(nowMs).toISOString(),
    updatedAtMs: nowMs
  }
}

function currentTrustedResumeIngress(target, context) {
  const state = context?.lifecycleState
  if (!context?.lifecycleIngressRef || !state) return null
  const envelope = state.actualInstructionEnvelope || {}
  const decision = state.workflowRouteDecision || {}
  if (envelope.contextEpoch !== context.binding.contextEpoch ||
      envelope.hostSessionDigest !== crypto.createHash('sha256').update(context.hostSessionId).digest('hex') ||
      decision.topIntent !== 'resume' || decision.routeKey !== 'resume' || decision.stage !== 'rehydrate' ||
      decision.routeRevision !== context.authorization.plan.workflowRoute.routeRevision) return null
  return {
    actualInstructionEnvelope: envelope,
    workItemSet: state.workItemSet,
    workflowRouteDecision: decision,
    projectTargetLease: state.stickyProject,
    projectRoot: currentPhysicalProjectRoot(target),
    lifecycleState: state,
    ingressSnapshotRef: null,
    authorityReceipt: {
      schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
      source: 'verified-current-lifecycle-resume',
      sourceDigest: stableRuntimeDigest({
        ingressRef: context.lifecycleIngressRef,
        contextBinding: context.binding,
        hostSessionDigest: envelope.hostSessionDigest
      }),
      envelopeDigest: envelope.envelopeDigest,
      decisionDigest: decision.decisionDigest,
      projectTargetLeaseDigest: state.stickyProject.leaseDigest,
      mutationAuthority: false
    }
  }
}

function buildFinalizedResumeStateHandoff(target, taskId, context, ingress, nowMs = Date.now()) {
  const envelope = ingress.actualInstructionEnvelope
  const decision = ingress.workflowRouteDecision
  const lifecycleState = context?.lifecycleState || {}
  const projectRootIdentity = validationProjectRootIdentity(currentPhysicalProjectRoot(target))
  let validationControlIngress = null
  const currentControl = lifecycleState.validationControlIngress
  if (currentControl && validateValidationControlIngressReceipt(currentControl, {
    hostSessionDigest: envelope.hostSessionDigest,
    contextEpoch: envelope.contextEpoch,
    taskRecoveryKey: taskId,
    project: target.project,
    projectRootIdentity
  }, { now: nowMs }).valid) {
    validationControlIngress = currentControl
  }
  const intent = lifecycleState.validationControlIngressIntent
  if (!validationControlIngress && intent &&
      validateValidationControlIngressIntent(intent, null, { now: nowMs }).valid) {
    try {
      validationControlIngress = bindValidationControlIngressIntent(intent, {
        actualInstructionEnvelope: envelope,
        taskRecoveryKey: taskId,
        project: target.project,
        projectRootIdentity
      }, { now: nowMs })
    } catch { }
  }
  const observedStickyAuto = lifecycleState.stickyAuto || null
  const observedStickyAutoCurrent = validationControlIngress?.action === 'auto-authorize' &&
    observedStickyAuto?.active === true && String(observedStickyAuto.authorityRef || '').trim() &&
    observedStickyAuto.sourceMessageDigest === envelope.actualInstructionDigest &&
    crypto.createHash('sha256').update(String(observedStickyAuto.sessionKey || '')).digest('hex') === envelope.hostSessionDigest &&
    Number.isFinite(Number(observedStickyAuto.updatedAtMs)) &&
    nowMs - Number(observedStickyAuto.updatedAtMs) >= 0 && nowMs - Number(observedStickyAuto.updatedAtMs) <= 30 * 60 * 1000
  const stickyAuto = validationControlIngress?.action === 'auto-authorize'
    ? (observedStickyAutoCurrent
        ? observedStickyAuto
        : {
            active: true,
            source: 'validation-control-intent',
            kind: 'taskless-resume-handoff',
            sessionKey: context.hostSessionId,
            updatedAt: new Date(nowMs).toISOString(),
            updatedAtMs: nowMs,
            authorityRef: `auto:resume-control:${intent?.intentDigest || validationControlIngress.receiptDigest}`,
            sourceMessageDigest: envelope.actualInstructionDigest,
            reason: ''
          })
    : null
  return {
    schemaVersion: 'FinalizedTaskResumeStateHandoffV1',
    contextAcquisition: {
      schemaVersion: 'ContextReadStateV2',
      contextEpoch: context.binding.contextEpoch,
      activeRoot: target.activeRoot,
      project: target.project,
      targetResolved: true,
      hostSessionId: context.hostSessionId,
      verificationMode: 'structured-plan',
      plan: context.authorization.plan,
      receipt: context.receipt
    },
    workflowRoutePlanBinding: {
      schemaVersion: 'WorkflowRoutePlanBindingV1',
      bindingDigest: ingress.projectTargetLease.contextBindingDigest,
      routeRevision: decision.routeRevision,
      contextEpoch: envelope.contextEpoch,
      source: 'bounded-resume-v5'
    },
    validationControlIngress,
    stickyAuto,
    executionMode: stickyAuto ? 'auto' : 'confirm',
    handoffAt: new Date(nowMs).toISOString()
  }
}

function prepareFinalizedResumeCandidate(target, args, ingress, contextBinding) {
  const taskId = String(args.task?.taskId || '').trim().toLowerCase()
  let { metaDir, ownerRead } = exactResumeTaskState(target, taskId, { allowOwnerFenced: true })
  let transaction = ownerRead.transaction
  if (!['bind', 'adopt'].includes(String(args.operation || '')) || args.task?.entryVariant !== 'continue' ||
      args.task?.taskKind !== transaction.taskKind ||
      String(args.task?.taskRootRelative || '').replace(/\\/g, '/') !== transaction.taskRootRelative) {
    throw taskAdmissionIngressError(
      'FINALIZED_TASK_RESUME_REQUEST_INVALID',
      'bounded resume only supports bind/adopt + continue for the exact existing formal task'
    )
  }
  if (ingress.workflowRouteDecision.topIntent !== 'resume' || ingress.workflowRouteDecision.routeKey !== 'resume' ||
      ingress.workflowRouteDecision.stage !== 'rehydrate') {
    throw taskAdmissionIngressError('FINALIZED_TASK_RESUME_ROUTE_INVALID', 'finalized resume requires the selected resume/rehydrate route')
  }
  let ownerFencedRecovery = null
  if (transaction.phase === 'owner-fenced') {
    ownerFencedRecovery = recoverOwnerFencedAdmissionForResume({
      operation: args.operation,
      task: args.task,
      overview: args.overview,
      actualInstructionEnvelope: ingress.actualInstructionEnvelope,
      workItemSet: ingress.workItemSet,
      workflowRouteDecision: ingress.workflowRouteDecision,
      projectTargetLease: ingress.projectTargetLease,
      ingressSnapshotRef: ingress.ingressSnapshotRef,
      serverRuntime: MEMORY_RUNTIME_IDENTITY,
      activeRoot: target.activeRoot,
      project: target.project
    })
    const recoveredState = exactResumeTaskState(target, taskId)
    metaDir = recoveredState.metaDir
    ownerRead = recoveredState.ownerRead
    transaction = ownerRead.transaction
  }
  const canonical = readFinalizedResumeCanonicalEvidence(transaction, target.activeRoot, fs, {
    state: ownerRead.state
  })
  // The server-owned stable read is authoritative. A caller resuming from an
  // earlier conversation may legitimately echo an older overview; requiring
  // byte equality here would turn normal CP-driven task evolution into a
  // permanent resume failure. Identity, containment, CP lineage, owner and
  // runtime evidence remain fail-closed below and in executeTaskAdmission.
  const existingAuthorized = readBoundedResumeIngressCapability({
    metaDir,
    ingressRef: {
      schemaVersion: 'WorkflowIngressProjectionRefV1',
      envelopeId: ingress.actualInstructionEnvelope.envelopeId,
      envelopeDigest: ingress.actualInstructionEnvelope.envelopeDigest,
      decisionDigest: ingress.workflowRouteDecision.decisionDigest,
      routeRevision: ingress.workflowRouteDecision.routeRevision
    },
    project: target.project,
    activeRoot: target.activeRoot,
    taskId
  }, { fs, nowMs: Date.now(), requireAuthority: true })
  if (existingAuthorized.status === 'fresh' && existingAuthorized.authority === true) {
    const candidate = existingAuthorized.candidate
    return {
      candidate,
      canonical,
      ownerFencedRecovery,
      ingress: {
        actualInstructionEnvelope: candidate.ingress.actualInstructionEnvelope,
        workItemSet: candidate.ingress.workItemSet,
        workflowRouteDecision: candidate.ingress.workflowRouteDecision,
        projectTargetLease: candidate.ingress.stickyProject,
        projectRoot: currentPhysicalProjectRoot(target),
        lifecycleState: existingAuthorized.state,
        ingressSnapshotRef: null,
        resumeCandidate: candidate,
        authorityReceipt: {
          schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
          source: 'bounded-resume-candidate-replay',
          sourceDigest: candidate.candidateDigest,
          envelopeDigest: candidate.ingressRef.envelopeDigest,
          decisionDigest: candidate.ingressRef.decisionDigest,
          projectTargetLeaseDigest: candidate.ingress.stickyProject.leaseDigest,
          candidateId: candidate.candidateId,
          mutationAuthority: true
        }
      }
    }
  }
  const binding = compactContextBinding(contextBinding || {
    contextEpoch: ingress.actualInstructionEnvelope.contextEpoch,
    planId: `host-ingress-${ingress.actualInstructionEnvelope.envelopeId.slice(4)}`,
    planContentId: ingress.workflowRouteDecision.decisionDigest,
    activeRoot: target.activeRoot,
    project: target.project
  })
  const nowMs = Date.now()
  // TaskIdentityV2 retains the first-admission root as immutable provenance.
  // The resumed admission generation and fenced owner instead bind the current
  // verified host lease, so relocation never leaves live mutation authority on
  // a root that is no longer the selected physical project.
  const resumeProjectTargetLease = ingress.projectTargetLease
  const liveness = observeFinalizedTaskResumeLiveness(ownerRead.state || {}, ownerRead.owner, {
    nowMs,
    targetSessionDigest: resumeProjectTargetLease.authorityDigest,
    targetContextEpoch: binding.contextEpoch
  })
  const attemptDigest = stableRuntimeDigest({
    schemaVersion: 'FinalizedTaskResumeAttemptV1',
    taskId,
    contextEpoch: binding.contextEpoch,
    planId: binding.planId,
    planContentId: binding.planContentId,
    envelopeDigest: ingress.actualInstructionEnvelope.envelopeDigest,
    decisionDigest: ingress.workflowRouteDecision.decisionDigest,
    priorTransactionDigest: transaction.transactionDigest,
    priorOwnerLeaseDigest: ownerRead.owner?.leaseDigest || null,
    canonicalRevisionDigest: canonical.canonicalRevisionDigest,
    cpChainDigest: canonical.cpChainDigest,
    runtimeDigest: MEMORY_RUNTIME_IDENTITY.runtimeDigest
  })
  const write = writeBoundedResumeIngressCapability({
    metaDir,
    attemptDigest,
    ingress: {
      activeProject: target.project,
      activeScope: 'project',
      actualInstructionEnvelope: ingress.actualInstructionEnvelope,
      workItemSet: ingress.workItemSet,
      workflowRouteDecision: ingress.workflowRouteDecision,
      workflowRoutePlanBinding: null,
      workflowIngressRecovery: null,
      stickyProject: resumeProjectTargetLease
    },
    project: target.project,
    activeRoot: target.activeRoot,
    projectRootIdentityDigest: resumeProjectTargetLease.rootIdentityDigest,
    taskId,
    taskRootRelative: transaction.taskRootRelative,
    taskIdentityDigest: canonical.taskIdentityDigest,
    canonicalOverviewDigest: canonical.canonicalOverviewDigest,
    canonicalRevisionDigest: canonical.canonicalRevisionDigest,
    cpConfirmed: canonical.cpConfirmed,
    cpArtifactDigest: canonical.cpArtifactDigest,
    cpChainDigest: canonical.cpChainDigest,
    contextBinding: binding,
    prior: {
      admissionId: transaction.admissionId,
      admissionGeneration: transaction.admissionGeneration,
      transactionDigest: transaction.transactionDigest,
      ownerGeneration: ownerRead.owner?.ownerGeneration || 0,
      leaseRevision: ownerRead.owner?.leaseRevision || 0,
      ownerLeaseDigest: ownerRead.owner?.leaseDigest || null,
      ownerStatus: ownerRead.owner?.status || 'missing',
      ownerExpiresAt: ownerRead.owner?.expiresAt || null
    },
    runtime: MEMORY_RUNTIME_IDENTITY,
    liveness,
    resumeStateHandoff: ingress.resumeStateHandoff || null
  }, { fs, nowMs })
  if (!['persisted', 'semantic-noop'].includes(write.status)) {
    throw taskAdmissionIngressError(
      write.errorCode || 'FINALIZED_TASK_RESUME_CANDIDATE_PERSIST_FAILED',
      'bounded resume candidate could not be persisted and read back',
      { reasonCode: 'candidate-persist-failed', retryability: 'safe-retry', nextStep: 'Retry the same resume attempt after the filesystem condition is resolved.', write }
    )
  }
  const candidate = write.candidate
  return {
    candidate,
    canonical,
    ownerFencedRecovery,
    ingress: {
      actualInstructionEnvelope: candidate.ingress.actualInstructionEnvelope,
      workItemSet: candidate.ingress.workItemSet,
      workflowRouteDecision: candidate.ingress.workflowRouteDecision,
      projectTargetLease: candidate.ingress.stickyProject,
      projectRoot: currentPhysicalProjectRoot(target),
      lifecycleState: ownerRead.state,
      ingressSnapshotRef: null,
      resumeCandidate: candidate,
      authorityReceipt: {
        schemaVersion: 'ServerOwnedAdmissionIngressReceiptV1',
        source: 'bounded-resume-candidate',
        sourceDigest: candidate.candidateDigest,
        envelopeDigest: candidate.ingressRef.envelopeDigest,
        decisionDigest: candidate.ingressRef.decisionDigest,
        projectTargetLeaseDigest: candidate.ingress.stickyProject.leaseDigest,
        candidateId: candidate.candidateId,
        mutationAuthority: false
      }
    }
  }
}

function buildBoundedResumeFallbackIngress(target, args, options = {}) {
  const taskId = String(args.task?.taskId || '').trim().toLowerCase()
  const { ownerRead } = exactResumeTaskState(target, taskId, { allowOwnerFenced: true })
  const context = resolveResumeContextAuthorization(target, args.resumeContextBinding, taskId)
  const transaction = ownerRead.transaction
  const nowMs = Date.now()
  const trustedIngress = currentTrustedResumeIngress(target, context)
  let envelope = trustedIngress?.actualInstructionEnvelope || null
  let workItemSet = trustedIngress?.workItemSet || null
  let routeDecision = trustedIngress?.workflowRouteDecision || null
  if (!trustedIngress) {
    const bucket = Math.floor(nowMs / (10 * 60 * 1000))
    const bucketStartedAtMs = bucket * 10 * 60 * 1000
    const sourceEventId = stableRuntimeDigest({
      contextEpoch: context.binding.contextEpoch,
      planId: context.binding.planId,
      taskId,
      bucket
    })
    envelope = buildActualInstructionEnvelope({
      sourceEventId,
      issuedAt: new Date(bucketStartedAtMs).toISOString()
    }, {
      actualInstruction: `Resume existing formal task ${taskId}`,
      hostVariant: `devcodex-memory/${DEFAULT_AGENT}/bounded-resume`,
      hostSessionId: context.hostSessionId,
      turnId: `resume-${context.binding.contextEpoch}-${bucket}`,
      contextEpoch: context.binding.contextEpoch,
      trustedHostEvent: false,
      ttlMs: 20 * 60 * 1000,
      nowMs
    })
    workItemSet = buildWorkItemSet(envelope, {
      workItems: [{ taskKind: 'resume', routeCandidate: 'resume' }]
    })
    const workItem = workItemSet.items[0]
    routeDecision = buildWorkflowRouteDecision({
      actualInstructionEnvelope: envelope,
      workItemSet,
      workItemId: workItem.workItemId,
      environmentMode: 'dev',
      topIntent: 'resume',
      subtype: 'resume',
      routeKey: 'resume',
      stage: 'rehydrate'
    })
  }
  const projectTargetLease = boundedResumeProjectLease(
    target,
    transaction,
    envelope,
    routeDecision,
    context.binding,
    nowMs,
    context.hostSessionId,
    context.lifecycleProjectTargetLease
  )
  const resumeIngress = {
    actualInstructionEnvelope: envelope,
    workItemSet,
    workflowRouteDecision: routeDecision,
    projectTargetLease,
    projectRoot: currentPhysicalProjectRoot(target),
    lifecycleState: context.lifecycleState || ownerRead.state,
    ingressSnapshotRef: null,
    authorityReceipt: trustedIngress?.authorityReceipt || null
  }
  resumeIngress.resumeStateHandoff = buildFinalizedResumeStateHandoff(
    target,
    taskId,
    context,
    resumeIngress,
    nowMs
  )
  if (options.prepareCandidate === false) return { ingress: resumeIngress }
  const prepared = prepareFinalizedResumeCandidate(target, args, resumeIngress, context.binding)
  prepared.ingress.contextReceipt = context.receipt
  prepared.ingress.trustedHostIngressReused = Boolean(trustedIngress)
  return prepared
}

function resolveContinuingTaskInput(target, args) {
  if (!['bind', 'adopt'].includes(args.operation) ||
      (args.task?.taskId && args.task?.taskKind && args.task?.taskRootRelative && args.task?.entryVariant)) return args
  let selector = args.task?.taskId || args.task?.displayName || args.task?.taskRootRelative || ''
  if (!selector) {
    const state = readServerOwnedLifecycleProjection(target).state || {}
    const hostSessionId = process.env.DEVCODEX_HOST_SESSION_ID || ''
    selector = hostSessionId && state.contextAcquisition?.hostSessionId === hostSessionId
      ? state.taskRecoveryBinding?.taskId || '' : ''
    if (!selector) {
      if (hostSessionId) {
        const index = createWorkspaceSessionRouteIndex({ metaDir: workflowRouteIndexMetaDir(target), fs, path })
        selector = index.read({ sessionDigest: digestSessionRef(hostSessionId) }).entry?.taskId || ''
      }
    }
  }
  const options = { cwd: INPUT_ROOT, project: target.project, scope: 'project', persistIndex: false }
  const resolution = selector ? resolveTaskContinuation({ ...options, name: selector }) : resolveUniqueActiveTaskContinuation(options)
  const candidate = resolution.status === 'resolved-active' ? resolution.candidate : null
  if (!candidate) throw taskAdmissionIngressError('TASK_CONTINUATION_TARGET_UNRESOLVED',
    'Preserve pending content and continue independent work; this write needs one exact existing task.', { resolution })
  const relativeRoot = path.relative(target.activeRoot, candidate.taskRoot).replace(/\\/g, '/')
  if (relativeRoot.startsWith('../') || path.isAbsolute(relativeRoot) ||
      (args.task?.taskId && args.task.taskId.toLowerCase() !== candidate.taskId.toLowerCase()) ||
      (args.task?.taskKind && args.task.taskKind !== candidate.kind) ||
      (args.task?.taskRootRelative && args.task.taskRootRelative !== relativeRoot)) {
    throw taskAdmissionIngressError('TASK_CONTINUATION_TASK_MISMATCH', 'The supplied path and observed task identity disagree.')
  }
  return { ...args, task: {
    ...args.task, taskId: candidate.taskId, taskKind: candidate.kind, taskRootRelative: relativeRoot,
    entryVariant: args.task?.entryVariant || 'continue', displayName: candidate.displayName
  } }
}

function handleMemoryTaskAdmitV2(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw Object.assign(new Error('formal task admission requires one exact project scope'), {
      code: 'TASK_ADMISSION_PROJECT_REQUIRED'
    })
  }
  args = resolveContinuingTaskInput(target, args)
  const hasIngressRef = args.ingressRef !== undefined && args.ingressRef !== null
  const hasResumeContext = args.resumeContextBinding !== undefined && args.resumeContextBinding !== null
  if (hasIngressRef && hasResumeContext) {
    throw taskAdmissionIngressError(
      hasIngressRef ? 'TASK_ADMISSION_INGRESS_INPUT_AMBIGUOUS' : 'TASK_ADMISSION_INGRESS_REQUIRED',
      hasIngressRef
        ? 'pass exactly one of ingressRef or resumeContextBinding'
        : 'one of ingressRef or resumeContextBinding is required'
    )
  }
  let ingress
  let ingressSource = 'host-hook'
  let preparedResume = null
  if (hasResumeContext) {
    preparedResume = buildBoundedResumeFallbackIngress(target, args)
    ingress = preparedResume.ingress
    ingressSource = preparedResume.ingress.trustedHostIngressReused
      ? 'bounded-resume-current-trusted'
      : 'bounded-resume-fallback'
  } else {
    ingress = resolveCurrentTaskIngress(target, args)
    const isFinalizedResume = ['bind', 'adopt'].includes(String(args.operation || '')) &&
      args.task?.entryVariant === 'continue' && ingress.workflowRouteDecision?.topIntent === 'resume' &&
      ingress.workflowRouteDecision?.routeKey === 'resume'
    if (isFinalizedResume) {
      const contextBinding = ingress.lifecycleState?.contextAcquisition?.plan?.contextBinding || null
      if (contextBinding) {
        try {
          const context = resolveResumeContextAuthorization(target, contextBinding)
          ingress.resumeStateHandoff = buildFinalizedResumeStateHandoff(
            target,
            String(args.task?.taskId || '').trim().toLowerCase(),
            context,
            ingress
          )
        } catch { }
      }
      preparedResume = prepareFinalizedResumeCandidate(target, args, ingress, contextBinding)
      ingress = preparedResume.ingress
    }
  }
  // Capture before admission/route binding switches the lifecycle projection
  // to the newly created canonical task.
  const ownerIngressState = taskOwnerIngressState(target, ingress)
  const admission = executeTaskAdmission({
    operation: args.operation,
    task: args.task,
    overview: args.overview,
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    projectTargetLease: ingress.projectTargetLease,
    ingressSnapshotRef: ingress.ingressSnapshotRef,
    ...(preparedResume ? { resumeCandidate: preparedResume.candidate } : {}),
    serverRuntime: MEMORY_RUNTIME_IDENTITY,
    activeRoot: target.activeRoot,
    project: target.project
  })
  if (preparedResume?.ownerFencedRecovery) {
    admission.ownerFencedRecovery = preparedResume.ownerFencedRecovery
  }
  let verifiedIngress = ingress
  if (admission.atomicOwnerAcquired === true) {
    verifiedIngress = readServerOwnedAdmissionIngress(target, preparedResume.candidate.ingressRef, { allowSnapshot: true, taskId: admission.taskId })
    admission.recoveryStage = 'readback-complete'
    admission.ingressRef = preparedResume.candidate.ingressRef
    admission.ingressAuthority = verifiedIngress.authorityReceipt
  }
  const routeBinding = bindFormalWorkflowRoute(target, verifiedIngress, admission.taskId)
  admission.routeBinding = routeBinding
  admission.routeBindingRequired = admission.atomicOwnerAcquired === true
    ? false
    : !formalWorkflowRouteBound(routeBinding)
  admission.routeBindingWarning = admission.atomicOwnerAcquired === true && !formalWorkflowRouteBound(routeBinding)
    ? (routeBinding?.errorCode || 'WORKSPACE_SESSION_ROUTE_DERIVATION_DEFERRED')
    : null
  admission.ingressAuthority = admission.ingressAuthority || ingress.authorityReceipt
  admission.ingressSource = ingressSource
  admission.ingressRef = admission.ingressRef || currentIngressRef(ingress)
  admission.activeVersion = MEMORY_RUNTIME_IDENTITY.activeVersion
  admission.runtimeGeneration = MEMORY_RUNTIME_IDENTITY.generationId
  if (!admission.atomicOwnerAcquired && !admission.routeBindingRequired && !['needs-reconcile', 'aborted'].includes(admission.status)) {
    const owner = executeTaskWriteOwner({
      operation: 'acquire',
      taskId: admission.taskId,
      admissionId: admission.admissionId,
      ingressState: ownerIngressState,
      actualInstructionEnvelope: verifiedIngress.actualInstructionEnvelope,
      workItemSet: verifiedIngress.workItemSet,
      workflowRouteDecision: verifiedIngress.workflowRouteDecision,
      projectTargetLease: verifiedIngress.projectTargetLease,
      ingressSnapshotRef: verifiedIngress.ingressSnapshotRef,
      serverRuntime: MEMORY_RUNTIME_IDENTITY,
      activeRoot: target.activeRoot,
      project: target.project
    })
    admission.ownerAcquisition = owner
    admission.continuationLease = owner.continuationLease
    admission.phase = owner.finalized ? 'finalized' : admission.phase
    admission.status = owner.finalized ? owner.status : admission.status
    admission.finalized = owner.finalized
    admission.mutationAuthority = owner.mutationAuthority
    admission.nextRequiredPhase = owner.finalized ? null : admission.nextRequiredPhase
  }
  admission.ownerGeneration = admission.ownerAcquisition?.owner?.ownerGeneration || null
  admission.leaseRevision = admission.ownerAcquisition?.owner?.leaseRevision || null
  return {
    content: [{ type: 'text', text: JSON.stringify(admission, null, 2) }],
    structuredContent: admission,
    isError: ['needs-reconcile', 'aborted'].includes(admission.status) || admission.routeBindingRequired
  }
}

function mutationCloseoutDigest(closeout) {
  return String(closeout?.artifactCloseout?.closeoutDigest || closeout?.observation?.closeout?.closeoutDigest || '')
}

function artifactReconciliationSource({ primary, reserves, identity, operationId, expectedCloseoutDigest }) {
  const primaryCloseout = primary.state?.turnLiveness?.lastMutationCloseout || null
  if (primaryCloseout?.operationId === operationId && mutationCloseoutDigest(primaryCloseout) === expectedCloseoutDigest) {
    if (primaryCloseout.result === 'reconciled') {
      const evidenceValidation = validateArtifactMutationReconciliationEvidence(primaryCloseout.reconciliation, {
        operationId,
        priorCloseoutDigest: expectedCloseoutDigest,
        priorObservationReceiptDigest: primaryCloseout.observation?.receiptDigest
      })
      if (evidenceValidation.valid) return { sourceKind: 'primary', lifecycleCloseout: primaryCloseout, replayed: true }
    }
    if (primaryCloseout.result === 'needs-reconcile') {
      return { sourceKind: 'primary', lifecycleCloseout: primaryCloseout, replayed: false }
    }
  }
  if (identity) {
    const reserve = (reserves.records || []).find(item => {
      try {
        const closeout = item.record?.lastMutationCloseout
        return sameIdentity(item.record?.identity, identity) && item.record?.reason === 'mutation-closeout' &&
          closeout?.result === 'needs-reconcile' && closeout.operationId === operationId &&
          mutationCloseoutDigest(closeout) === expectedCloseoutDigest
      } catch { return false }
    })
    if (reserve) {
      return {
        sourceKind: 'emergency-reserve',
        lifecycleCloseout: reserve.record.lastMutationCloseout,
        reserveSequence: reserve.sequence,
        reserveRecordDigest: reserve.recordDigest,
        replayed: false
      }
    }
  }
  throw taskAdmissionIngressError(
    'ARTIFACT_RECONCILIATION_CLOSEOUT_NOT_FOUND',
    'the exact pending artifact closeout is missing, stale or already replaced'
  )
}

function handleMemoryArtifactMutationReconcileV1(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_PROJECT_REQUIRED', 'artifact reconciliation requires one exact project scope')
  }
  const ingress = resolveObservedOperationIngress(target, args)
  const taskId = String(args.taskId || '').trim().toLowerCase()
  if (taskId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
    throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_TASK_INVALID', 'taskId is invalid')
  }
  const hostSessionDigest = String(ingress.actualInstructionEnvelope.hostSessionDigest || '').toLowerCase()
  const identity = taskId
    ? { activeRoot: target.activeRoot, project: target.project, taskId, taskStatus: 'active' }
    : null
  const metaDir = resolveTaskRecoveryMetaDir({ activeRoot: target.activeRoot, project: target.project })
  const recoveryInput = identity
    ? { metaDir, identity, hostSessionDigest }
    : {
        metaDir,
        hostSessionDigest,
        expectedIdentity: { activeRoot: target.activeRoot, project: target.project, taskStatus: 'active' }
      }
  const primary = readTaskRecoveryState(recoveryInput, { fs })
  if (!['fresh', 'ephemeral-stub'].includes(primary.status)) {
    throw taskAdmissionIngressError(
      primary.errorCode || 'ARTIFACT_RECONCILIATION_STATE_UNAVAILABLE',
      'canonical TaskRecoveryStoreV5 state is unavailable for artifact reconciliation'
    )
  }
  const recoveredTaskIds = [...new Set([
    primary.state?.taskRecoveryBinding?.taskId,
    primary.state?.admissionTransaction?.taskId
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]
  if (recoveredTaskIds.length > 1) {
    throw taskAdmissionIngressError(
      'ARTIFACT_RECONCILIATION_TASK_MISMATCH',
      'canonical TaskRecoveryStoreV5 state contains conflicting formal task identities'
    )
  }
  if (!taskId && recoveredTaskIds.length === 1) {
    throw taskAdmissionIngressError(
      'ARTIFACT_RECONCILIATION_TASK_REQUIRED',
      'taskId is required when the canonical recovery state belongs to a formal task'
    )
  }
  if (identity) {
    if (primary.state?.taskRecoveryBinding?.taskId !== taskId || primary.state?.admissionTransaction?.taskId !== taskId) {
      throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_TASK_MISMATCH', 'current ingress and canonical state do not bind the exact task')
    }
    if (primary.state.admissionTransaction.projectRootIdentityDigest !== ingress.projectTargetLease.rootIdentityDigest) {
      throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_PROJECT_ROOT_MISMATCH', 'current project root does not match the task admission generation')
    }
    // Exact durable operation/root/CAS evidence owns reconciliation. A stale
    // route index must not prevent recording already observed effects.
  }
  const reserves = identity ? readEmergencyCloseouts(metaDir, { fs }) : { records: [] }
  const source = artifactReconciliationSource({
    primary,
    reserves,
    identity,
    operationId: String(args.operationId || ''),
    expectedCloseoutDigest: String(args.expectedCloseoutDigest || '')
  })
  if (source.replayed) {
    const result = {
      schemaVersion: 'ArtifactMutationReconciliationResultV1',
      status: 'reconciled',
      sourceKind: source.sourceKind,
      operationId: args.operationId,
      receipt: source.lifecycleCloseout.reconciliation,
      replayed: true,
      mutationAuthority: false
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false }
  }
  const receipt = createArtifactMutationReconciliationReceipt({
    lifecycleCloseout: source.lifecycleCloseout,
    operationId: args.operationId,
    expectedCloseoutDigest: args.expectedCloseoutDigest,
    resolution: args.resolution,
    sourceKind: source.sourceKind,
    reserveSequence: source.reserveSequence,
    reserveRecordDigest: source.reserveRecordDigest,
    activeRoot: target.activeRoot,
    projectRoot: ingress.projectRoot,
    project: target.project,
    taskId,
    ingress: {
      envelopeDigest: ingress.actualInstructionEnvelope.envelopeDigest,
      decisionDigest: ingress.workflowRouteDecision.decisionDigest,
      routeRevision: ingress.workflowRouteDecision.routeRevision,
      projectTargetLeaseDigest: ingress.projectTargetLease.leaseDigest,
      hostSessionDigest
    }
  }, { fs })
  const commit = updateTaskRecoveryState(recoveryInput, state => {
    if (source.sourceKind === 'primary') {
      const current = state.turnLiveness?.lastMutationCloseout
      if (current?.result === 'reconciled') {
        const validation = validateArtifactMutationReconciliationEvidence(current.reconciliation, {
          operationId: args.operationId,
          priorCloseoutDigest: args.expectedCloseoutDigest,
          priorObservationReceiptDigest: source.lifecycleCloseout.observation.receiptDigest
        })
        if (validation.valid) return state
      }
      if (current?.result !== 'needs-reconcile' || current.operationId !== args.operationId ||
          mutationCloseoutDigest(current) !== args.expectedCloseoutDigest) {
        throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_CAS_MISMATCH', 'primary artifact closeout changed before reconciliation commit')
      }
    } else {
      const freshReserve = readEmergencyCloseouts(metaDir, { fs }).records.find(item =>
        item.sequence === source.reserveSequence && item.recordDigest === source.reserveRecordDigest)
      if (!freshReserve) {
        throw taskAdmissionIngressError('ARTIFACT_RECONCILIATION_RESERVE_CAS_MISMATCH', 'emergency closeout reserve changed before reconciliation commit')
      }
      const inFlight = state.turnLiveness?.inFlightOperation
      const sourceObservation = source.lifecycleCloseout.observation || {}
      const activeLease = inFlight?.mutationLease || inFlight?.taskOwnedMutationLease
      if (inFlight?.operationId !== args.operationId || inFlight?.mutating !== true ||
          source.lifecycleCloseout.operationId !== args.operationId ||
          inFlight?.mutationFootprint?.plannedSetDigest !== sourceObservation.plannedSetDigest ||
          activeLease?.leaseDigest !== sourceObservation.leaseDigest ||
          inFlight?.artifactDecision?.decisionDigest !== sourceObservation.decisionDigest) {
        throw taskAdmissionIngressError(
          'ARTIFACT_RECONCILIATION_PRIMARY_DRIFT',
          'emergency reserve reconciliation requires the exact still-pending primary operation, decision, lease and footprint'
        )
      }
    }
    return applyArtifactMutationReconciliation(state, source.lifecycleCloseout, receipt)
  }, { fs, reason: 'artifact-mutation-reconciliation', touchSessionMapping: true })
  if (!['committed', 'semantic-noop', 'ephemeral-stub'].includes(commit.status)) {
    throw taskAdmissionIngressError(
      commit.errorCode || 'ARTIFACT_RECONCILIATION_COMMIT_FAILED',
      commit.message || 'artifact reconciliation could not commit canonical state',
      commit
    )
  }
  const result = {
    schemaVersion: 'ArtifactMutationReconciliationResultV1',
    status: 'reconciled',
    sourceKind: source.sourceKind,
    operationId: args.operationId,
    receipt,
    replayed: false,
    mutationAuthority: false
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false }
}

function currentIngressRef(ingress) {
  return {
    schemaVersion: 'WorkflowIngressProjectionRefV1',
    envelopeId: ingress.actualInstructionEnvelope.envelopeId,
    envelopeDigest: ingress.actualInstructionEnvelope.envelopeDigest,
    decisionDigest: ingress.workflowRouteDecision.decisionDigest,
    routeRevision: ingress.workflowRouteDecision.routeRevision
  }
}

function resolveCurrentTaskIngress(target, args, options = {}) {
  const taskId = args.taskId || args.task?.taskId
  const warnings = []
  let lastError
  for (const ref of args.ingressRef ? [args.ingressRef, null] : [null]) {
    try {
      const ingress = readServerOwnedAdmissionIngress(target, ref, { allowSnapshot: options.allowSnapshot !== false, taskId })
      ingress.ingressWarnings = [...warnings, ...(ingress.ingressWarnings || [])]
      return ingress
    } catch (error) {
      if (/HOST_SESSION_MISMATCH|ROOT_MISMATCH|TASK_MISMATCH/.test(error.code || '')) throw error
      lastError = error
      warnings.push(error.code || error.message)
    }
  }
  const { state } = readServerOwnedLifecycleProjection(target)
  const exactTaskId = taskId || state.taskRecoveryBinding?.taskId
  const contextBinding = state.contextAcquisition?.plan?.contextBinding
  if (!exactTaskId || !contextBinding) {
    if (lastError) throw lastError
    throw taskAdmissionIngressError('TASK_CURRENT_INGRESS_UNAVAILABLE',
      'recover the current task/context binding; continue reads and independent work', { warnings })
  }
  const { ingress } = buildBoundedResumeFallbackIngress(target, {
    operation: 'bind', task: { taskId: exactTaskId, entryVariant: 'continue' }, resumeContextBinding: contextBinding
  }, { prepareCandidate: false })
  ingress.ingressWarnings = warnings
  return ingress
}

function taskOwnerIngressState(target, ingress) {
  let contextState = ingress.resumeStateHandoff || ingress.lifecycleState
  const sameContext = state => {
    const context = state?.contextAcquisition
    return context?.contextEpoch === ingress.actualInstructionEnvelope.contextEpoch &&
      context.hostSessionId && crypto.createHash('sha256').update(context.hostSessionId).digest('hex') === ingress.actualInstructionEnvelope.hostSessionDigest &&
      comparableActiveRoot(context.activeRoot) === comparableActiveRoot(target.activeRoot)
  }
  // Immutable ingress snapshots intentionally omit the mutable ContextRead
  // receipt. Reuse it only from the same observed instruction/route/session.
  if (!sameContext(contextState)) {
    contextState = null
    try {
      const { state } = readServerOwnedLifecycleProjection(target)
      if (state.activeProject === target.project && state.activeScope === 'project' &&
          state.actualInstructionEnvelope?.envelopeDigest === ingress.actualInstructionEnvelope.envelopeDigest &&
          state.workflowRouteDecision?.decisionDigest === ingress.workflowRouteDecision.decisionDigest &&
          sameContext(state)) contextState = state
    } catch { }
  }
  return {
    activeProject: target.project, activeScope: 'project',
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet, workflowRouteDecision: ingress.workflowRouteDecision,
    stickyProject: ingress.projectTargetLease,
    contextAcquisition: contextState?.contextAcquisition,
    workflowRoutePlanBinding: contextState?.workflowRoutePlanBinding
  }
}

function handleMemoryTaskWriteOwner(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError('TASK_WRITE_OWNER_PROJECT_REQUIRED', 'fenced task ownership requires one exact project scope')
  }
  const ingress = resolveCurrentTaskIngress(target, args)
  const taskId = String(args.taskId || '').trim().toLowerCase()
  const serverObservation = args.operation === 'takeover-prepare'
    ? buildServerOwnedTakeoverObservation(target, ingress, taskId)
    : null
  const result = executeTaskWriteOwner({
    operation: args.operation,
    taskId,
    admissionId: args.admissionId,
    expectedOwner: args.expectedOwner,
    targetSessionDigest: args.targetSessionDigest,
    handoffRefDigest: args.handoffRefDigest,
    takeoverRefDigest: args.takeoverRefDigest,
    ...(serverObservation ? { serverObservation } : {}),
    ingressState: taskOwnerIngressState(target, ingress),
    expectedCommitFence: ingress.lifecycleState?.taskRecoveryCommitFence,
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    projectTargetLease: ingress.projectTargetLease,
    ingressSnapshotRef: ingress.ingressSnapshotRef,
    serverRuntime: MEMORY_RUNTIME_IDENTITY,
    activeRoot: target.activeRoot,
    project: target.project
  })
  result.ingressAuthority = ingress.authorityReceipt
  result.ingressRef = currentIngressRef(ingress)
  result.ingressWarnings = ingress.ingressWarnings || []
  try { result.routeBinding = bindFormalWorkflowRoute(target, ingress, taskId) }
  catch (error) { result.routeBinding = { status: 'deferred', errorCode: error.code || error.message } }
  if (!formalWorkflowRouteBound(result.routeBinding)) result.routeBindingWarning = result.routeBinding?.errorCode || 'TASK_ROUTE_DERIVATION_DEFERRED'
  if (serverObservation) result.takeoverObservation = serverObservation
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError: false
  }
}

function resolveObservedOperationIngress(target, args) {
  try { return resolveCurrentTaskIngress(target, args) } catch (error) {
    if (!args.taskId) throw error
    const { ownerRead } = exactResumeTaskState(target, args.taskId)
    const state = ownerRead.state
    const current = readServerOwnedLifecycleProjection(target).state
    const hostSessionId = process.env.DEVCODEX_HOST_SESSION_ID || current.contextAcquisition?.hostSessionId ||
      current.contextAcquisition?.receipt?.identity?.hostSessionId
    if (!hostSessionId || state.fencedWriteOwner?.sessionDigest !== digestSessionRef(hostSessionId) ||
        comparableActiveRoot(state.stickyProject?.physicalRoot) !== comparableActiveRoot(currentPhysicalProjectRoot(target))) throw error
    return {
      actualInstructionEnvelope: state.actualInstructionEnvelope,
      workItemSet: state.workItemSet, workflowRouteDecision: state.workflowRouteDecision,
      projectTargetLease: state.stickyProject, projectRoot: currentPhysicalProjectRoot(target),
      lifecycleState: state, ingressWarnings: [error.code || error.message],
      authorityReceipt: { source: 'historical-operation-evidence', mutationAuthority: false }
    }
  }
}

function handleMemoryWorkflowOperationalWriteLease(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError(
      'WORKFLOW_OPERATIONAL_PROJECT_REQUIRED',
      'workflow operational authority requires one exact project scope'
    )
  }
  const ingress = resolveCurrentTaskIngress(target, args, { allowSnapshot: false })
  const lease = createWorkflowOperationalWriteLease({
    state: { ...ingress.lifecycleState, activeProject: target.project, activeScope: 'project',
      actualInstructionEnvelope: ingress.actualInstructionEnvelope, workItemSet: ingress.workItemSet,
      workflowRouteDecision: ingress.workflowRouteDecision, stickyProject: ingress.projectTargetLease },
    activeRoot: target.activeRoot,
    projectRoot: ingress.projectRoot,
    project: target.project,
    relativeTargets: args.targets,
    operation: args.operation,
    taskId: args.taskId
  }, { fs })
  const receipt = {
    schemaVersion: 'WorkflowOperationalWriteLeaseReceiptV1',
    lease,
    ingressAuthority: ingress.authorityReceipt,
    mutationAuthority: true,
    productMutationAuthority: false,
    formalArtifactAuthority: false,
    releaseAuthority: false
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }],
    structuredContent: receipt,
    isError: false
  }
}

function handleMemoryTaskFastPathLease(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError(
      'SIMPLE_TASK_PROJECT_REQUIRED',
      'simple-task authority requires one exact project scope'
    )
  }
  const ingress = readServerOwnedAdmissionIngress(target, args.ingressRef)
  const lease = createSimpleTaskFastPathLease({
    state: ingress.lifecycleState,
    activeRoot: target.activeRoot,
    projectRoot: ingress.projectRoot,
    project: target.project,
    relativeTargets: args.targets,
    operation: args.operation,
    riskAssessment: args.riskAssessment
  }, { fs })
  const priorUsage = ingress.lifecycleState.simpleTaskFastPathUsage
  let usage
  if (ingress.lifecycleState.simpleTaskFastPathLease?.leaseDigest === lease.leaseDigest) {
    const validation = validateSimpleTaskFastPathUsage(priorUsage, lease)
    if (!validation.valid) {
      throw taskAdmissionIngressError(
        'SIMPLE_TASK_USAGE_UNAVAILABLE',
        `existing simple-task lease has no valid usage state: ${validation.errors.join(', ')}`
      )
    }
    usage = priorUsage
  } else {
    usage = createSimpleTaskFastPathUsage(lease)
  }
  const receipt = {
    schemaVersion: 'SimpleTaskFastPathLeaseReceiptV1',
    lease,
    usage,
    ingressAuthority: ingress.authorityReceipt,
    mutationAuthority: true,
    productMutationAuthority: true,
    formalArtifactAuthority: false,
    controlPlaneAuthority: false,
    releaseAuthority: false
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }],
    structuredContent: receipt,
    isError: false
  }
}

function handleMemoryTaskTerminalV1(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError('TASK_TERMINAL_PROJECT_REQUIRED', 'workflow task terminal closeout requires one exact project scope')
  }
  const ingress = readServerOwnedAdmissionIngress(target, args.ingressRef, { allowSnapshot: true })
  const result = executeWorkflowTaskTerminal({
    taskId: args.taskId,
    admissionId: args.admissionId,
    terminalStatus: args.terminalStatus,
    expectedOwner: args.expectedOwner,
    lifecycleRevision: args.lifecycleRevision,
    expectedStateSequence: args.expectedStateSequence,
    expectedWriterGeneration: args.expectedWriterGeneration,
    settledSetDigest: args.settledSetDigest,
    evidence: args.evidence,
    actualInstructionEnvelope: ingress.actualInstructionEnvelope,
    workItemSet: ingress.workItemSet,
    workflowRouteDecision: ingress.workflowRouteDecision,
    projectTargetLease: ingress.projectTargetLease,
    serverRuntime: MEMORY_RUNTIME_IDENTITY,
    activeRoot: target.activeRoot,
    project: target.project
  })
  const routeUnbind = unbindTerminalWorkflowRoute(target, ingress, result.receipt, result.owner)
  const routeUnbound = ['persisted', 'semantic-noop', 'unbound'].includes(routeUnbind.status) || routeUnbind.liveBindingRemoved === true
  result.ingressAuthority = ingress.authorityReceipt
  result.routeUnbind = routeUnbind
  result.routeReconciliationRequired = !routeUnbound
  if (!routeUnbound) result.status = 'terminal-route-reconcile'
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError: !routeUnbound
  }
}

function handleMemoryTaskCloseoutReconcileV1(args) {
  const target = taskMemoryTransactionTarget(args)
  if (target.scope !== 'project' || !target.project) {
    throw taskAdmissionIngressError('TASK_TERMINAL_PROJECT_REQUIRED', 'workflow task closeout reconciliation requires one exact project scope')
  }
  const ingress = readServerOwnedAdmissionIngress(target, args.ingressRef, { allowSnapshot: true })
  const result = reconcileWorkflowTaskTerminal({
    activeRoot: target.activeRoot,
    project: target.project,
    taskId: args.taskId,
    sessionKey: ingress.actualInstructionEnvelope.hostSessionDigest
  }, { fs })
  const terminalReceipt = result.terminalReceipt || null
  const promoted = ['committed', 'semantic-noop'].includes(result.status) && terminalReceipt?.receiptDigest
  const routeUnbind = promoted
    ? unbindTerminalWorkflowRoute(target, ingress, terminalReceipt, result.owner)
    : null
  const routeUnbound = routeUnbind &&
    (['persisted', 'semantic-noop', 'unbound'].includes(routeUnbind.status) || routeUnbind.liveBindingRemoved === true)
  const projection = {
    schemaVersion: 'WorkflowTaskCloseoutReconcileResultV1',
    status: promoted && routeUnbound ? 'reconciled' : (promoted ? 'terminal-route-reconcile' : result.status),
    reconciliation: result,
    routeUnbind,
    routeReconciliationRequired: Boolean(promoted && !routeUnbound),
    ingressAuthority: ingress.authorityReceipt,
    mutationAuthority: false
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(projection, null, 2) }],
    structuredContent: projection,
    isError: projection.status !== 'reconciled'
  }
}

// ─── MCP JSON-RPC dispatcher ──────────────────────────────────────────────────

function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      }

    case 'tools/list':
      return { tools: TOOLS }

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        switch (name) {
          case 'memory_task_admit_v2': return handleMemoryTaskAdmitV2(args)
          case 'memory_task_write_owner': return handleMemoryTaskWriteOwner(args)
          case 'memory_task_fast_path_lease': return handleMemoryTaskFastPathLease(args)
          case 'memory_workflow_operational_write_lease': return handleMemoryWorkflowOperationalWriteLease(args)
          case 'memory_task_terminal_v1': return handleMemoryTaskTerminalV1(args)
          case 'memory_task_closeout_reconcile_v1': return handleMemoryTaskCloseoutReconcileV1(args)
          case 'memory_artifact_mutation_reconcile_v1': return handleMemoryArtifactMutationReconcileV1(args)
          case 'memory_task_resolve': return handleMemoryTaskResolve(args)
          case 'memory_task_continuity_view_v1': return handleMemoryTaskContinuityViewV1(args)
          case 'memory_status': return handleMemoryStatus(args)
          case 'memory_session_query': return handleMemorySessionQuery(args)
          case 'memory_summary_query': return handleMemorySummaryQuery(args)
          case 'memory_session_allocate': return handleMemorySessionAllocate(args)
          case 'memory_session_read': return handleMemorySessionRead(args)
          case 'memory_session_write': return handleMemorySessionWrite(args)
          case 'memory_artifact_link_project': return handleMemoryArtifactLinkProject(args)
          case 'memory_cp_confirm': return handleMemoryCpConfirm(args)
          case 'memory_summary_read': return handleMemorySummaryRead(args)
          case 'memory_summary_append': return handleMemorySummaryAppend(args)
          default:
            throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 })
        }
      } catch (err) {
        const errorCode = err.contextReadCode || (typeof err.code === 'string' ? err.code : null)
        const admissionInputError = name === 'memory_task_admit_v2' &&
          /^TASK_ADMISSION_(?:OPERATION|TASK_KIND|ENTRY_VARIANT|OVERVIEW|PRODUCT_SOURCE)_INVALID$/.test(errorCode || '')
        const inputContract = admissionInputError ? TOOLS.find(tool => tool.name === name).inputSchema : null
        const nextStep = err.nextStep || (inputContract
          ? 'Use the attached inputContract: operation is top-level; taskKind, entryVariant and displayName belong inside task; overview.content contains your original overview text. For a new task use entryVariant=new (or fix for bugs); retain the intended task kind and content. Correct the indicated field, then retry; do not guess alternate field names or task kinds.'
          : 'Correct the memory writer request and retry once.')
        return {
          content: [{ type: 'text', text: `Error: ${errorCode ? `${errorCode}: ` : ''}${err.message}` },
            ...(inputContract ? [{ type: 'text', text: JSON.stringify({ nextStep, inputContract }) }] : [])],
          ...(err.workspaceBinding ? {
            structuredContent: err.workspaceBinding
          } : errorCode ? {
            structuredContent: {
              schemaVersion: 'MemoryWriterErrorV1',
              errorCode,
              message: err.message,
              nextStep,
              ...(inputContract ? { inputContract } : {}),
              ...(err.details?.conflictReceipt
                ? { conflictReceipt: err.details.conflictReceipt }
                : {})
            }
          } : {}),
          isError: true
        }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

if (require.main === module) {
  createJsonLineServer({ dispatch, onEnd: () => process.exit(0) })
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}

module.exports = {
  applyMemoryCursor,
  decodeMemoryCursor,
  dispatch,
  encodeMemoryCursor,
  memoryCursorBinding,
  memoryCursorSourceIdentity,
  parseDailySessions,
  parseSummaryRows,
  readMemoryDocument
}
