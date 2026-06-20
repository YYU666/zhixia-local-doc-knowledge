const DEFAULT_DOCUMENT_LIST_CONTENT_CHARS = 12000;

function safeParseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToDocument(row) {
  const contentText = row[10] || "";
  return {
    id: row[0],
    title: row[1],
    fileName: row[2],
    filePath: row[3],
    extension: row[4],
    size: row[5],
    importedAt: row[6],
    updatedAt: row[7],
    fileModifiedAt: row[8],
    contentHash: row[9],
    contentText,
    summary: row[11] || "",
    tags: safeParseArray(row[12]),
    favorite: Boolean(row[13]),
    parseStatus: row[14],
    parseError: row[15],
    duplicateOf: row[16],
    indexVersion: row[17],
    sourceType: row[18] || "imported",
    workspacePath: row[19],
    artifactType: row[20],
    contentLength: Number(row[21] ?? contentText.length) || 0,
  };
}

function documentSelectSql(options = {}) {
  const contentLimit = Math.max(
    0,
    Math.min(Number(options.contentTextLimit || DEFAULT_DOCUMENT_LIST_CONTENT_CHARS), 500000),
  );
  const includeContentText = options.includeContentText === true;
  const contentExpr = !includeContentText
    ? "'' AS contentText"
    : `substr(contentText, 1, ${contentLimit}) AS contentText`;
  return `
    SELECT id, title, fileName, filePath, extension, size, importedAt, updatedAt,
      fileModifiedAt, contentHash, ${contentExpr}, summary, tagsJson, favorite,
      parseStatus, parseError, duplicateOf, indexVersion, sourceType, workspacePath, artifactType,
      LENGTH(contentText) AS contentLength
    FROM documents
    ORDER BY importedAt DESC
  `;
}

module.exports = {
  DEFAULT_DOCUMENT_LIST_CONTENT_CHARS,
  documentSelectSql,
  rowToDocument,
};
