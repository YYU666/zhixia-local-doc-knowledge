const HYBRID_RETRIEVAL_STRATEGY = "bm25f_compact_metadata_v1";
const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const DEFAULT_TOKEN_BUDGET = 1200;
const MAX_TOKEN_BUDGET = 12000;
const DEFAULT_MAX_CANDIDATES = 600;
const MAX_CANDIDATES = 5000;
const DEFAULT_MAX_BODY_CHARS = 12000;
const DEFAULT_MAX_CANDIDATE_CHARS = 32000;

const FIELD_WEIGHTS = Object.freeze({
  title: 3.4,
  summary: 1.45,
  tags: 2.35,
  project: 1.8,
  thread: 1.9,
});

const QUERY_TERM_WEIGHTS = Object.freeze({
  english: 1,
  chinese_phrase: 1.7,
  chinese_bigram: 1,
  chinese_char: 0.16,
});

const STATUS_SCORES = Object.freeze({
  hot: 1.8,
  active: 1.7,
  ready: 1.5,
  current: 1.5,
  accepted: 1.4,
  curated: 1.3,
  indexed: 0.7,
  candidate: 0.1,
  review: -0.4,
  review_needed: -0.8,
  blocked: -1.8,
  stale: -2.4,
  superseded: -3.4,
  archived: -3.6,
});

const FRESHNESS_SCORES = Object.freeze({
  fresh: 1.5,
  current: 1.2,
  review: -0.3,
  unknown: -0.5,
  stale: -2.5,
  conflict: -3.4,
});

