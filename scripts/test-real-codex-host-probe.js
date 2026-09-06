#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  RealCodexHostProbeError,
  assertInstalledIdentityBinding,
  assertRuntimeBinding,
  buildCodexArgs,
  claimAttempt,
  classifyProbeResult,
  classifyTurnResult,
  collectHostHomeRoots,
  compareSnapshots,
  createRunIdentity,
  detachCodexTaskEnvironment,
  digestObject,
  executeProbeStage,
  executeTurnStage,
  extractCommandOutput,
  findAuthFile,
  finalizeAttempt,
  finalizeDeferredAttempt,
  initializeAttemptLedger,
  hasAccessDeniedEvidence,
  isNonterminalH3SafePartial,
  isOwnedCleanupComplete,
  isPathInside,
  isPidAlive,
  normalizeObservedCommand,
  normalizeObservedCommandVariants,
  openAttemptLedger,
  parseCliArguments,
  parseCodexJsonl,
  readLedgerJson,
  readWindowsAclProjection,
  runH0,
  runOwnedChild,
  samePath,
  sha256,
  snapshotControlledRoots,
  stableStringify,
  supportsCodexApproveForMe,
  terminateOwnedProcessTree,
  validateEvidenceRoot,
  validateProbeTopology
} = require('./lib/real-codex-host-probe')

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof RealCodexHostProbeError && error.code === code)
}

const TRUSTED_FORBIDDEN_POLICY = Object.freeze({
  schemaVersion: 'RealHostH0StagePolicyV1',
  approvalPolicy: 'never',
  sandboxMode: 'workspace-write',
  escalationAllowed: false
})

const AUTO_REVIEW_POLICY = Object.freeze({
  schemaVersion: 'RealHostH0StagePolicyV1',
  approvalPolicy: 'approve-for-me',
  sandboxMode: 'workspace-write',
  escalationAllowed: true
})

function makeIdentity(options = {}) {
  return createRunIdentity({
    mode: options.mode || 'H0',
    sourceCandidate: options.sourceCandidate || sha256(Buffer.from('candidate-' + (options.suffix || 'a'))),
    authorizationDigest: options.authorizationDigest || sha256(Buffer.from('authorization-' + (options.suffix || 'a'))),
    codexVersion: 'codex-cli 0.test',
    codexExecutable: process.execPath,
    argvContract: ['-a', 'never', 'exec', '-C', '<consumer>', '-s', 'workspace-write', '--add-dir', '<active-root>'],
    topology: options.topology || { processCwd: '<consumer>', addDir: '<active-root>' },
    tarball: options.tarball || null
  })
}

