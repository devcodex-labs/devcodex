'use strict'

function buildLifecyclePayloadUtils({ fs, path, payloadPreviewLimit, transcriptTailLimit, safeJsonParse, normalizeText }) {
  function collectStrings(value, out = []) {
    if (typeof value === 'string') out.push(value)
    if (Array.isArray(value)) { value.forEach(i => collectStrings(i, out)); return out }
    if (value && typeof value === 'object') Object.values(value).forEach(i => collectStrings(i, out))
    return out
  }

  function collectInterestingStrings(value, prefix = '', out = []) {
    if (typeof value === 'string') {
      if (value.trim()) out.push({ path: prefix, value })
      return out
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => collectInterestingStrings(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out))
      return out
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => {
        collectInterestingStrings(v, prefix ? `${prefix}.${k}` : k, out)
      })
    }
    return out
  }

  function extractTextContent(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      return value.map(item => extractTextContent(item, depth + 1)).filter(Boolean).join('\n')
    }
    if (!value || typeof value !== 'object') return ''
    const parts = []
    for (const key of ['text', 'content', 'value', 'output_text', 'outputText', 'body']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const text = extractTextContent(value[key], depth + 1)
        if (text) parts.push(text)
      }
    }
    return parts.join('\n')
  }

  function isAssistantRecord(entry) {
    if (!entry || typeof entry !== 'object') return false
    const role = String(
      entry.role || entry.author?.role || entry.message?.role ||
      entry.data?.role || entry.data?.message?.role || ''
    ).trim().toLowerCase()
    const type = String(entry.type || entry.kind || entry.event || '').trim().toLowerCase()
    return role === 'assistant' || type === 'assistant' || type === 'assistant.message'
  }

  function extractAssistantRecordContent(entry) {
    if (!isAssistantRecord(entry)) return ''
    return extractTextContent(
      entry.content ?? entry.text ?? entry.value ??
      entry.message?.content ?? entry.data?.content ?? entry.data?.message?.content
    )
  }

  function extractLatestAssistantContentFromMessages(messages) {
    if (!Array.isArray(messages)) return ''
    for (let index = messages.length - 1; index >= 0; index--) {
      const text = extractAssistantRecordContent(messages[index])
      if (text.trim()) return text
    }
    return ''
  }

  function extractLatestAssistantContentFromChoices(choices) {
    if (!Array.isArray(choices)) return ''
    for (let index = choices.length - 1; index >= 0; index--) {
      const choice = choices[index]
      if (!choice || typeof choice !== 'object') continue
      const messageText = extractAssistantRecordContent(choice.message)
      if (messageText.trim()) return messageText
      const deltaText = extractTextContent(choice.delta?.content)
      if (deltaText.trim()) return deltaText
      const text = extractTextContent(choice.text)
      if (text.trim()) return text
    }
    return ''
  }

  function readTranscriptTail(transcriptPath) {
    if (typeof transcriptPath !== 'string' || !transcriptPath.trim()) return ''
    const resolved = path.resolve(transcriptPath)
    let stat
    try { stat = fs.statSync(resolved) } catch { return '' }
    if (!stat.isFile()) return ''
    const start = Math.max(0, stat.size - transcriptTailLimit)
    const length = stat.size - start
    let fd
    try { fd = fs.openSync(resolved, 'r') } catch { return '' }
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, start)
      return buffer.toString('utf8')
    } catch {
      return ''
    } finally {
      fs.closeSync(fd)
    }
  }

  function extractLatestAssistantContentFromTranscriptText(text) {
    if (!text || !String(text).trim()) return ''
    const parsed = safeJsonParse(text)
    if (Array.isArray(parsed)) {
      const messagesText = extractLatestAssistantContentFromMessages(parsed)
      if (messagesText.trim()) return messagesText
    } else if (parsed && typeof parsed === 'object') {
      const nestedMessagesText = extractLatestAssistantContentFromMessages(parsed.messages)
      if (nestedMessagesText.trim()) return nestedMessagesText
      const choicesText = extractLatestAssistantContentFromChoices(parsed.choices)
      if (choicesText.trim()) return choicesText
      const recordText = extractAssistantRecordContent(parsed)
      if (recordText.trim()) return recordText
    }
    const lines = String(text).split(/\r?\n/).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index--) {
      const entry = safeJsonParse(lines[index])
      const content = extractAssistantRecordContent(entry)
      if (content.trim()) return content
    }
    return ''
  }

  function extractLatestAssistantContentFromTranscript(transcriptPath) {
    const tail = readTranscriptTail(transcriptPath)
    return extractLatestAssistantContentFromTranscriptText(tail)
  }

  function getVisibleReplyEvidence(payload) {
    const directFieldNames = [
      // Official Grok/Claude Stop Decision Control field first (F-03).
      'lastAssistantMessage', 'last_assistant_message',
      'assistantMessage', 'assistant_message', 'response',
      'responseText', 'response_text', 'output', 'reply', 'content', 'message',
      // Extra Grok / harness aliases when hosts expose final turn text (W8).
      'finalMessage', 'final_message', 'assistantResponse', 'assistant_response',
      'agentMessage', 'agent_message', 'completion', 'result', 'text'
    ]
    for (const fieldName of directFieldNames) {
      if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) continue
      const text = extractTextContent(payload[fieldName])
      if (text.trim()) return { observed: true, text, source: fieldName }
    }
    const messagesText = extractLatestAssistantContentFromMessages(payload.messages)
    if (messagesText.trim()) return { observed: true, text: messagesText, source: 'messages' }
    const choicesText = extractLatestAssistantContentFromChoices(payload.choices)
    if (choicesText.trim()) return { observed: true, text: choicesText, source: 'choices' }
    if (Object.prototype.hasOwnProperty.call(payload, 'transcript')) {
      const transcriptText = extractLatestAssistantContentFromTranscriptText(payload.transcript)
      if (transcriptText.trim()) return { observed: true, text: transcriptText, source: 'transcript' }
    }
    const transcriptPath = payload.transcript_path || payload.transcriptPath
    const transcriptPathText = extractLatestAssistantContentFromTranscript(transcriptPath)
    if (transcriptPathText.trim()) return { observed: true, text: transcriptPathText, source: 'transcript_path' }
    return { observed: false, text: '', source: '' }
  }

  function getVisibleReplyText(payload) {
    return getVisibleReplyEvidence(payload).text
  }

  function getToolInputStrings(payload) {
    const input = payload.tool_input || payload.toolInput || {}
    return collectStrings(input).map(normalizeText).filter(Boolean)
  }

  function getCommandText(payload) {
    const input = payload.tool_input || payload.toolInput || {}
    return [input.command, input.commandLine, input.text, input.script]
      .filter(v => typeof v === 'string')
      .join('\n')
  }

  function touchesPath(payload, ...needles) {
    const strings = getToolInputStrings(payload)
    return strings.some(s => needles.some(n => s.includes(normalizeText(n))))
  }

  return {
    collectStrings,
    collectInterestingStrings,
    extractAssistantRecordContent,
    getVisibleReplyEvidence,
    getVisibleReplyText,
    getToolInputStrings,
    getCommandText,
    touchesPath
  }
}

module.exports = {
  buildLifecyclePayloadUtils
}