const RAW_SESSION_RE = /\braw[_ -]?session\b|\bcodex[_ -]?session\b|\bsession[_ -]?jsonl\b|(?:^|[\\/])\.codex[\\/]sessions[\\/]|(?:^|[\\/])sessions[\\/][^\\/]*(?:session|thread)[^\\/]*\.jsonl\b/i;
const BASE64_DATA_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{48,}/i;
const SECRET_VALUE_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const SECRET_PATH_RE = /(?:^|[\\/])\.env(?:$|[.\\/_-])|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials)(?:$|[.\\/_-])/i;
const SENSITIVE_KEY_RE = /^(?:api[_-]?key|auth(?:orization)?|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|cookie)$/i;
const BODY_KEY_RE = /^(?:body|content|rawBody|rawText|fullText|transcript|payload)$/i;
const ENGLISH_IRREGULAR_STEMS = Object.freeze({
  indices: "index",
  indexes: "index",
  memories: "memory",
  retrievals: "retrieval",
  children: "child",
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScopeValue(value) {
  return normalizeText(value).replace(/\\/g, "/").replace(/\/$/, "");
}

function stemEnglishToken(token) {
  if (ENGLISH_IRREGULAR_STEMS[token]) return ENGLISH_IRREGULAR_STEMS[token];
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3).replace(/([a-z])\1$/, "$1");
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2).replace(/([a-z])\1$/, "$1");
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function addTerm(termMap, token, type, display, count = 1) {
  const current = termMap.get(token);
  if (current) {
    current.count += count;
    return;
  }
  termMap.set(token, { token, type, display, count });
}

function tokenizeHybridText(value) {
  const text = normalizeText(value);
  const terms = new Map();

  for (const match of text.matchAll(/[a-z0-9]+(?:'[a-z0-9]+)?/g)) {
    const original = match[0].replace(/^'+|'+$/g, "");
    if (!original) continue;
    const stemmed = stemEnglishToken(original);
    addTerm(terms, `en:${stemmed}`, "english", stemmed);
  }

  for (const match of text.matchAll(/\p{Script=Han}+/gu)) {
    const phrase = match[0];
    if (phrase.length >= 2 && phrase.length <= 16) {
      addTerm(terms, `zhp:${phrase}`, "chinese_phrase", phrase);
    }
    for (let index = 0; index < phrase.length - 1; index += 1) {
      const bigram = phrase.slice(index, index + 2);
      addTerm(terms, `zh2:${bigram}`, "chinese_bigram", bigram);
    }
    for (const character of phrase) {
      addTerm(terms, `zh1:${character}`, "chinese_char", character);
    }
  }

  const result = Array.from(terms.values());
  return {
    text,
    terms: result,
    length: result.reduce((sum, term) => sum + term.count, 0),
  };
}

function stringValues(value) {
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value === null || value === undefined) return [];
  if (["string", "number", "boolean"].includes(typeof value)) return [String(value)];
  if (typeof value === "object") {
    return Object.values(value).flatMap((entry) => stringValues(entry));
  }
  return [];
}

function compactJoined(values, maxChars = 8000) {
  return values
    .flatMap(stringValues)
    .map((value) => String(value).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, maxChars);
}

function candidateProjectValues(item) {
  return [
    item.projectPath,
    item.rootPath,
    item.workspacePath,
    item.projectId,
    item.project,
    item.project?.id,
    item.project?.name,
    item.project?.path,
    ...safeArray(item.workspacePaths),
  ].flatMap(stringValues).filter(Boolean);
}

function candidateThreadValues(item) {
  return [
    item.threadId,
    item.parentCeoThreadId,
    item.ceoThreadId,
    item.ownerThreadId,
    item.workerThreadId,
    item.thread,
    item.thread?.id,
    ...safeArray(item.threadIds),
  ].flatMap(stringValues).filter(Boolean);
}

function extractCandidateFields(item) {
  const projectValues = candidateProjectValues(item);
  const threadValues = candidateThreadValues(item);
  return {
    title: compactJoined([item.title, item.name], 1200),
    summary: compactJoined([item.summary, item.excerpt, item.description, item.nextAction], 6000),
    tags: compactJoined([item.tags, item.labels, item.keywords, item.topics, item.triggerPatterns], 2400),
    project: compactJoined(projectValues, 2400),
    thread: compactJoined(threadValues, 2400),
    projectValues,
    threadValues,
  };
}

function inspectCandidateObject(value, limits, state, depth = 0, seen = new Set()) {
  if (state.overflow || value === null || value === undefined || depth > 5) return;
  if (typeof value === "string") {
    state.strings.push(value);
    state.totalChars += value.length;
    if (state.totalChars > limits.maxCandidateChars || state.strings.length > 400) state.overflow = true;
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [rawKey, entry] of entries) {
    const key = String(rawKey);
    if (BODY_KEY_RE.test(key) && typeof entry === "string" && entry.length > limits.maxBodyChars) {
      state.giantBody = true;
    }
    if (SENSITIVE_KEY_RE.test(key) && typeof entry === "string" && entry.trim().length >= 4) {
      state.sensitiveKeyValue = true;
    }
    inspectCandidateObject(entry, limits, state, depth + 1, seen);
    if (state.overflow) break;
  }
}

function containsBase64Payload(value) {
  const text = String(value || "");
  if (BASE64_DATA_RE.test(text)) return true;
  const longRuns = text.match(/[A-Za-z0-9+/]{180,}={0,2}/g) || [];
  return longRuns.some((run) => new Set(run.replace(/=+$/, "")).size >= 6);
}

function assessCandidateSafety(item, options = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { safe: false, reasons: ["invalid_candidate"] };
  }
  const limits = {
    maxBodyChars: clampInteger(options.maxBodyChars, DEFAULT_MAX_BODY_CHARS, 1000, 100000),
    maxCandidateChars: clampInteger(options.maxCandidateChars, DEFAULT_MAX_CANDIDATE_CHARS, 4000, 200000),
  };
  const state = { strings: [], totalChars: 0, overflow: false, giantBody: false, sensitiveKeyValue: false };
  inspectCandidateObject(item, limits, state);
  const combined = state.strings.join(" ");
  const reasons = [];
  const explicitRaw = item.containsRawSession === true || item.rawSession === true || item.privacy?.containsRawSession === true;
  const explicitSecret = item.containsSecrets === true || item.privacy?.containsSecrets === true || item.safety?.containsSecrets === true;

  if (explicitRaw || RAW_SESSION_RE.test(combined)) reasons.push("raw_session");
  if (containsBase64Payload(combined)) reasons.push("base64_payload");
  if (explicitSecret || state.sensitiveKeyValue || SECRET_VALUE_RE.test(combined) || SECRET_PATH_RE.test(combined)) {
    reasons.push("secret_material");
  }
  if (state.giantBody || state.overflow) reasons.push("giant_body");

  return {
    safe: reasons.length === 0,
    reasons: reasons.filter((reason, index, array) => array.indexOf(reason) === index),
    inspectedChars: Math.min(state.totalChars, limits.maxCandidateChars + 1),
  };
}

function normalizeHybridRetrievalOptions(query, options = {}) {
  const queryObject = query && typeof query === "object" && !Array.isArray(query) ? query : {};
  const merged = { ...queryObject, ...options };
  const queryText = typeof query === "string"
    ? query
    : queryObject.query || queryObject.text || queryObject.taskGoal || "";
  const projectValue = merged.projectPath || merged.projectId || merged.project || null;
  const threadValue = merged.threadId || merged.parentCeoThreadId || merged.ceoThreadId || null;
  return {
    query: normalizeText(queryText).slice(0, 1000),
    projectValue: projectValue ? normalizeScopeValue(projectValue) : null,
    threadValue: threadValue ? normalizeScopeValue(threadValue) : null,
    strictProject: projectValue ? merged.strictProject !== false && merged.includeCrossProject !== true : false,
    includeGlobal: merged.includeGlobal === true,
    strictThread: threadValue ? merged.strictThread === true : false,
    topK: clampInteger(merged.topK ?? merged.maxResults, DEFAULT_TOP_K, 1, MAX_TOP_K),
    tokenBudget: clampInteger(merged.tokenBudget, DEFAULT_TOKEN_BUDGET, 1, MAX_TOKEN_BUDGET),
    maxCandidates: clampInteger(merged.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, MAX_CANDIDATES),
    maxBodyChars: clampInteger(merged.maxBodyChars, DEFAULT_MAX_BODY_CHARS, 1000, 100000),
    maxCandidateChars: clampInteger(merged.maxCandidateChars, DEFAULT_MAX_CANDIDATE_CHARS, 4000, 200000),
    halfLifeDays: clampInteger(merged.halfLifeDays, 45, 1, 3650),
    now: merged.now || null,
    minScore: Number.isFinite(Number(merged.minScore)) ? Number(merged.minScore) : Number.NEGATIVE_INFINITY,
  };
}

function exactScopeMatch(values, target) {
  if (!target) return false;
  return values.some((value) => normalizeScopeValue(value) === target);
}

function timestampFromCandidate(item) {
  const parsed = Date.parse(item.updatedAt || item.modifiedAt || item.createdAt || item.timestamp || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveReferenceTime(candidates, now) {
  const explicit = Date.parse(now || "");
  if (Number.isFinite(explicit)) return explicit;
  let latest = null;
  for (const candidate of candidates) {
    const timestamp = timestampFromCandidate(candidate.item);
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function normalizedSignalScore(value, scale, maxScore) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number <= 1) return Math.min(maxScore, number * scale);
  return Math.min(maxScore, Math.log1p(number) * (scale / 2.5));
}

function estimateCandidateTokens(item, fields) {
  const provided = Math.ceil(Number(item.tokenEstimate));
  if (Number.isFinite(provided) && provided > 0) return provided;
  const text = [fields.title, fields.summary, fields.tags, fields.project, fields.thread].join(" ");
  const chineseChars = (text.match(/\p{Script=Han}/gu) || []).length;
  const otherChars = Math.max(0, text.length - chineseChars);
  return Math.max(12, Math.ceil(chineseChars / 1.7 + otherChars / 4 + 8));
}

function statusSignal(item) {
  const status = normalizeText(item.status).replace(/ /g, "_");
  return { label: status || "unknown", score: STATUS_SCORES[status] || 0 };
}

function freshnessSignal(item) {
  const freshness = normalizeText(item.freshness).replace(/ /g, "_");
  return { label: freshness || "unknown", score: FRESHNESS_SCORES[freshness] ?? FRESHNESS_SCORES.unknown };
}

function fieldPhraseBonus(queryText, fieldText, fieldWeight) {
  if (!queryText || queryText.length < 2 || !fieldText) return 0;
  const normalizedField = normalizeText(fieldText);
  if (!normalizedField.includes(queryText)) return 0;
  return Math.min(3.5, 0.55 * fieldWeight + Math.min(queryText.length, 20) * 0.04);
}

function compactResultItem(item) {
  const {
    body,
    content,
    rawBody,
    rawText,
    fullText,
    transcript,
    payload,
    embedding,
    embeddings,
    vector,
    vectors,
    ...metadata
  } = item;
  return metadata;
}

function rankPreparedCandidates(prepared, queryTokens, options, referenceTime) {
  const fieldNames = Object.keys(FIELD_WEIGHTS);
  const documentFrequency = new Map();
  const averageLengths = Object.fromEntries(fieldNames.map((field) => [field, 0]));

  for (const candidate of prepared) {
    const uniqueTerms = new Set();
    candidate.fieldTokens = {};
    for (const field of fieldNames) {
      const tokenized = tokenizeHybridText(candidate.fields[field]);
      candidate.fieldTokens[field] = tokenized;
      averageLengths[field] += tokenized.length;
      for (const term of tokenized.terms) uniqueTerms.add(term.token);
    }
    for (const token of uniqueTerms) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }

  const documentCount = Math.max(1, prepared.length);
  for (const field of fieldNames) averageLengths[field] = Math.max(1, averageLengths[field] / documentCount);
  const queryTermMap = new Map(queryTokens.terms.map((term) => [term.token, term]));

  return prepared.map((candidate) => {
    let bm25 = 0;
    let phrase = 0;
    const matched = [];
    const k1 = 1.2;
    const b = 0.72;

    for (const field of fieldNames) {
      const fieldTokens = candidate.fieldTokens[field];
      const fieldTermMap = new Map(fieldTokens.terms.map((term) => [term.token, term]));
      phrase += fieldPhraseBonus(options.query, candidate.fields[field], FIELD_WEIGHTS[field]);
      for (const [token, queryTerm] of queryTermMap) {
        const documentTerm = fieldTermMap.get(token);
        if (!documentTerm) continue;
        const df = documentFrequency.get(token) || 0;
        const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
        const tf = documentTerm.count;
        const lengthNorm = tf + k1 * (1 - b + b * (fieldTokens.length / averageLengths[field]));
        const queryWeight = QUERY_TERM_WEIGHTS[queryTerm.type] || 1;
        const contribution = FIELD_WEIGHTS[field] * queryWeight * idf * ((tf * (k1 + 1)) / lengthNorm);
        bm25 += contribution;
        matched.push({ field, display: queryTerm.display, contribution });
      }
    }

    const projectMatch = exactScopeMatch(candidate.fields.projectValues, options.projectValue);
    const threadMatch = exactScopeMatch(candidate.fields.threadValues, options.threadValue);
    const projectScore = projectMatch ? 6 : options.projectValue && candidate.fields.projectValues.length > 0 ? -3.5 : 0;
    const threadScore = threadMatch ? 7 : options.threadValue && candidate.fields.threadValues.length > 0 ? -1.5 : 0;
    const status = statusSignal(candidate.item);
    const freshness = freshnessSignal(candidate.item);
    const timestamp = timestampFromCandidate(candidate.item);
    const ageDays = referenceTime !== null && timestamp !== null
      ? Math.max(0, (referenceTime - timestamp) / 86400000)
      : null;
    const recency = ageDays === null ? 0 : 2.4 * Math.pow(0.5, ageDays / options.halfLifeDays);
    const expiresAt = Date.parse(candidate.item.expiresAt || "");
    const expired = referenceTime !== null && Number.isFinite(expiresAt) && expiresAt < referenceTime;
    const expirationPenalty = expired ? -5.5 : 0;
    const existingScore = normalizedSignalScore(candidate.item.existingScore ?? candidate.item.score, 1.5, 3);
    const graphActivation = normalizedSignalScore(candidate.item.graphActivation ?? candidate.item.activation, 2.8, 3.5);
    const total = bm25 + phrase + projectScore + threadScore + status.score + freshness.score + recency
      + expirationPenalty + existingScore + graphActivation;

    matched.sort((left, right) => right.contribution - left.contribution || left.field.localeCompare(right.field) || left.display.localeCompare(right.display));
    const whyMatched = matched.slice(0, 5).map((entry) => `bm25:${entry.field}:${entry.display}:${roundScore(entry.contribution)}`);
    if (phrase > 0) whyMatched.push("phrase:exact_metadata_substring");
    if (projectMatch) whyMatched.push("project:exact");
    if (threadMatch) whyMatched.push("thread:exact");
    if (status.score !== 0) whyMatched.push(`status:${status.label}`);
    if (freshness.score !== 0) whyMatched.push(`freshness:${freshness.label}`);
    if (expired) whyMatched.push("recency:expired");
    else if (recency >= 1) whyMatched.push("recency:recent");
    if (existingScore > 0) whyMatched.push("signal:existing_score");
    if (graphActivation > 0) whyMatched.push("signal:graph_activation");

    return {
      ...compactResultItem(candidate.item),
      score: roundScore(total),
      tokenEstimate: candidate.tokenEstimate,
      scoreBreakdown: {
        bm25: roundScore(bm25),
        phrase: roundScore(phrase),
        project: roundScore(projectScore),
        thread: roundScore(threadScore),
        status: roundScore(status.score),
        freshness: roundScore(freshness.score),
        recency: roundScore(recency),
        existingScore: roundScore(existingScore),
        graphActivation: roundScore(graphActivation),
        expirationPenalty: roundScore(expirationPenalty),
        total: roundScore(total),
      },
      whyMatched: whyMatched.slice(0, 12),
      _sortTimestamp: timestamp || 0,
      _sortId: String(candidate.item.id || candidate.item.key || candidate.item.title || candidate.index),
      _inputIndex: candidate.index,
    };
  });
}

function retrieveHybridMemory(candidateItems, query, options = {}) {
  let candidates = candidateItems;
  let queryValue = query;
  let optionValue = options;
  if (!Array.isArray(candidateItems) && candidateItems && typeof candidateItems === "object") {
    candidates = candidateItems.candidates || candidateItems.items || [];
    queryValue = candidateItems.query ?? query;
    optionValue = { ...(candidateItems.options || {}), ...options };
  }

  const normalizedOptions = normalizeHybridRetrievalOptions(queryValue, optionValue);
  const source = safeArray(candidates);
  const boundedSource = source.slice(0, normalizedOptions.maxCandidates);
  const filteredByReason = {};
  const prepared = [];

  for (let index = 0; index < boundedSource.length; index += 1) {
    const item = boundedSource[index];
    const safety = assessCandidateSafety(item, normalizedOptions);
    if (!safety.safe) {
      for (const reason of safety.reasons) filteredByReason[reason] = (filteredByReason[reason] || 0) + 1;
      continue;
    }
    const fields = extractCandidateFields(item);
    const projectMatch = exactScopeMatch(fields.projectValues, normalizedOptions.projectValue);
    const hasProject = fields.projectValues.length > 0;
    if (normalizedOptions.strictProject && !projectMatch && (hasProject || !normalizedOptions.includeGlobal)) {
      filteredByReason.project_scope = (filteredByReason.project_scope || 0) + 1;
      continue;
    }
    const threadMatch = exactScopeMatch(fields.threadValues, normalizedOptions.threadValue);
    if (normalizedOptions.strictThread && !threadMatch) {
      filteredByReason.thread_scope = (filteredByReason.thread_scope || 0) + 1;
      continue;
    }
    prepared.push({ item, fields, index, tokenEstimate: estimateCandidateTokens(item, fields) });
  }

  const referenceTime = resolveReferenceTime(prepared, normalizedOptions.now);
  const queryTokens = tokenizeHybridText(normalizedOptions.query);
  const ranked = rankPreparedCandidates(prepared, queryTokens, normalizedOptions, referenceTime)
    .filter((item) => item.score >= normalizedOptions.minScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right._sortTimestamp !== left._sortTimestamp) return right._sortTimestamp - left._sortTimestamp;
      if (left._sortId < right._sortId) return -1;
      if (left._sortId > right._sortId) return 1;
      return left._inputIndex - right._inputIndex;
    });

  const items = [];
  let tokenEstimate = 0;
  for (const rankedItem of ranked) {
    if (items.length >= normalizedOptions.topK) break;
    if (rankedItem.tokenEstimate > normalizedOptions.tokenBudget - tokenEstimate) continue;
    const { _sortTimestamp, _sortId, _inputIndex, ...resultItem } = rankedItem;
    items.push(resultItem);
    tokenEstimate += rankedItem.tokenEstimate;
  }

  const filteredCount = Object.values(filteredByReason).reduce((sum, count) => sum + count, 0);
  return {
    items,
    tokenEstimate,
    performance: {
      strategy: HYBRID_RETRIEVAL_STRATEGY,
      deterministic: true,
      startsTimers: false,
      startsWorkers: false,
      scansFiles: false,
      scansDatabase: false,
      invokesModels: false,
      candidatesReceived: source.length,
      candidatesConsidered: boundedSource.length,
      candidateLimitApplied: source.length > boundedSource.length,
      candidatesEligible: prepared.length,
      candidatesFiltered: filteredCount,
      filteredByReason,
      candidatesScored: ranked.length,
      resultsReturned: items.length,
      queryTermCount: queryTokens.terms.length,
      topK: normalizedOptions.topK,
      tokenBudget: normalizedOptions.tokenBudget,
      tokenEstimate,
      referenceTime: referenceTime === null ? null : new Date(referenceTime).toISOString(),
    },
  };
}

const rankHybridMemoryCandidates = retrieveHybridMemory;
const retrieveHybridMemoryCandidates = retrieveHybridMemory;

module.exports = {
  DEFAULT_MAX_BODY_CHARS,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_TOP_K,
  FIELD_WEIGHTS,
  HYBRID_RETRIEVAL_STRATEGY,
  assessCandidateSafety,
  normalizeHybridRetrievalOptions,
  rankHybridMemoryCandidates,
  retrieveHybridMemory,
  retrieveHybridMemoryCandidates,
  tokenizeHybridText,
};