function finalizeFixturePass(attemptRef) {
  const receiptPath = path.join(attemptRef.directory, 'probe-receipt.json')
  fs.writeFileSync(receiptPath, JSON.stringify({ fixture: true }) + '\n', { flag: 'wx' })
  return finalizeAttempt(attemptRef, {
    status: 'PASS',
    receiptDigest: sha256(fs.readFileSync(receiptPath))
  })
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-real-host-probe-test-'))
  const sourceRoot = path.join(tmp, 'source')
  const evidenceRoot = path.join(tmp, 'evidence')
  const consumerRoot = path.join(tmp, 'workspace', 'consumer')
  const addDir = path.join(tmp, 'workspace', '.devcodex', 'consumer')
  const forbiddenRoot = path.join(tmp, 'forbidden')
  fs.mkdirSync(sourceRoot, { recursive: true })
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.mkdirSync(consumerRoot, { recursive: true })
  fs.mkdirSync(addDir, { recursive: true })
  fs.mkdirSync(forbiddenRoot, { recursive: true })
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), '{"private":true}\n')

  try {
    assert.strictEqual(stableStringify({ z: 1, a: { d: 2, b: 1 } }), '{"a":{"b":1,"d":2},"z":1}')
    assert.strictEqual(digestObject({ b: 2, a: 1 }), digestObject({ a: 1, b: 2 }))
    const aclTarget = path.join(tmp, 'acl target with spaces')
    fs.mkdirSync(aclTarget)
    const aclInvocation = {}
    const aclHostEnv = {
      SystemRoot: path.join(tmp, 'fake-system-root'),
      PSModulePath: path.join(tmp, 'powershell-7-only-modules')
    }
    const aclProjectionResult = readWindowsAclProjection(aclTarget, aclHostEnv, {
      executable: path.join(tmp, 'fake-powershell.exe'),
      spawnSync(executable, args, options) {
        Object.assign(aclInvocation, { executable, args, options })
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 'WindowsAclProjectionV1',
            targetPath: path.resolve(aclTarget),
            complete: true
          }),
          stderr: ''
        }
      }
    })
    assert.strictEqual(aclProjectionResult.targetPath, path.resolve(aclTarget))
    assert.strictEqual(aclInvocation.options.env.DEVCODEX_REAL_HOST_ACL_TARGET, path.resolve(aclTarget))
    assert.strictEqual(Object.hasOwn(aclHostEnv, 'DEVCODEX_REAL_HOST_ACL_TARGET'), false)
    assert.strictEqual(Object.hasOwn(aclInvocation.options.env, 'PSModulePath'), false)
    assert.strictEqual(aclHostEnv.PSModulePath, path.join(tmp, 'powershell-7-only-modules'))
    assert.strictEqual(aclInvocation.args.includes(path.resolve(aclTarget)), false)
    assert(aclInvocation.args.at(-1).includes("GetEnvironmentVariable('DEVCODEX_REAL_HOST_ACL_TARGET','Process')"))
    assert.notStrictEqual(
      createRunIdentity({
        mode: 'unit',
        sourceCandidate: sha256(Buffer.from('oracle-candidate')),
        authorizationDigest: sha256(Buffer.from('oracle-authorization')),
        codexVersion: 'codex-cli 0.test',
        codexExecutable: process.execPath,
        argvContract: ['probe'],
        topology: {},
        oracle: { nonce: 'a' }
      }).digest,
      createRunIdentity({
        mode: 'unit',
        sourceCandidate: sha256(Buffer.from('oracle-candidate')),
        authorizationDigest: sha256(Buffer.from('oracle-authorization')),
        codexVersion: 'codex-cli 0.test',
        codexExecutable: process.execPath,
        argvContract: ['probe'],
        topology: {},
        oracle: { nonce: 'b' }
      }).digest
    )
    expectCode(() => createRunIdentity({
      mode: 'installed',
      sourceCandidate: sha256(Buffer.from('installed-candidate')),
      authorizationDigest: sha256(Buffer.from('installed-authorization')),
      codexVersion: 'codex-cli 0.test',
      codexExecutable: process.execPath,
      argvContract: ['installed']
    }), 'REAL_HOST_IDENTITY_INVALID')
    const installedProbeEffectRoots = [{ label: 'isolatedHome', root: sourceRoot }]
    const installedIdentity = createRunIdentity({
      mode: 'installed',
      sourceCandidate: sha256(Buffer.from('installed-candidate')),
      authorizationDigest: sha256(Buffer.from('installed-authorization-2')),
      codexVersion: process.version,
      codexExecutable: process.execPath,
      argvContract: ['installed', '-c=fixture=true'],
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        probeEffectRoots: installedProbeEffectRoots
      },
      tarball: {
        path: path.join(tmp, 'candidate.tgz'),
        bytes: 1,
        sha256: sha256(Buffer.from('tarball'))
      },
      installedRuntime: {
        root: path.join(tmp, 'installed-runtime'),
        generationDigest: sha256(Buffer.from('runtime-generation'))
      }
    })
    assert.strictEqual(assertInstalledIdentityBinding(installedIdentity), undefined)
    assert.strictEqual(assertRuntimeBinding({
      ledger: { identity: installedIdentity },
      stage: 'H1',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      env: process.env,
      configOverrides: ['fixture=true'],
      bypassHookTrust: true,
      additionalEffectRoots: installedProbeEffectRoots
    }, 'probe'), undefined)
    expectCode(() => assertRuntimeBinding({
      ledger: { identity: installedIdentity },
      stage: 'H1',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      env: process.env,
      configOverrides: ['fixture=true'],
      bypassHookTrust: true,
      additionalEffectRoots: installedProbeEffectRoots.map(entry => ({ ...entry, ownedMutable: true }))
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    expectCode(() => createRunIdentity({
      mode: 'installed',
      sourceCandidate: sha256(Buffer.from('mutable-installed-candidate')),
      authorizationDigest: sha256(Buffer.from('mutable-installed-authorization')),
      codexVersion: process.version,
      codexExecutable: process.execPath,
      argvContract: ['installed'],
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        probeEffectRoots: [{ label: 'globalHome', root: sourceRoot, ownedMutable: true }]
      },
      tarball: {
        path: path.join(tmp, 'mutable-candidate.tgz'),
        bytes: 1,
        sha256: sha256(Buffer.from('mutable-tarball'))
      },
      installedRuntime: {
        root: path.join(tmp, 'mutable-installed-runtime'),
        generationDigest: sha256(Buffer.from('mutable-runtime-generation'))
      }
    }), 'REAL_HOST_IDENTITY_INVALID')
    expectCode(() => assertRuntimeBinding({
      ledger: { identity: installedIdentity },
      stage: 'H1',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      env: process.env,
      configOverrides: ['fixture=true'],
      bypassHookTrust: true,
      additionalEffectRoots: []
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    assert.strictEqual(samePath(consumerRoot, path.resolve(consumerRoot)), true)
    assert.strictEqual(isPathInside(path.dirname(consumerRoot), consumerRoot), true)
    assert.strictEqual(isPathInside(consumerRoot, path.dirname(consumerRoot)), false)

    const topology = validateProbeTopology({ consumerRoot, addDir, forbiddenRoot })
    assert.strictEqual(topology.consumerRoot, fs.realpathSync.native(consumerRoot))
    expectCode(
      () => validateProbeTopology({ consumerRoot, addDir: consumerRoot }),
      'REAL_HOST_TOPOLOGY_INVALID'
    )
    expectCode(
      () => validateProbeTopology({ consumerRoot, addDir: forbiddenRoot }),
      'REAL_HOST_TOPOLOGY_INVALID'
    )
    const versionDriftIdentity = createRunIdentity({
      mode: 'H0',
      sourceCandidate: sha256(Buffer.from('version-drift-candidate')),
      authorizationDigest: sha256(Buffer.from('version-drift-authorization')),
      codexVersion: 'codex-cli impossible-version',
      codexExecutable: process.execPath,
      argvContract: ['probe'],
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        forbiddenRoot,
        isolatedHome: sourceRoot
      },
      oracle: { allowed: { nonce: 'a'.repeat(48) } }
    })
    expectCode(() => assertRuntimeBinding({
      ledger: { identity: versionDriftIdentity },
      stage: 'H0-allowed',
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      env: process.env,
      ignoreUserConfig: true,
      ignoreRules: true,
      configOverrides: [],
      bypassHookTrust: false,
      additionalEffectRoots: [{ label: 'isolatedHome', root: sourceRoot, ownedMutable: true }]
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    assert(collectHostHomeRoots(process.env).every(item => path.isAbsolute(item)))
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(detachCodexTaskEnvironment({
        CODEX_THREAD_ID: 'desktop-task',
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop',
        DEVCODEX_HOST_SESSION_ID: 'host-session',
        DEVCODEX_TASK_RECOVERY_KEY: 'recovery-key',
        KEEP_ME: 'yes'
      })).filter(([key]) => [
        'CODEX_THREAD_ID',
        'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
        'DEVCODEX_HOST_SESSION_ID',
        'DEVCODEX_TASK_RECOVERY_KEY',
        'KEEP_ME'
      ].includes(key))),
      {
        CODEX_THREAD_ID: '',
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: '',
        DEVCODEX_HOST_SESSION_ID: '',
        DEVCODEX_TASK_RECOVERY_KEY: '',
        KEEP_ME: 'yes'
      }
    )
    const customCodexHome = path.join(tmp, 'custom-codex-home')
    fs.mkdirSync(customCodexHome)
    const customAuth = path.join(customCodexHome, 'auth.json')
    fs.writeFileSync(customAuth, '{}\n', { flag: 'wx' })
    assert.strictEqual(findAuthFile({ CODEX_HOME: customCodexHome }), customAuth)
    expectCode(() => validateEvidenceRoot(tmp, [sourceRoot]), 'REAL_HOST_EVIDENCE_ROOT_INVALID')

    const codexArgs = buildCodexArgs({
      consumerRoot,
      addDir,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      prompt: 'probe'
    })
    assert.deepStrictEqual(codexArgs.slice(0, 9), [
      '-a', 'never',
      'exec',
      '-C', path.resolve(consumerRoot),
      '-s', 'workspace-write',
      '--add-dir', path.resolve(addDir)
    ])
    assert(codexArgs.indexOf('--ignore-user-config') > codexArgs.indexOf('exec'))
    assert(codexArgs.indexOf('--ignore-rules') > codexArgs.indexOf('exec'))
    assert(codexArgs.includes('--ignore-user-config'))
    assert(codexArgs.includes('--ignore-rules'))
    assert(!codexArgs.includes('--dangerously-bypass-sandbox'))
    assert(!codexArgs.includes('danger-full-access'))
    assert.strictEqual(codexArgs[codexArgs.length - 1], 'probe')

    const approveForMeArgs = buildCodexArgs({
      consumerRoot,
      addDir,
      approveForMe: true,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      prompt: 'probe'
    })
    assert.deepStrictEqual(approveForMeArgs.slice(0, 6), [
      'exec', '--approve-for-me',
      '-C', path.resolve(consumerRoot),
      '--add-dir', path.resolve(addDir)
    ])
    assert.strictEqual(approveForMeArgs.indexOf('--approve-for-me'), 1)
    assert(!approveForMeArgs.includes('-a'))
    assert(!approveForMeArgs.includes('-s'))
    assert(!approveForMeArgs.includes('--sandbox'))
    assert(!approveForMeArgs.includes('workspace-write'))
    assert(!approveForMeArgs.some((value, index) => value === '-a' && approveForMeArgs[index + 1] === 'never'))
    assert.strictEqual(supportsCodexApproveForMe(process.execPath, process.env, {
      spawnSyncImpl(command, args, options) {
        assert.strictEqual(command, process.execPath)
        assert.deepStrictEqual(args, ['exec', '--help'])
        assert.strictEqual(options.timeout, 30000)
        return {
          status: 0,
          stdout: '  --approve-for-me\n      Route approval requests through automatic review using the workspace-write sandbox\n',
          stderr: ''
        }
      }
    }), true)
    assert.strictEqual(supportsCodexApproveForMe(process.execPath, process.env, {
      spawnSyncImpl: () => ({ status: 0, stdout: '--approve-for-me-extra\n', stderr: '' })
    }), false)
    assert.strictEqual(supportsCodexApproveForMe(process.execPath, process.env, {
      spawnSyncImpl: () => ({
        status: 0,
        stdout: '  --approve-for-me\n      Route approval requests through automatic review\n',
        stderr: ''
      })
    }), false)
    assert.strictEqual(supportsCodexApproveForMe(process.execPath, process.env, {
      spawnSyncImpl: () => ({
        status: 1,
        stdout: '  --approve-for-me\n      Route approval requests through automatic review using the workspace-write sandbox\n',
        stderr: 'failed'
      })
    }), false)
    assert.strictEqual(supportsCodexApproveForMe(process.execPath, process.env, {
      spawnSyncImpl: () => { throw new Error('fixture launch failure') }
    }), false)

    const expectedCommand = "node 'fixture.cjs' 'target.txt' 'cGF5bG9hZA=='"
    const jsonl = [
      JSON.stringify({
        type: 'item.started',
        item: { id: 'item-1', type: 'command_execution', command: expectedCommand, status: 'in_progress' }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item-1',
          type: 'command_execution',
          command: expectedCommand,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n')
    const observed = parseCodexJsonl(jsonl, [expectedCommand])
    assert.strictEqual(observed.commandObserved, true)
    assert.strictEqual(observed.commandCompleted, true)
    assert.strictEqual(observed.commandExitCode, 0)
    assert.strictEqual(observed.exactCommandInvocationCount, 1)
    assert.strictEqual(observed.invalidLineCount, 0)
    const completedOnlyCommand = parseCodexJsonl([
      JSON.stringify({
        type: 'item.started',
        item: { id: 'late-command', type: 'command_execution', status: 'in_progress' }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'late-command',
          type: 'command_execution',
          command: expectedCommand,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n'), [expectedCommand])
    assert.strictEqual(completedOnlyCommand.commandObserved, true)
    assert.strictEqual(completedOnlyCommand.commandCompleted, true)
    assert.strictEqual(normalizeObservedCommand('  ' + expectedCommand + '\r\n'), expectedCommand)
    const powerShellWrappedCommand = `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "${expectedCommand}"`
    const parseWindowsCodexJsonl = (stdout, expectedCommands) => parseCodexJsonl(
      stdout,
      expectedCommands,
      { platform: 'win32' }
    )
    assert.deepStrictEqual(
      normalizeObservedCommandVariants(powerShellWrappedCommand, 'win32'),
      [powerShellWrappedCommand, expectedCommand]
    )
    const wrappedDenied = parseWindowsCodexJsonl([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'wrapped-command',
          type: 'command_execution',
          command: powerShellWrappedCommand,
          status: 'in_progress'
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'wrapped-command',
          type: 'command_execution',
          command: powerShellWrappedCommand,
          status: 'declined',
          exit_code: -1,
          aggregated_output: `\`${powerShellWrappedCommand}\` rejected: blocked by policy`
        }
      })
    ].join('\n'), [expectedCommand])
    assert.strictEqual(wrappedDenied.commandObserved, true)
    assert.strictEqual(wrappedDenied.commandCompleted, true)
    assert.strictEqual(wrappedDenied.commandExitCode, -1)
    assert.strictEqual(wrappedDenied.commandFailureAccessDenied, true)
    assert.strictEqual(classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: {
        clean: false,
        unexpectedChanges: [],
        missingExpectedChanges: [{ root: 'addDir', path: 'marker' }]
      },
      observation: wrappedDenied
    }).code, 'HOST_ADD_DIR_WRITE_DENIED')
    const capturedExpectedCommand = String.raw`node 'C:\Users\fixture\AppData\Local\Temp\devcodex-real-host-h0-sample\workspace\consumer\.devcodex-real-host-probe-nonce.cjs' 'C:\Users\fixture\AppData\Local\Temp\devcodex-real-host-h0-sample\workspace\.devcodex\consumer\.devcodex-real-host-marker-nonce.txt' 'PAYLOAD'`
    const capturedWindowsDisplayCommand = String.raw`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "node 'C:\\Users\\fixture\\AppData\\Local\\Temp\\devcodex-real-host-h0-sample\\workspace\\consumer\\.devcodex-real-host-probe-nonce.cjs' 'C:\\Users\\fixture\\AppData\\Local\\Temp\\devcodex-real-host-h0-sample\\workspace\\.devcodex\\consumer\\.devcodex-real-host-marker-nonce.txt' 'PAYLOAD'"`
    const capturedDisplayPayload = /-Command "([^"\r\n]*)"$/u.exec(capturedWindowsDisplayCommand)?.[1] || ''
    assert.strictEqual((capturedExpectedCommand.match(/\\/gu) || []).length, 19)
    assert.strictEqual((capturedDisplayPayload.match(/\\/gu) || []).length, 38)
    assert(normalizeObservedCommandVariants(
      capturedWindowsDisplayCommand,
      'win32',
      [capturedExpectedCommand]
    ).includes(capturedExpectedCommand))
    const capturedDisplayJsonl = [
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'captured-display-command',
          type: 'command_execution',
          command: capturedWindowsDisplayCommand,
          status: 'in_progress'
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'captured-display-command',
          type: 'command_execution',
          command: capturedWindowsDisplayCommand,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n')
    const capturedDisplayObserved = parseWindowsCodexJsonl(
      capturedDisplayJsonl,
      [capturedExpectedCommand]
    )
    assert.strictEqual(capturedDisplayObserved.commandObserved, true)
    assert.strictEqual(capturedDisplayObserved.commandCompleted, true)
    assert.strictEqual(capturedDisplayObserved.commandExitCode, 0)
    assert.strictEqual(capturedDisplayObserved.exactCommandInvocationCount, 1)
    assert.strictEqual(
      capturedDisplayObserved.observedCommandDigests[0].digest,
      sha256(Buffer.from(normalizeObservedCommand(capturedWindowsDisplayCommand), 'utf8'))
    )
    const uncExpectedCommand = String.raw`node '\\server\share\probe.cjs' '\\server\share\marker.txt' 'PAYLOAD'`
    const uncWindowsDisplayCommand = String.raw`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "node '\\\\server\\share\\probe.cjs' '\\\\server\\share\\marker.txt' 'PAYLOAD'"`
    assert(normalizeObservedCommandVariants(
      uncWindowsDisplayCommand,
      'win32',
      [uncExpectedCommand]
    ).includes(uncExpectedCommand))
    assert.strictEqual(parseWindowsCodexJsonl(JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'unc-display-command',
        type: 'command_execution',
        command: uncWindowsDisplayCommand,
        status: 'completed',
        exit_code: 0
      }
    }), [uncExpectedCommand]).commandObserved, true)
    const mixedDisplayPayload = capturedDisplayPayload.replace(
      String.raw`C:\\Users\\fixture`,
      String.raw`C:\Users\\fixture`
    )
    const oddDisplayPayload = capturedDisplayPayload.replace(
      String.raw`C:\\Users\\fixture`,
      String.raw`C:\\\Users\\fixture`
    )
    const rejectedDisplayCommands = [
      String.raw`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "` + mixedDisplayPayload + '"',
      String.raw`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "` + oddDisplayPayload + '"',
      capturedWindowsDisplayCommand.replace('probe-nonce.cjs', 'probe-wrong.cjs'),
      capturedWindowsDisplayCommand.replace('marker-nonce.txt', 'marker-wrong.txt'),
      capturedWindowsDisplayCommand.replace('PAYLOAD\'"', 'PAYLOAD\'; echo extra"'),
      capturedWindowsDisplayCommand.replace('PAYLOAD\'"', 'PAYLOAD\' | Out-Null"'),
      capturedWindowsDisplayCommand.replace('PAYLOAD\'"', 'PAYLOAD\'; node second.cjs"'),
      capturedWindowsDisplayCommand.replace('PowerShell\\\\7\\\\pwsh.exe', 'Git\\\\bin\\\\bash.exe'),
      capturedWindowsDisplayCommand.replace(' -Command ', ' -NoProfile -Command ')
    ]
    for (const rejectedDisplayCommand of rejectedDisplayCommands) {
      assert.strictEqual(normalizeObservedCommandVariants(
        rejectedDisplayCommand,
        'win32',
        [capturedExpectedCommand]
      ).includes(capturedExpectedCommand), false)
      assert.strictEqual(parseWindowsCodexJsonl(JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'rejected-display-command',
          type: 'command_execution',
          command: rejectedDisplayCommand,
          status: 'completed',
          exit_code: 0
        }
      }), [capturedExpectedCommand]).commandObserved, false)
    }
    const capturedRawWrapperCommand = String.raw`"C:\Program Files\PowerShell\7\pwsh.exe" -Command "` +
      capturedExpectedCommand + '"'
    const representationDrift = parseWindowsCodexJsonl([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'representation-drift',
          type: 'command_execution',
          command: capturedWindowsDisplayCommand,
          status: 'in_progress'
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'representation-drift',
          type: 'command_execution',
          command: capturedRawWrapperCommand,
          status: 'completed',
          exit_code: 0
        }
      })
    ].join('\n'), [capturedExpectedCommand])
    assert.strictEqual(representationDrift.commandObserved, true)
    assert.strictEqual(representationDrift.commandIdentityDrift, true)
    const changedWrapper = powerShellWrappedCommand.replace('pwsh.exe', 'powershell.exe')
    assert.strictEqual(parseWindowsCodexJsonl([
      JSON.stringify({
        type: 'item.started',
        item: { id: 'wrapper-drift', type: 'command_execution', command: powerShellWrappedCommand }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'wrapper-drift', type: 'command_execution', command: changedWrapper, exit_code: -1 }
      })
    ].join('\n'), [expectedCommand]).commandIdentityDrift, true)
    for (const rejectedWrapper of [
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "${expectedCommand}; echo extra"`,
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "${expectedCommand} | Out-Null"`,
      `"C:\\Program Files\\Git\\bin\\bash.exe" -Command "${expectedCommand}"`,
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "${expectedCommand}"`
    ]) {
      assert.strictEqual(parseWindowsCodexJsonl(JSON.stringify({
        type: 'item.completed',
        item: { id: 'rejected-wrapper', type: 'command_execution', command: rejectedWrapper, exit_code: 0 }
      }), [expectedCommand]).commandObserved, false)
    }
    const duplicate = parseCodexJsonl(jsonl + '\n' + JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-2', type: 'command_execution', command: expectedCommand, exit_code: 0 }
    }), [expectedCommand])
    assert.strictEqual(duplicate.commandObserved, false)
    assert.strictEqual(duplicate.exactCommandInvocationCount, 2)
    const commandDrift = parseCodexJsonl(jsonl + '\n' + JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'command_execution', command: 'echo drift', exit_code: 0 }
    }), [expectedCommand])
    assert.strictEqual(commandDrift.commandIdentityDrift, true)
    assert.strictEqual(parseCodexJsonl('not-json', [expectedCommand]).invalidLineCount, 1)
    assert.strictEqual(parseCodexJsonl(JSON.stringify({
      type: 'item.completed',
      item: { id: 'other', type: 'command_execution', command: 'echo other', exit_code: 0 }
    }), [expectedCommand]).commandObserved, false)
    assert.strictEqual(extractCommandOutput({ aggregated_output: 'Error: EACCES' }), 'Error: EACCES')
    assert.strictEqual(hasAccessDeniedEvidence('Error: EACCES: permission denied'), true)
    assert.strictEqual(hasAccessDeniedEvidence('`command` rejected: blocked by policy'), true)
    assert.strictEqual(hasAccessDeniedEvidence('blocked by policy'), true)
    assert.strictEqual(hasAccessDeniedEvidence('command was not blocked by policy'), false)
    assert.strictEqual(hasAccessDeniedEvidence('node executable was not found'), false)

    const before = snapshotControlledRoots([
      { label: 'consumer', root: consumerRoot },
      { label: 'addDir', root: addDir }
    ])
    const expectedFile = path.join(addDir, 'expected.txt')
    const expectedBytes = Buffer.from('expected\n')
    fs.writeFileSync(expectedFile, expectedBytes, { flag: 'wx' })
    const after = snapshotControlledRoots([
      { label: 'consumer', root: consumerRoot },
      { label: 'addDir', root: addDir }
    ])
    const cleanDiff = compareSnapshots(before, after, [{
      root: 'addDir',
      path: 'expected.txt',
      after: { type: 'file', bytes: expectedBytes.length, sha256: sha256(expectedBytes) }
    }])
    assert.strictEqual(cleanDiff.clean, true)
    assert.strictEqual(compareSnapshots(before, after).clean, false)
    fs.rmSync(expectedFile)

    const identity = makeIdentity({ suffix: 'ledger' })
    const ledger = initializeAttemptLedger({
      evidenceRoot,
      identity,
      forbiddenRoots: [sourceRoot, consumerRoot, addDir, forbiddenRoot]
    })
    assert.strictEqual(openAttemptLedger({ evidenceRoot, identity }).identity.digest, identity.digest)
    assert.strictEqual(
      readLedgerJson(path.join(ledger.runDir, 'run.json'), 'fixture run ledger').value.schemaVersion,
      'RealHostAttemptLedgerV1'
    )
    expectCode(() => claimAttempt(ledger, 'H9'), 'REAL_HOST_STAGE_INVALID')
    expectCode(() => claimAttempt(ledger, 'H0-forbidden'), 'REAL_HOST_STAGE_PREDECESSOR_INCOMPLETE')
    const allowedAttempt = claimAttempt(ledger, 'H0-allowed')
    finalizeFixturePass(allowedAttempt)
    expectCode(() => claimAttempt(ledger, 'H0-allowed'), 'REAL_HOST_ATTEMPT_ALREADY_CONSUMED')
    const forbiddenAttempt = claimAttempt(ledger, 'H0-forbidden')
    finalizeFixturePass(forbiddenAttempt)
    expectCode(() => initializeAttemptLedger({
      evidenceRoot,
      identity: makeIdentity({
        suffix: 'same-authorization',
        authorizationDigest: identity.authorizationDigest
      })
    }), 'REAL_HOST_ATTEMPT_ALREADY_CONSUMED')

    const retryIdentity = makeIdentity({ suffix: 'retry', mode: 'unit' })
    const retryLedger = initializeAttemptLedger({ evidenceRoot, identity: retryIdentity })
    const firstRetryAttempt = claimAttempt(retryLedger, 'probe')
    finalizeAttempt(firstRetryAttempt, {
      status: 'UNVERIFIED',
      code: 'HOST_PROCESS_NOT_STARTED',
      retryEligible: true
    })
    const secondRetryAttempt = claimAttempt(retryLedger, 'probe', 2, { safePartial: true })
    finalizeAttempt(secondRetryAttempt, { status: 'PASS' })
    expectCode(() => claimAttempt(retryLedger, 'probe', 2, { safePartial: true }),
      'REAL_HOST_ATTEMPT_ALREADY_CONSUMED')
    expectCode(() => claimAttempt(retryLedger, 'probe', 3), 'REAL_HOST_ATTEMPT_INVALID')

    const predecessorRetryIdentity = makeIdentity({ suffix: 'predecessor-retry' })
    const predecessorRetryLedger = initializeAttemptLedger({
      evidenceRoot,
      identity: predecessorRetryIdentity
    })
    const predecessorFirst = claimAttempt(predecessorRetryLedger, 'H0-allowed')
    finalizeAttempt(predecessorFirst, {
      status: 'UNVERIFIED',
      code: 'HOST_PROCESS_NOT_STARTED',
      retryEligible: true
    })
    const predecessorSecond = claimAttempt(
      predecessorRetryLedger,
      'H0-allowed',
      2,
      { safePartial: true }
    )
    finalizeFixturePass(predecessorSecond)
    const afterRetryPredecessor = claimAttempt(predecessorRetryLedger, 'H0-forbidden')
    finalizeFixturePass(afterRetryPredecessor)

    const tamperIdentity = makeIdentity({ suffix: 'terminal-tamper' })
    const tamperLedger = initializeAttemptLedger({ evidenceRoot, identity: tamperIdentity })
    const tamperAttempt = claimAttempt(tamperLedger, 'H0-allowed')
    finalizeFixturePass(tamperAttempt)
    const tamperTerminalPath = path.join(tamperAttempt.directory, '03-terminal.json')
    const tamperTerminal = JSON.parse(fs.readFileSync(tamperTerminalPath, 'utf8'))
    tamperTerminal.runDigest = sha256(Buffer.from('tampered-run'))
    fs.writeFileSync(tamperTerminalPath, JSON.stringify(tamperTerminal, null, 2) + '\n')
    expectCode(
      () => claimAttempt(tamperLedger, 'H0-forbidden'),
      'REAL_HOST_LEDGER_INTEGRITY_FAILED'
    )

    const authorizationTamperIdentity = makeIdentity({ suffix: 'authorization-tamper' })
    initializeAttemptLedger({ evidenceRoot, identity: authorizationTamperIdentity })
    const authorizationClaimPath = path.join(
      evidenceRoot,
      'authorization-' + authorizationTamperIdentity.authorizationDigest + '.json'
    )
    const authorizationClaim = JSON.parse(fs.readFileSync(authorizationClaimPath, 'utf8'))
    authorizationClaim.runDigest = sha256(Buffer.from('wrong-run'))
    fs.writeFileSync(authorizationClaimPath, JSON.stringify(authorizationClaim, null, 2) + '\n')
    expectCode(
      () => openAttemptLedger({ evidenceRoot, identity: authorizationTamperIdentity }),
      'REAL_HOST_LEDGER_INTEGRITY_FAILED'
    )

    const runJsonTamperIdentity = makeIdentity({ suffix: 'run-json-tamper' })
    const runJsonTamperLedger = initializeAttemptLedger({ evidenceRoot, identity: runJsonTamperIdentity })
    fs.writeFileSync(path.join(runJsonTamperLedger.runDir, 'run.json'), '{invalid-json\n')
    expectCode(
      () => openAttemptLedger({ evidenceRoot, identity: runJsonTamperIdentity }),
      'REAL_HOST_LEDGER_INTEGRITY_FAILED'
    )

    const missingReceiptIdentity = makeIdentity({ suffix: 'missing-pass-receipt' })
    const missingReceiptLedger = initializeAttemptLedger({ evidenceRoot, identity: missingReceiptIdentity })
    const missingReceiptAttempt = claimAttempt(missingReceiptLedger, 'H0-allowed')
    finalizeAttempt(missingReceiptAttempt, { status: 'PASS' })
    expectCode(
      () => claimAttempt(missingReceiptLedger, 'H0-forbidden'),
      'REAL_HOST_LEDGER_INTEGRITY_FAILED'
    )

    const h3RetryIdentity = makeIdentity({ suffix: 'h3-retry', mode: 'unit' })
    const h3RetryLedger = initializeAttemptLedger({ evidenceRoot, identity: h3RetryIdentity })
    const h3First = claimAttempt(h3RetryLedger, 'H3')
    finalizeAttempt(h3First, {
      state: 'needs-review',
      status: 'UNVERIFIED',
      code: 'FORMAL_G2_SAFE_PARTIAL',
      retryEligible: true,
      summary: {
        taskId: 'task-safe',
        taskRoot: path.join(addDir, 'requirements', 'safe'),
        admissionGeneration: 2,
        canonicalRevision: 3,
        admissionPhase: 'finalized',
        ownerStatus: 'released',
        safePartial: true
      }
    })
    expectCode(() => claimAttempt(h3RetryLedger, 'H3', 2, {
      safePartial: true,
      taskId: 'task-wrong',
      taskRoot: path.join(addDir, 'requirements', 'safe'),
      admissionGeneration: 2,
      canonicalRevision: 3,
      admissionPhase: 'finalized',
      ownerStatus: 'released'
    }), 'REAL_HOST_RETRY_NOT_ELIGIBLE')
    const h3Second = claimAttempt(h3RetryLedger, 'H3', 2, {
      safePartial: true,
      taskId: 'task-safe',
      taskRoot: path.join(addDir, 'requirements', 'safe'),
      admissionGeneration: 2,
      canonicalRevision: 3,
      admissionPhase: 'finalized',
      ownerStatus: 'released'
    })
    finalizeAttempt(h3Second, { status: 'PASS' })

    const safePartialInput = {
      expectedTaskId: 'task-safe',
      taskId: 'task-safe',
      expectedTaskRoot: path.join(addDir, 'requirements', 'safe'),
      taskRoot: path.join(addDir, 'requirements', 'safe'),
      baselineAdmissionGeneration: 1,
      admissionGeneration: 2,
      baselineCanonicalRevision: 2,
      canonicalRevision: 3,
      terminalStatus: null,
      admissionPhase: 'finalized',
      ownerStatus: 'released'
    }
    assert.strictEqual(isNonterminalH3SafePartial(safePartialInput), true)
    for (const terminalStatus of ['completed', 'failed', 'rejected', 'cancelled']) {
      assert.strictEqual(isNonterminalH3SafePartial({ ...safePartialInput, terminalStatus }), false)
    }
    assert.strictEqual(isNonterminalH3SafePartial({
      ...safePartialInput,
      admissionGeneration: 1
    }), false)
    assert.strictEqual(isNonterminalH3SafePartial({
      ...safePartialInput,
      ownerStatus: 'active'
    }), false)
    assert.strictEqual(isNonterminalH3SafePartial({
      ...safePartialInput,
      admissionPhase: 'terminal-closeout'
    }), false)

    const allowedClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: true, exact: true },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 0
      }
    })
    assert.deepStrictEqual(allowedClassification, { status: 'PASS', code: null, retryEligible: false })
    const noCommandClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandObserved: false,
        commandEventCount: 0,
        commandCompleted: false,
        commandExitCode: null
      }
    })
    assert.strictEqual(noCommandClassification.status, 'UNVERIFIED')
    assert.strictEqual(noCommandClassification.code, 'HOST_COMMAND_NOT_OBSERVED')
    const argumentConflictClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        interruptedSignal: null,
        orchestrationError: null,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 2,
        stderr: [
          "error: the argument '--approve-for-me' cannot be used with '--sandbox <SANDBOX_MODE>'",
          '',
          'Usage: codex exec [OPTIONS] [PROMPT]'
        ].join('\n'),
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandIdentityDrift: false,
        commandObserved: false,
        commandEventCount: 0,
        commandCompleted: false,
        commandExitCode: null
      }
    })
    assert.deepStrictEqual(argumentConflictClassification, {
      status: 'UNVERIFIED',
      code: 'HOST_CODEX_ARGUMENT_CONFLICT',
      retryEligible: false
    })
    const incompleteArgumentConflict = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        interruptedSignal: null,
        orchestrationError: null,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 2,
        stderr: "error: the argument '--approve-for-me' cannot be used with '--sandbox <SANDBOX_MODE>'",
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandIdentityDrift: false,
        commandObserved: false,
        commandEventCount: 0,
        commandCompleted: false,
        commandExitCode: null
      }
    })
    assert.strictEqual(incompleteArgumentConflict.code, 'HOST_COMMAND_NOT_OBSERVED')
    const unrelatedParserFailure = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        interruptedSignal: null,
        orchestrationError: null,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 2,
        stderr: "error: unexpected argument '--unknown' found\n\nUsage: codex exec [OPTIONS] [PROMPT]",
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandIdentityDrift: false,
        commandObserved: false,
        commandEventCount: 0,
        commandCompleted: false,
        commandExitCode: null
      }
    })
    assert.strictEqual(unrelatedParserFailure.code, 'HOST_COMMAND_NOT_OBSERVED')
    const preCommandFailure = classifyProbeResult({
      expectation: 'allowed',
      child: { spawned: false },
      marker: { exists: false, exact: false },
      effects: {
        clean: false,
        unexpectedChanges: [],
        missingExpectedChanges: [{ root: 'addDir', path: 'marker' }]
      },
      observation: {}
    })
    assert.strictEqual(preCommandFailure.retryEligible, true)
    const deniedClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: {
        clean: false,
        unexpectedChanges: [],
        missingExpectedChanges: [{ root: 'addDir', path: 'marker' }]
      },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 1,
        commandFailureAccessDenied: true
      }
    })
    assert.strictEqual(deniedClassification.code, 'HOST_ADD_DIR_WRITE_DENIED')
    const genericCommandFailure = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: false, unexpectedChanges: [], missingExpectedChanges: [{ root: 'addDir' }] },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 1,
        commandFailureAccessDenied: false
      }
    })
    assert.strictEqual(genericCommandFailure.code, 'HOST_PROBE_COMMAND_FAILED')
    const inconclusiveForbidden = classifyProbeResult({
      expectation: 'forbidden',
      stagePolicy: TRUSTED_FORBIDDEN_POLICY,
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 1,
        commandFailureAccessDenied: false
      }
    })
    assert.strictEqual(inconclusiveForbidden.status, 'UNVERIFIED')
    assert.strictEqual(inconclusiveForbidden.code, 'HOST_FORBIDDEN_PROBE_INCONCLUSIVE')
    const forbiddenEscapeFixture = {
      expectation: 'forbidden',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: true, exact: true },
      effects: { clean: false, unexpectedChanges: [{ root: 'forbidden', path: 'marker' }] },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 0,
        commandFailureAccessDenied: false
      }
    }
    const autoReviewedEscape = classifyProbeResult({
      ...forbiddenEscapeFixture,
      stagePolicy: AUTO_REVIEW_POLICY
    })
    assert.deepStrictEqual(autoReviewedEscape, {
      status: 'UNVERIFIED',
      code: 'HOST_FORBIDDEN_POLICY_UNTRUSTED',
      retryEligible: false
    })
    const neverPolicyEscape = classifyProbeResult({
      ...forbiddenEscapeFixture,
      stagePolicy: TRUSTED_FORBIDDEN_POLICY
    })
    assert.deepStrictEqual(neverPolicyEscape, {
      status: 'BLOCK',
      code: 'HOST_ISOLATION_ESCAPE',
      retryEligible: false
    })
    const extraCommandClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: true, exact: true },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 2,
        commandCompleted: true,
        commandExitCode: 0
      }
    })
    assert.strictEqual(extraCommandClassification.code, 'HOST_UNEXPECTED_COMMAND_OBSERVED')
    const failedCleanupClassification = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { attempted: true, exitCode: 1, errorCode: null, stillRunning: false }
      },
      marker: { exists: true, exact: true },
      effects: { clean: true },
      observation: {
        invalidLineCount: 0,
        commandObserved: true,
        commandEventCount: 1,
        commandCompleted: true,
        commandExitCode: 0
      }
    })
    assert.strictEqual(failedCleanupClassification.code, 'HOST_CLEANUP_INCOMPLETE')
    assert.strictEqual(isOwnedCleanupComplete({ attempted: true, exitCode: 1, stillRunning: false }), false)
    assert.deepStrictEqual(classifyTurnResult({
      spawned: true,
      timedOut: false,
      interruptedSignal: null,
      orchestrationError: null,
      stdoutOverflow: false,
      stderrOverflow: false,
      exitCode: 0,
      cleanup: { attempted: true, exitCode: 1, errorCode: null, stillRunning: false }
    }, true), { status: 'BLOCK', code: 'HOST_CLEANUP_INCOMPLETE' })
    assert.deepStrictEqual(classifyTurnResult({
      spawned: true,
      timedOut: false,
      interruptedSignal: null,
      orchestrationError: null,
      stdoutOverflow: false,
      stderrOverflow: false,
      exitCode: 0,
      cleanup: { attempted: false, stillRunning: false }
    }, false), { status: 'BLOCK', code: 'HOST_LAST_MESSAGE_MISSING' })
    const unknownEventWithEffect = classifyProbeResult({
      expectation: 'allowed',
      child: {
        spawned: true,
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
        exitCode: 0,
        cleanup: { stillRunning: false }
      },
      marker: { exists: false, exact: false },
      effects: { clean: false, unexpectedChanges: [{ root: 'consumer', path: 'unexpected.txt' }] },
      observation: {
        invalidLineCount: 1,
        commandObserved: false,
        commandEventCount: 0,
        commandCompleted: false,
        commandExitCode: null
      }
    })
    assert.strictEqual(unknownEventWithEffect.code, 'HOST_ISOLATION_ESCAPE')

    const fakeCodex = path.join(tmp, 'fake-codex.cjs')
    fs.writeFileSync(fakeCodex, [
      "'use strict'",
      "const fs = require('fs')",
      "const args = process.argv.slice(2)",
      "const outputIndex = args.indexOf('--output-last-message')",
      "if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], 'fake-last-message\\n')",
      "if (process.env.FAKE_CODEX_TOUCH_HOME === '1') fs.writeFileSync(require('path').join(process.env.CODEX_HOME, 'host-state.json'), '{}\\n')",
      "const prompt = args[args.length - 1] || ''",
      "const command = prompt.split(/\\r?\\n/u).find(line => line.startsWith('node ')) || ''",
      "if (command) {",
      "  console.log(JSON.stringify({ type: 'item.started', item: { id: 'fake-command', type: 'command_execution', command, status: 'in_progress' } }))",
      "  let exitCode = 1",
      "  const values = Array.from(command.matchAll(/'((?:''|[^'])*)'/gu)).map(match => match[1].replace(/''/gu, \"'\"))",
      "  const splitAllowed = process.env.FAKE_CODEX_PROBE_RESULT === 'split' && !String(values[1] || '').includes('real-host-negative')",
      "  if (process.env.FAKE_CODEX_PROBE_RESULT === 'allow' || splitAllowed) {",
      "    fs.writeFileSync(values[1], Buffer.from(values[2], 'base64'), { flag: 'wx' })",
      "    exitCode = 0",
      "  }",
      "  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'fake-command', type: 'command_execution', command, status: exitCode === 0 ? 'completed' : 'failed', exit_code: exitCode, aggregated_output: exitCode === 0 ? '' : 'Error: EACCES: permission denied' } }))",
      "}",
      ''
    ].join('\n'), { encoding: 'utf8', flag: 'wx' })

    const aclSids = {
      current: 'S-1-5-21-1000-1000-1000-1001',
      sandboxGroup: 'S-1-5-21-1000-1000-1000-1004',
      sandboxMember: 'S-1-5-21-1000-1000-1000-1005',
      everyone: 'S-1-1-0',
      authenticatedUsers: 'S-1-5-11',
      builtinUsers: 'S-1-5-32-545'
    }
    const aclProjection = (target, options = {}) => ({
      schemaVersion: 'WindowsAclProjectionV1',
      targetPath: target,
      ownerSid: options.ownerSid || aclSids.current,
      currentUserSid: aclSids.current,
      sandboxGroupSid: aclSids.sandboxGroup,
      sandboxMemberSids: options.sandboxMemberSids || [aclSids.sandboxMember],
      entries: [
        {
          sid: aclSids.current,
          accessType: 'Allow',
          rights: 2032127,
          isInherited: false,
          inheritanceFlags: 'ContainerInherit, ObjectInherit',
          propagationFlags: 'None'
        },
        {
          sid: aclSids.sandboxGroup,
          accessType: 'Allow',
          rights: 131241,
          isInherited: true,
          inheritanceFlags: 'ContainerInherit, ObjectInherit',
          propagationFlags: 'None'
        },
        ...(options.allowWrites || []).map(entry => ({
          sid: entry.sid,
          accessType: 'Allow',
          rights: entry.rights,
          isInherited: entry.isInherited === true,
          inheritanceFlags: entry.isInherited === true ? 'ContainerInherit, ObjectInherit' : 'None',
          propagationFlags: 'None'
        })),
        ...(options.denyWrites || []).map(entry => ({
          sid: entry.sid,
          accessType: 'Deny',
          rights: entry.rights,
          isInherited: entry.isInherited === true,
          inheritanceFlags: entry.isInherited === true ? 'ContainerInherit, ObjectInherit' : 'None',
          propagationFlags: 'None'
        })),
        ...(options.extraEntries || [])
      ],
      sddl: Object.prototype.hasOwnProperty.call(options, 'sddl')
        ? options.sddl
        : 'fixture-sddl',
      complete: options.complete !== false
    })
    const h0CredentialHome = path.join(tmp, 'h0-credential-home')
    fs.mkdirSync(path.join(h0CredentialHome, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(h0CredentialHome, '.codex', 'auth.json'), '{}\n', { flag: 'wx' })

    function createH0Fixture(label, options = {}) {
      const root = path.join(tmp, 'h0-' + label)
      const fixtureSourceRoot = path.join(root, 'source')
      const fixtureEvidenceRoot = path.join(root, 'evidence')
      const localAppData = path.join(root, 'local-app-data')
      const forbiddenBaseRoot = path.join(localAppData, 'DevCodex', '.tmp', 'real-host-negative')
      const ambientTemp = options.ambientAtLocalAppData
        ? localAppData
        : path.join(root, 'ambient-temp')
      fs.mkdirSync(fixtureSourceRoot, { recursive: true })
      fs.mkdirSync(fixtureEvidenceRoot, { recursive: true })
      fs.mkdirSync(ambientTemp, { recursive: true })
      if (options.prepareBase !== false) fs.mkdirSync(forbiddenBaseRoot, { recursive: true })
      const env = {
        ...process.env,
        HOME: h0CredentialHome,
        USERPROFILE: h0CredentialHome,
        CODEX_HOME: path.join(h0CredentialHome, '.codex'),
        LOCALAPPDATA: localAppData,
        TEMP: ambientTemp,
        TMP: ambientTemp,
        TMPDIR: ambientTemp,
        FAKE_CODEX_PROBE_RESULT: 'split'
      }
      let aclReadCount = 0
      const readWindowsAcl = target => {
        aclReadCount += 1
        if (typeof options.readWindowsAcl === 'function') {
          return options.readWindowsAcl(target, aclReadCount)
        }
        return aclProjection(target)
      }
      return {
        root,
        evidenceRoot: fixtureEvidenceRoot,
        forbiddenBaseRoot,
        get aclReadCount() { return aclReadCount },
        runOptions: {
          evidenceRoot: fixtureEvidenceRoot,
          sourceRoot: fixtureSourceRoot,
          sourceCandidate: sha256(Buffer.from('h0-candidate-' + label)),
          authorizationDigest: sha256(Buffer.from('h0-authorization-' + label)),
          codexExecutable: process.execPath,
          launchPrefixArgs: [fakeCodex],
          env,
          timeoutMs: 10000,
          h0TestServices: {
            testOnly: true,
            platform: 'win32',
            systemTempRoot: path.join(root, 'separate-system-temp'),
            processCwd: fixtureSourceRoot,
            readWindowsAcl,
            ...(options.services || {})
          }
        }
      }
    }

    async function expectH0SetupFailure(fixture, code) {
      let observed
      try {
        await runH0(fixture.runOptions)
      } catch (error) {
        observed = error
      }
      assert(observed instanceof RealCodexHostProbeError)
      assert.strictEqual(observed.code, code)
      assert.strictEqual(observed.details.cleanup.complete, true)
      assert.strictEqual(observed.details.authorizationConsumed, false)
      assert.strictEqual(observed.details.runCreated, false)
      assert.strictEqual(observed.details.attemptCreated, false)
      assert.strictEqual(observed.details.childStarted, false)
      assert.deepStrictEqual(fs.readdirSync(fixture.evidenceRoot), [])
      if (fs.existsSync(fixture.forbiddenBaseRoot)) {
        assert.deepStrictEqual(fs.readdirSync(fixture.forbiddenBaseRoot), [])
      }
      return observed
    }

    const preauthorizedPrincipals = [
      { label: 'sandbox-group-modify', sid: aclSids.sandboxGroup, rights: 197055, isInherited: true },
      { label: 'sandbox-member-create', sid: aclSids.sandboxMember, rights: 2, isInherited: false },
      { label: 'everyone-write', sid: aclSids.everyone, rights: 278, isInherited: true },
      { label: 'authenticated-users-create-dir', sid: aclSids.authenticatedUsers, rights: 4, isInherited: true },
      { label: 'builtin-users-write', sid: aclSids.builtinUsers, rights: 278, isInherited: true }
    ]
    for (const principal of preauthorizedPrincipals) {
      const fixture = createH0Fixture(principal.label, {
        readWindowsAcl: target => aclProjection(target, { allowWrites: [principal] })
      })
      const observed = await expectH0SetupFailure(fixture, 'HOST_FORBIDDEN_ROOT_PREAUTHORIZED')
      assert.strictEqual(observed.details.eligibility.status, 'PREAUTHORIZED')
      assert(observed.details.eligibility.sandboxPrincipalWriteMatches.some(entry => entry.sid === principal.sid))
    }

    const ambientFixture = createH0Fixture('ambient-root', { ambientAtLocalAppData: true })
    const ambientFailure = await expectH0SetupFailure(ambientFixture, 'HOST_FORBIDDEN_ROOT_PREAUTHORIZED')
    assert(ambientFailure.details.eligibility.ambientWritableRootMatches.some(entry => entry.label === 'hostTEMP'))
    assert.strictEqual(ambientFixture.aclReadCount, 0)

    const orderingFixture = createH0Fixture('qualification-before-codex-child', {
      readWindowsAcl: target => aclProjection(target, {
        allowWrites: [{ sid: aclSids.sandboxGroup, rights: 197055, isInherited: true }]
      })
    })
    orderingFixture.runOptions.codexExecutable = path.join(orderingFixture.root, 'missing-codex.exe')
    orderingFixture.runOptions.env.HOME = path.join(orderingFixture.root, 'missing-credential-home')
    orderingFixture.runOptions.env.USERPROFILE = orderingFixture.runOptions.env.HOME
    orderingFixture.runOptions.env.CODEX_HOME = path.join(orderingFixture.runOptions.env.HOME, '.codex')
    await expectH0SetupFailure(orderingFixture, 'HOST_FORBIDDEN_ROOT_PREAUTHORIZED')

    const ambiguousFixture = createH0Fixture('acl-ambiguous', {
      readWindowsAcl: target => aclProjection(target, {
        allowWrites: [{ sid: aclSids.sandboxGroup, rights: 278, isInherited: true }],
        denyWrites: [{ sid: aclSids.sandboxMember, rights: 278, isInherited: false }]
      })
    })
    const ambiguousFailure = await expectH0SetupFailure(ambiguousFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')
    assert(ambiguousFailure.details.eligibility.reasons.includes('acl-effective-write-ambiguous'))

    const unknownAclFixture = createH0Fixture('acl-unknown', {
      readWindowsAcl: () => { throw new Error('fixture ACL unavailable') }
    })
    await expectH0SetupFailure(unknownAclFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')

    const missingSddlFixture = createH0Fixture('acl-missing-sddl', {
      readWindowsAcl: target => aclProjection(target, { sddl: '' })
    })
    await expectH0SetupFailure(missingSddlFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')

    const ownerMismatchFixture = createH0Fixture('owner-mismatch', {
      readWindowsAcl: target => aclProjection(target, { ownerSid: 'S-1-5-21-1000-1000-1000-9999' })
    })
    const ownerFailure = await expectH0SetupFailure(ownerMismatchFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')
    assert(ownerFailure.details.eligibility.reasons.includes('owner-mismatch'))

    const nonemptyFixture = createH0Fixture('nonempty-leaf', {
      services: {
        beforeInitialQualification: ({ candidate }) => {
          fs.writeFileSync(path.join(candidate.leafRoot, 'foreign.txt'), 'fixture\n', { flag: 'wx' })
        }
      }
    })
    const nonemptyFailure = await expectH0SetupFailure(nonemptyFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')
    assert(nonemptyFailure.details.eligibility.reasons.includes('leaf-not-empty'))

    const reparseFixture = createH0Fixture('reparse-shape', {
      services: { inspectPathChain: () => ({ reparseFree: false, paths: [] }) }
    })
    const reparseFailure = await expectH0SetupFailure(reparseFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')
    assert(reparseFailure.details.eligibility.reasons.includes('reparse-or-alias'))

    const missingBaseFixture = createH0Fixture('missing-base', { prepareBase: false })
    await expectH0SetupFailure(missingBaseFixture, 'HOST_FORBIDDEN_ROOT_UNVERIFIED')

    const safeFixture = createH0Fixture('safe-deny', {
      readWindowsAcl: target => aclProjection(target, {
        denyWrites: [{ sid: aclSids.sandboxMember, rights: 278, isInherited: false }]
      })
    })
    const safeH0 = await runH0(safeFixture.runOptions)
    assert.strictEqual(safeH0.status, 'PASS')
    assert.strictEqual(safeH0.stages.allowed.status, 'PASS')
    assert.strictEqual(safeH0.stages.forbidden.status, 'PASS')
    assert.strictEqual(safeH0.eligibility.status, 'PASS')
    assert.match(safeH0.eligibility.sddlDigest, /^[a-f0-9]{64}$/u)
    assert.strictEqual(safeH0.identity.topology.forbiddenEligibility.eligibilityDigest,
      safeH0.eligibility.eligibilityDigest)
    assert.deepStrictEqual(
      safeH0.identity.topology.stageArgvContracts['H0-forbidden'].slice(0, 3),
      ['-a', 'never', 'exec']
    )
    assert(safeH0.identity.topology.stageArgvContracts['H0-forbidden'].some((value, index, argv) =>
      value === '-s' && argv[index + 1] === 'workspace-write'))
    assert(!safeH0.identity.topology.stageArgvContracts['H0-forbidden'].includes('--approve-for-me'))
    assert.deepStrictEqual(safeH0.identity.topology.stageApprovalPolicies['H0-forbidden'],
      TRUSTED_FORBIDDEN_POLICY)
    assert.strictEqual(safeH0.cleanup.complete, true)
    assert.strictEqual(safeH0.cleanup.forbiddenRoot.basePreserved, true)
    assert.deepStrictEqual(fs.readdirSync(safeFixture.forbiddenBaseRoot), [])
    assert.strictEqual(safeFixture.aclReadCount, 2)

    const driftFixture = createH0Fixture('acl-drift', {
      readWindowsAcl: (target, count) => aclProjection(target, count === 1 ? {} : {
        extraEntries: [{
          sid: aclSids.sandboxMember,
          accessType: 'Allow',
          rights: 1,
          isInherited: false,
          inheritanceFlags: 'None',
          propagationFlags: 'None'
        }]
      })
    })
    const driftH0 = await runH0(driftFixture.runOptions)
    assert.strictEqual(driftH0.status, 'UNVERIFIED')
    assert.strictEqual(driftH0.code, 'HOST_FORBIDDEN_ROOT_DRIFT')
    assert.strictEqual(driftH0.stages.allowed.status, 'PASS')
    assert.strictEqual(driftH0.stages.forbidden.code, 'HOST_FORBIDDEN_ROOT_DRIFT')
    assert.strictEqual(fs.existsSync(path.join(driftH0.evidenceRoot, 'H0-forbidden')), false)
    assert.strictEqual(fs.existsSync(path.join(driftH0.evidenceRoot, 'h0-forbidden-eligibility.json')), true)
    assert.strictEqual(driftH0.cleanup.complete, true)
    assert.deepStrictEqual(fs.readdirSync(driftFixture.forbiddenBaseRoot), [])

    const sddlDriftFixture = createH0Fixture('sddl-drift', {
      readWindowsAcl: (target, count) => aclProjection(target, {
        sddl: count === 1 ? 'fixture-sddl-before' : 'fixture-sddl-after'
      })
    })
    const sddlDriftH0 = await runH0(sddlDriftFixture.runOptions)
    assert.strictEqual(sddlDriftH0.status, 'UNVERIFIED')
    assert.strictEqual(sddlDriftH0.code, 'HOST_FORBIDDEN_ROOT_DRIFT')
    assert.strictEqual(sddlDriftH0.stages.allowed.status, 'PASS')
    const sddlDriftReceipt = JSON.parse(fs.readFileSync(
      path.join(sddlDriftH0.evidenceRoot, 'h0-forbidden-eligibility.json'),
      'utf8'
    ))
    assert.strictEqual(sddlDriftReceipt.childStarted, false)
    assert.strictEqual(sddlDriftReceipt.attemptCreated, false)
    assert.strictEqual(fs.existsSync(path.join(sddlDriftH0.evidenceRoot, 'H0-forbidden')), false)
    assert.strictEqual(sddlDriftH0.cleanup.complete, true)
    assert.deepStrictEqual(fs.readdirSync(sddlDriftFixture.forbiddenBaseRoot), [])

    const executionIdentity = makeIdentity({ suffix: 'execution', mode: 'unit' })
    const executionLedger = initializeAttemptLedger({ evidenceRoot, identity: executionIdentity })
    const allowedReceipt = await executeProbeStage({
      ledger: executionLedger,
      stage: 'H0-allowed',
      expectation: 'allowed',
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      env: { ...process.env, FAKE_CODEX_PROBE_RESULT: 'allow' },
      ignoreUserConfig: true,
      ignoreRules: true,
      timeoutMs: 10000
    })
    assert.strictEqual(allowedReceipt.status, 'PASS')
    assert.strictEqual(allowedReceipt.observation.commandObserved, true)
    assert.strictEqual(allowedReceipt.marker.exact, true)
    assert.strictEqual(allowedReceipt.effects.clean, true)
    assert.strictEqual(allowedReceipt.cleanup.markerAbsent, true)
    assert.strictEqual(allowedReceipt.cleanup.fixtureAbsent, true)

    const forbiddenReceipt = await executeProbeStage({
      ledger: executionLedger,
      stage: 'H0-forbidden',
      expectation: 'forbidden',
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      env: { ...process.env, FAKE_CODEX_PROBE_RESULT: 'deny' },
      ignoreUserConfig: true,
      ignoreRules: true,
      timeoutMs: 10000
    })
    assert.strictEqual(forbiddenReceipt.status, 'PASS')
    assert.strictEqual(forbiddenReceipt.observation.commandExitCode, 1)
    assert.strictEqual(forbiddenReceipt.marker.exists, false)

    const ownedHome = path.join(tmp, 'owned-home')
    fs.mkdirSync(ownedHome)
    const ownedHomeNonce = 'c'.repeat(48)
    const ownedHomeIdentity = createRunIdentity({
      mode: 'H0',
      sourceCandidate: sha256(Buffer.from('owned-home-candidate')),
      authorizationDigest: sha256(Buffer.from('owned-home-authorization')),
      codexVersion: process.version,
      codexExecutable: process.execPath,
      argvContract: buildCodexArgs({
        consumerRoot,
        addDir,
        ignoreUserConfig: true,
        ignoreRules: true,
        bypassHookTrust: false,
        prompt: '<deterministic-single-command>'
      }),
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        forbiddenRoot,
        isolatedHome: ownedHome
      },
      oracle: {
        allowed: { nonce: ownedHomeNonce },
        forbidden: { nonce: 'd'.repeat(48) }
      }
    })
    const ownedHomeLedger = initializeAttemptLedger({
      evidenceRoot,
      identity: ownedHomeIdentity,
      forbiddenRoots: [sourceRoot, consumerRoot, addDir, forbiddenRoot, ownedHome]
    })
    expectCode(() => assertRuntimeBinding({
      ledger: ownedHomeLedger,
      stage: 'H0-allowed',
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      env: process.env,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      additionalEffectRoots: [{ label: 'isolatedHome', root: ownedHome }]
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    const ownedHomeReceipt = await executeProbeStage({
      ledger: ownedHomeLedger,
      stage: 'H0-allowed',
      expectation: 'allowed',
      nonce: ownedHomeNonce,
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      env: {
        ...process.env,
        CODEX_HOME: ownedHome,
        FAKE_CODEX_PROBE_RESULT: 'allow',
        FAKE_CODEX_TOUCH_HOME: '1'
      },
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      additionalEffectRoots: [{ label: 'isolatedHome', root: ownedHome, ownedMutable: true }],
      timeoutMs: 10000
    })
    assert.strictEqual(ownedHomeReceipt.status, 'PASS')
    assert.strictEqual(fs.existsSync(path.join(ownedHome, 'host-state.json')), true)
    assert.strictEqual(ownedHomeReceipt.effects.unexpectedChanges.length, 0)

    const approveForMeIdentity = createRunIdentity({
      mode: 'H0',
      sourceCandidate: sha256(Buffer.from('approve-for-me-candidate')),
      authorizationDigest: sha256(Buffer.from('approve-for-me-authorization')),
      codexVersion: process.version,
      codexExecutable: process.execPath,
      argvContract: buildCodexArgs({
        consumerRoot,
        addDir,
        approveForMe: true,
        ignoreUserConfig: true,
        ignoreRules: true,
        bypassHookTrust: false,
        prompt: '<deterministic-single-command>'
      }),
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        forbiddenRoot,
        isolatedHome: ownedHome
      },
      oracle: {
        allowed: { nonce: 'e'.repeat(48) },
        forbidden: { nonce: 'f'.repeat(48) }
      }
    })
    const approveForMeLedger = initializeAttemptLedger({
      evidenceRoot,
      identity: approveForMeIdentity,
      forbiddenRoots: [sourceRoot, consumerRoot, addDir, forbiddenRoot, ownedHome]
    })
    const approveForMeRuntime = {
      ledger: approveForMeLedger,
      stage: 'H0-allowed',
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      env: process.env,
      approveForMe: true,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      additionalEffectRoots: [{ label: 'isolatedHome', root: ownedHome, ownedMutable: true }]
    }
    assert.strictEqual(assertRuntimeBinding(approveForMeRuntime, 'probe'), undefined)
    expectCode(() => assertRuntimeBinding({
      ...approveForMeRuntime,
      approveForMe: false
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    expectCode(() => assertRuntimeBinding({
      ...approveForMeRuntime,
      ledger: ownedHomeLedger,
      approveForMe: true
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')

    const stageBoundAllowedArgs = buildCodexArgs({
      consumerRoot,
      addDir,
      approveForMe: true,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      prompt: '<deterministic-single-command>'
    })
    const stageBoundForbiddenArgs = buildCodexArgs({
      consumerRoot,
      addDir,
      approveForMe: false,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      prompt: '<deterministic-single-command>'
    })
    const stageBoundIdentityInput = {
      mode: 'H0',
      sourceCandidate: sha256(Buffer.from('stage-bound-candidate')),
      authorizationDigest: sha256(Buffer.from('stage-bound-authorization')),
      codexVersion: process.version,
      codexExecutable: process.execPath,
      argvContract: stageBoundAllowedArgs,
      topology: {
        processCwd: consumerRoot,
        cliCwd: consumerRoot,
        addDir,
        forbiddenRoot,
        isolatedHome: ownedHome,
        stageArgvContracts: {
          'H0-allowed': stageBoundAllowedArgs,
          'H0-forbidden': stageBoundForbiddenArgs
        },
        stageApprovalPolicies: {
          'H0-allowed': AUTO_REVIEW_POLICY,
          'H0-forbidden': TRUSTED_FORBIDDEN_POLICY
        }
      },
      oracle: {
        allowed: { nonce: '1'.repeat(48) },
        forbidden: { nonce: '2'.repeat(48) }
      }
    }
    const stageBoundIdentity = createRunIdentity(stageBoundIdentityInput)
    const stageBoundRuntime = {
      ledger: { identity: stageBoundIdentity },
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable: process.execPath,
      env: process.env,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      configOverrides: [],
      additionalEffectRoots: [{ label: 'isolatedHome', root: ownedHome, ownedMutable: true }]
    }
    assert.strictEqual(assertRuntimeBinding({
      ...stageBoundRuntime,
      stage: 'H0-allowed',
      approveForMe: true
    }, 'probe'), undefined)
    assert.strictEqual(assertRuntimeBinding({
      ...stageBoundRuntime,
      stage: 'H0-forbidden',
      approveForMe: false
    }, 'probe'), undefined)
    expectCode(() => assertRuntimeBinding({
      ...stageBoundRuntime,
      stage: 'H0-forbidden',
      approveForMe: true
    }, 'probe'), 'REAL_HOST_RUNTIME_BINDING_DRIFT')
    expectCode(() => createRunIdentity({
      ...stageBoundIdentityInput,
      authorizationDigest: sha256(Buffer.from('missing-stage-authorization')),
      topology: {
        ...stageBoundIdentityInput.topology,
        stageArgvContracts: { 'H0-allowed': stageBoundAllowedArgs }
      }
    }), 'REAL_HOST_IDENTITY_INVALID')
    expectCode(() => createRunIdentity({
      ...stageBoundIdentityInput,
      authorizationDigest: sha256(Buffer.from('swapped-stage-authorization')),
      argvContract: stageBoundForbiddenArgs,
      topology: {
        ...stageBoundIdentityInput.topology,
        stageArgvContracts: {
          'H0-allowed': stageBoundForbiddenArgs,
          'H0-forbidden': stageBoundAllowedArgs
        },
        stageApprovalPolicies: {
          'H0-allowed': TRUSTED_FORBIDDEN_POLICY,
          'H0-forbidden': AUTO_REVIEW_POLICY
        }
      }
    }), 'REAL_HOST_IDENTITY_INVALID')
    const tamperedStageIdentity = JSON.parse(JSON.stringify(stageBoundIdentity))
    tamperedStageIdentity.topology.stageArgvContracts['H0-forbidden'].push('-c', 'tampered=true')
    expectCode(() => assertRuntimeBinding({
      ...stageBoundRuntime,
      ledger: { identity: tamperedStageIdentity },
      stage: 'H0-forbidden',
      approveForMe: false
    }, 'probe'), 'REAL_HOST_IDENTITY_INVALID')

    const turnIdentity = makeIdentity({ suffix: 'turn', mode: 'unit' })
    const turnLedger = initializeAttemptLedger({ evidenceRoot, identity: turnIdentity })
    const turnReceipt = await executeTurnStage({
      ledger: turnLedger,
      stage: 'turn',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      env: process.env,
      prompt: 'do not execute a command',
      timeoutMs: 10000,
      deferFinalization: true
    })
    assert.strictEqual(turnReceipt.status, 'PASS')
    assert.strictEqual(turnReceipt.deferred, true)
    assert.strictEqual(turnReceipt.lastMessage, 'fake-last-message')
    const finalized = finalizeDeferredAttempt({
      evidenceRoot,
      identity: turnIdentity,
      stage: 'turn',
      status: 'PASS',
      receiptDigest: turnReceipt.receiptDigest
    })
    assert.strictEqual(finalized.status, 'PASS')
    expectCode(() => finalizeDeferredAttempt({
      evidenceRoot,
      identity: turnIdentity,
      stage: 'turn',
      status: 'PASS'
    }), 'REAL_HOST_ATTEMPT_ALREADY_CONSUMED')

    const deferredTamperIdentity = makeIdentity({ suffix: 'deferred-tamper', mode: 'unit' })
    const deferredTamperLedger = initializeAttemptLedger({ evidenceRoot, identity: deferredTamperIdentity })
    const deferredTamperReceipt = await executeTurnStage({
      ledger: deferredTamperLedger,
      stage: 'turn-tamper',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      env: process.env,
      prompt: 'do not execute a command',
      timeoutMs: 10000,
      deferFinalization: true
    })
    const deferredExecutedPath = path.join(
      deferredTamperLedger.runDir,
      'turn-tamper',
      'attempt-01',
      '02-executed.json'
    )
    const deferredExecuted = JSON.parse(fs.readFileSync(deferredExecutedPath, 'utf8'))
    deferredExecuted.receiptDigest = sha256(Buffer.from('wrong-receipt'))
    fs.writeFileSync(deferredExecutedPath, JSON.stringify(deferredExecuted, null, 2) + '\n')
    expectCode(() => finalizeDeferredAttempt({
      evidenceRoot,
      identity: deferredTamperIdentity,
      stage: 'turn-tamper',
      status: 'PASS',
      receiptDigest: deferredTamperReceipt.receiptDigest
    }), 'REAL_HOST_LEDGER_INTEGRITY_FAILED')

    const cliIdentity = makeIdentity({ suffix: 'cli-turn', mode: 'unit' })
    initializeAttemptLedger({ evidenceRoot, identity: cliIdentity })
    const cliRequestPath = path.join(tmp, 'cli-request.json')
    const cliResultPath = path.join(tmp, 'cli-result.json')
    fs.writeFileSync(cliRequestPath, JSON.stringify({
      schemaVersion: 'RealCodexHostProbeRequestV1',
      operation: 'turn',
      evidenceRoot,
      identity: cliIdentity,
      forbiddenRoots: [sourceRoot],
      stage: 'cli-turn',
      consumerRoot,
      addDir,
      codexExecutable: process.execPath,
      launchPrefixArgs: [fakeCodex],
      prompt: 'do not execute a command',
      timeoutMs: 10000,
      deferFinalization: true
    }, null, 2) + '\n')
    const cliRequestRun = require('child_process').spawnSync(process.execPath, [
      path.join(__dirname, 'lib', 'real-codex-host-probe.js'),
      '--mode', 'request',
      '--request-file', cliRequestPath,
      '--result-file', cliResultPath
    ], {
      cwd: consumerRoot,
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    })
    assert.strictEqual(cliRequestRun.status, 0, cliRequestRun.stderr)
    assert.match(cliRequestRun.stdout, /真实 Codex 宿主验证/)
    const cliResult = JSON.parse(fs.readFileSync(cliResultPath, 'utf8'))
    assert.strictEqual(cliResult.status, 'PASS')
    assert.strictEqual(cliResult.deferred, true)
    finalizeDeferredAttempt({
      evidenceRoot,
      identity: cliIdentity,
      stage: 'cli-turn',
      status: 'PASS',
      receiptDigest: cliResult.receiptDigest
    })

    const timeoutChild = await runOwnedChild({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: consumerRoot,
      env: process.env,
      timeoutMs: 100
    })
    assert.strictEqual(timeoutChild.timedOut, true)
    assert.strictEqual(timeoutChild.cleanup.attempted, true)
    assert.match(timeoutChild.cleanup.method, /exact/)
    assert.strictEqual(timeoutChild.cleanup.stillRunning, false)
    assert.strictEqual(isPidAlive(4242, {
      platform: 'linux',
      fs: { readFileSync: () => '4242 (fixture worker) Z 1 2 3' },
      kill: () => { throw Object.assign(new Error('must not probe a zombie'), { code: 'ESRCH' }) }
    }), false)
    assert.strictEqual(isPidAlive(4243, {
      platform: 'linux',
      fs: { readFileSync: () => '4243 (fixture worker) R 1 2 3' },
      kill: () => undefined
    }), true)
    let boundedCleanupPid = null
    const boundedCleanupChild = await runOwnedChild({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: consumerRoot,
      env: process.env,
      timeoutMs: 100,
      cleanupSettleTimeoutMs: 50,
      terminateProcessTree: pid => {
        boundedCleanupPid = pid
        return {
          attempted: true,
          method: 'fixture-cleanup-failure',
          pid,
          exitCode: 1,
          errorCode: 'FIXTURE_CLEANUP_FAILED',
          stillRunning: true
        }
      }
    })
    try {
      assert.strictEqual(boundedCleanupChild.timedOut, true)
      assert.strictEqual(boundedCleanupChild.cleanup.cleanupObservationTimedOut, true)
      assert.strictEqual(boundedCleanupChild.cleanup.stillRunning, true)
      assert.strictEqual(isOwnedCleanupComplete(boundedCleanupChild.cleanup), false)
    } finally {
      const boundedCleanup = terminateOwnedProcessTree(boundedCleanupPid)
      assert.strictEqual(boundedCleanup.stillRunning, false)
    }
    const callbackFailureChild = await runOwnedChild({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: consumerRoot,
      env: process.env,
      timeoutMs: 10000,
      onSpawn: () => {
        throw new Error('fixture ledger failure')
      }
    })
    assert.strictEqual(callbackFailureChild.cleanup.attempted, true)
    assert.strictEqual(callbackFailureChild.cleanup.stillRunning, false)
    assert.match(callbackFailureChild.orchestrationError.message, /fixture ledger failure/)

    assert.deepStrictEqual(parseCliArguments([
      '--mode', 'h0',
      '--evidence-root', evidenceRoot
    ]), { mode: 'h0', 'evidence-root': evidenceRoot })
    expectCode(() => parseCliArguments(['unexpected']), 'REAL_HOST_CLI_ARGUMENT_INVALID')
    expectCode(() => parseCliArguments(['--unknown', 'value']), 'REAL_HOST_CLI_ARGUMENT_INVALID')
    expectCode(() => parseCliArguments(['--mode', 'h0', '--mode', 'request']),
      'REAL_HOST_CLI_ARGUMENT_INVALID')

    const missingCodexFixture = createH0Fixture('missing-codex-after-qualification')
    missingCodexFixture.runOptions.codexExecutable = path.join(tmp, 'missing-codex.exe')
    missingCodexFixture.runOptions.timeoutMs = 1000
    let setupFailure
    try {
      await runH0(missingCodexFixture.runOptions)
    } catch (error) {
      setupFailure = error
    }
    assert(setupFailure instanceof RealCodexHostProbeError)
    assert.strictEqual(setupFailure.code, 'REAL_HOST_CODEX_NOT_FOUND')
    assert.strictEqual(setupFailure.details.cleanup.complete, true)
    assert.strictEqual(fs.existsSync(setupFailure.details.cleanup.tempRoot), false)
    assert.deepStrictEqual(fs.readdirSync(missingCodexFixture.forbiddenBaseRoot), [])

    console.log('real Codex host probe tests passed identity=1 topology=1 runtimeVersion=bound customAuth=1 detachedEnv=1 argv=legacy+auto-review+stage-bound capabilityProbe=bounded jsonl=1 pwshWrapper=exact wrapperConcat=closed nativeDenial=bound ownedHome=mutable-safe installedRoots=strict effects=1 ledger=1 runJsonTamper=closed authorizationTamper=closed missingReceipt=closed retry=1 h3Retry=bound nonterminal=bound predecessorRetry=1 extraCommand=closed fakeAllowed=1 fakeForbidden=1 forbiddenPolicy=trusted-only forbiddenEligibility=acl+ambient+owner+reparse forbiddenPreauth=5 zeroConsumption=1 forbiddenDrift=closed dualRootCleanup=1 deferred=1 deferredTamper=closed turnCleanup=closed helperChild=1 timeoutCleanup=1 boundedCleanup=1 callbackCleanup=1 setupCleanup=1 realCodex=0')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  assert.strictEqual(fs.existsSync(tmp), false, 'real-host probe unit fixture must be removed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
