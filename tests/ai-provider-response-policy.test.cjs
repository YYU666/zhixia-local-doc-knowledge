const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  collectBoundedProviderResponse,
} = require("../electron/aiProviderResponsePolicy.cjs");

function responseFixture() {
  const response = new EventEmitter();
  response.complete = false;
  response.destroyedByPolicy = false;
  response.destroy = () => {
    response.destroyedByPolicy = true;
  };
  return response;
}

async function rejectionFor(event, payload) {
  const response = responseFixture();
  const pending = collectBoundedProviderResponse(response, {
    maxBytes: 16,
    sanitizeError: () => "sanitized provider stream error",
  });
  response.emit(event, payload);
  await assert.rejects(pending);
}

async function main() {
  const successResponse = responseFixture();
  const success = collectBoundedProviderResponse(successResponse, { maxBytes: 16 });
  successResponse.emit("data", Buffer.from("hello "));
  successResponse.complete = true;
  successResponse.emit("data", Buffer.from("world"));
  successResponse.emit("end");
  successResponse.emit("close");
  assert.equal(await success, "hello world", "a complete bounded response must resolve once");

  await rejectionFor("aborted");
  await rejectionFor("error", new Error("provider-reflected-secret"));
  await rejectionFor("close");

  const oversizedResponse = responseFixture();
  const oversized = collectBoundedProviderResponse(oversizedResponse, { maxBytes: 4 });
  oversizedResponse.emit("data", Buffer.from("12345"));
  await assert.rejects(oversized, /exceeded the allowed size/);
  assert.equal(oversizedResponse.destroyedByPolicy, true, "oversized response streams must be destroyed");

  console.log("AI provider response policy tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
