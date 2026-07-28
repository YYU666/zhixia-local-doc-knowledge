const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

function collectBoundedProviderResponse(response, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? Math.floor(options.maxBytes)
    : DEFAULT_MAX_RESPONSE_BYTES;
  const sanitizeError = typeof options.sanitizeError === "function"
    ? options.sanitizeError
    : () => "AI Provider response failed.";

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = 0;
    const chunks = [];
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finishReject = (message) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    response.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      responseBytes += buffer.length;
      if (responseBytes > maxBytes) {
        finishReject("AI Provider response exceeded the allowed size.");
        response.destroy?.();
        return;
      }
      chunks.push(buffer);
    });
    response.on("aborted", () => finishReject("AI Provider response was interrupted."));
    response.on("error", (error) => finishReject(sanitizeError(error)));
    response.on("close", () => {
      if (response.complete !== true) finishReject("AI Provider response closed before completion.");
    });
    response.on("end", () => finishResolve(Buffer.concat(chunks).toString("utf8")));
  });
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  collectBoundedProviderResponse,
};
