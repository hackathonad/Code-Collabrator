const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { createAIService } = require("../dist/modules/ai/aiService");
const { AICancelledError, AIProviderRequestError, AIProviderUnavailableError } = require("../dist/modules/ai/aiTypes");
const { GeminiProvider } = require("../dist/modules/ai/geminiProvider");
const { GroqProvider } = require("../dist/modules/ai/groqProvider");
const { OllamaProvider } = require("../dist/modules/ai/ollamaProvider");
const { buildAIContext } = require("../dist/modules/ai/contextEngine");
const { createPromptMessages } = require("../dist/modules/ai/promptLibrary");
const { roomStore } = require("../dist/modules/rooms/roomStore");

const request = (model = "qwen2.5-coder") => ({
  settings: { provider: "ollama", model, temperature: 0.2, maxTokens: 256, streaming: false, workspaceContextSize: "standard" },
  metadata: { workspaceId: "workspace", action: "explain", language: "javascript" },
  messages: [{ role: "user", content: "Explain this." }]
});

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("Ollama discovers installed models, registers, and completes a request", async () => {
  const calls = [];
  const adapter = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    fetchImplementation: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/tags")) return json({ models: [{ name: "qwen2.5-coder" }, { name: "llama3.2" }] });
      return json({ message: { content: "A concise explanation." }, done: true });
    }
  });
  const service = createAIService([adapter]);
  const providers = await service.refreshProviders();
  const ollama = providers.find((provider) => provider.id === "ollama");
  assert.equal(ollama.configured, true);
  assert.equal(ollama.available, true);
  assert.deepEqual(ollama.models.map((model) => model.id), ["qwen2.5-coder", "llama3.2"]);
  const result = await service.complete("ollama", request());
  assert.equal(result.content, "A concise explanation.");
  assert.equal(result.model, "qwen2.5-coder");
  assert.equal(calls.filter((call) => call.url.endsWith("/api/tags")).length, 1, "model discovery should use the short cache");
  assert.equal(JSON.parse(calls.at(-1).init.body).stream, false);
});

test("Ollama reports unavailable and invalid-model states without leaking transport details", async () => {
  const unavailable = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", fetchImplementation: async () => { throw new TypeError("connection refused"); } });
  assert.equal((await unavailable.refreshDescriptor()).health, "unavailable");
  await assert.rejects(() => unavailable.complete(request()), AIProviderUnavailableError);

  const invalidModel = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", fetchImplementation: async () => json({ models: [{ name: "qwen2.5-coder" }] }) });
  await assert.rejects(() => invalidModel.complete(request("not-installed")), AIProviderRequestError);
});

test("Ollama handles malformed discovery and completion responses safely", async () => {
  const malformedTags = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", fetchImplementation: async () => json({ invalid: true }) });
  assert.equal((await malformedTags.refreshDescriptor()).health, "unavailable");

  const malformedChat = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    fetchImplementation: async (url) => String(url).endsWith("/api/tags") ? json({ models: [{ name: "qwen2.5-coder" }] }) : json({ message: {} })
  });
  await assert.rejects(() => malformedChat.complete(request()), AIProviderRequestError);
});

test("Ollama reports timeouts safely and converts streaming chunks", async () => {
  let tagsRequested = false;
  const timedOut = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    timeoutMs: 1_000,
    fetchImplementation: async (url, init) => {
      if (String(url).endsWith("/api/tags")) { tagsRequested = true; return json({ models: [{ name: "qwen2.5-coder" }] }); }
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }));
    }
  });
  await assert.rejects(() => timedOut.complete(request()), (error) => error instanceof AIProviderRequestError && error.code === "REQUEST_TIMEOUT" && /timed out/.test(error.message));
  assert.equal(tagsRequested, true);

  const caller = new AbortController();
  const cancelled = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    fetchImplementation: async (url, init) => String(url).endsWith("/api/tags")
      ? json({ models: [{ name: "qwen2.5-coder" }] })
      : new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
        const error = new Error("aborted"); error.name = "AbortError"; reject(error);
      }))
  });
  const cancellation = cancelled.complete({ ...request(), signal: caller.signal });
  setTimeout(() => caller.abort(), 5);
  await assert.rejects(() => cancellation, AICancelledError);

  const encoder = new TextEncoder();
  const streaming = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    fetchImplementation: async (url) => String(url).endsWith("/api/tags")
      ? json({ models: [{ name: "qwen2.5-coder" }] })
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"message":{"content":"Hi"}}\n{"message":{"content":" there"},"done":true}\n')); controller.close(); } }), { status: 200 })
  });
  const events = [];
  for await (const event of streaming.stream(request())) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["delta", "delta", "complete"]);
  assert.equal(events.at(-1).result.content, "Hi there");
});

test("streaming providers flush a final chunk without a trailing newline", async () => {
  const encoder = new TextEncoder();
  const ollama = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    fetchImplementation: async (url) => String(url).endsWith("/api/tags")
      ? json({ models: [{ name: "qwen2.5-coder" }] })
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"message":{"content":"final"},"done":true}')); controller.close(); } }), { status: 200 })
  });
  const events = [];
  for await (const event of ollama.stream(request())) events.push(event);
  assert.equal(events.at(-1).result.content, "final");
});

test("cloud provider descriptors stay server-only, classify failures, and decode streaming responses", async () => {
  const unconfigured = new GeminiProvider({ apiKey: "" });
  const descriptors = await createAIService([unconfigured]).refreshProviders();
  assert.equal(descriptors[0].configured, false);
  assert.equal(descriptors[0].health, "not-configured");
  await assert.rejects(() => unconfigured.complete(request("gemini-2.5-flash")), AIProviderUnavailableError);

  const encoder = new TextEncoder();
  const geminiCalls = [];
  const gemini = new GeminiProvider({
    apiKey: "server-only-test-key",
    fetchImplementation: async (url) => {
      geminiCalls.push(String(url));
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n'));
        controller.close();
      } }), { status: 200 });
    }
  });
  const geminiEvents = [];
  for await (const event of gemini.stream({ ...request("gemini-2.5-flash"), settings: { ...request().settings, provider: "gemini", model: "gemini-2.5-flash", streaming: true } })) geminiEvents.push(event);
  assert.deepEqual(geminiEvents.map((event) => event.type), ["delta", "delta", "complete"]);
  assert.equal(geminiEvents.at(-1).result.content, "Hello world");
  assert.match(geminiCalls[0], /streamGenerateContent\?alt=sse&key=/);

  const groq = new GroqProvider({ apiKey: "server-only-test-key", fetchImplementation: async () => json({ error: { message: "rate limited" } }, 429) });
  await assert.rejects(() => groq.complete({ ...request("llama-3.3-70b-versatile"), settings: { ...request().settings, provider: "groq", model: "llama-3.3-70b-versatile" } }), (error) => error instanceof AIProviderRequestError && error.code === "RATE_LIMITED");
});

test("AI context remains bounded and excludes sensitive workspace files", () => {
  const created = roomStore.createRoom("Context owner");
  const snapshot = created.room;
  const active = snapshot.workspace.files[snapshot.workspace.activeFileId];
  active.content = "x".repeat(20_000);
  snapshot.workspace.files["sensitive"] = { ...active, id: "sensitive", name: ".env", content: "API_KEY=never-send-this", parentId: snapshot.workspace.rootFolderId };
  snapshot.workspace.openFileIds.push("sensitive");
  const input = { action: "explain", prompt: "Explain the current file", currentFileId: active.id, selectedCode: "y".repeat(12_000), conversation: [], settings: { ...request().settings, workspaceContextSize: "minimal" } };
  const context = buildAIContext(snapshot, input, null);
  assert.ok(context.characterCount <= 8_000, `context must fit the minimal budget (was ${context.characterCount})`);
  assert.ok(context.selectedCode.length < 12_000);
  assert.ok(!context.workspaceSummary.includes(".env"));
  assert.ok(!context.openFiles.some((file) => file.name === ".env"));
});

test("AI context rejects a selection that belongs to another active file", () => {
  const created = roomStore.createRoom("Selection owner");
  const snapshot = created.room;
  const active = snapshot.workspace.files[snapshot.workspace.activeFileId];
  const other = { ...active, id: "other-file", name: "other.js", content: "const other = true;" };
  snapshot.workspace.files[other.id] = other;
  const input = { action: "explain", prompt: "Explain this", currentFileId: active.id, selectedCodeFileId: other.id, selectedCode: other.content, conversation: [], settings: { ...request().settings, workspaceContextSize: "standard" } };
  const context = buildAIContext(snapshot, input, null);
  assert.equal(context.selectedCode, undefined);
  assert.ok(context.excludedSections.includes("selected code from a different file"));
});

test("prompt construction preserves reusable actions and bounded context", () => {
  const messages = createPromptMessages(
    { action: "fix", prompt: "Why does this fail?", conversation: [], settings: request().settings },
    { workspaceId: "workspace", workspaceName: "Demo", language: "javascript", currentFile: { id: "file", name: "main.js", language: "javascript", content: "throw new Error()" }, openFiles: [], workspaceSummary: "1 file", projectMetadata: "local", recentChat: [], recentHistory: [], characterCount: 0 }
  );
  assert.equal(messages.at(-1).content, "Why does this fail?");
  assert.match(messages[0].content, /Diagnose the bug/);
});

test("AI route rejects malformed requests before touching a provider", async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch("http://127.0.0.1:" + port + "/api/ai/rooms/not-a-room/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("AI room routes require a signed guest session", async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch("http://127.0.0.1:" + port + "/api/ai/rooms/abcdef12/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: request().settings, prompt: "hello", action: "explain" }) });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
