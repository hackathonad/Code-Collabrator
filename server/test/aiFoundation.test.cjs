const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../dist/app");
const { aiService, createAIService } = require("../dist/modules/ai/aiService");
const { AICancelledError, AIProviderRequestError, AIProviderUnavailableError } = require("../dist/modules/ai/aiTypes");
const { GeminiProvider } = require("../dist/modules/ai/geminiProvider");
const { GroqProvider } = require("../dist/modules/ai/groqProvider");
const { OllamaProvider } = require("../dist/modules/ai/ollamaProvider");
const { createOpenAIProvider } = require("../dist/modules/ai/openaiProvider");
const { createOpenRouterProvider } = require("../dist/modules/ai/openrouterProvider");
const { AnthropicProvider } = require("../dist/modules/ai/anthropicProvider");
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
  await assert.rejects(() => timedOut.complete(request()), (error) => error instanceof AIProviderRequestError && error.code === "TIMEOUT" && /timed out/.test(error.message));
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

test("all cloud providers expose safe availability and discover models", async () => {
  const providerCases = [
    {
      provider: createOpenAIProvider({ apiKey: "openai-server-key", defaultModel: "gpt-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "gpt-test" }] }) : json({ choices: [{ message: { content: "OpenAI response" } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }) }),
      id: "openai"
    },
    {
      provider: createOpenRouterProvider({ apiKey: "router-server-key", defaultModel: "router-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "router-test" }] }) : json({ choices: [{ message: { content: "Router response" } }] }) }),
      id: "openrouter"
    },
    {
      provider: new AnthropicProvider({ apiKey: "anthropic-server-key", defaultModel: "claude-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "claude-test" }] }) : json({ content: [{ type: "text", text: "Anthropic response" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 6 } }) }),
      id: "anthropic"
    }
  ];
  for (const { provider, id } of providerCases) {
    const descriptor = await provider.refreshDescriptor();
    assert.equal(descriptor.id, id);
    assert.equal(descriptor.available, true);
    assert.equal(descriptor.health, "healthy");
    assert.deepEqual(descriptor.models.map((model) => model.id), id === "openai" ? ["gpt-test"] : id === "openrouter" ? ["router-test"] : ["claude-test"]);
    assert.equal(descriptor.name, id);
    assert.deepEqual(descriptor.capabilities, ["chat", "streaming"]);
    const result = await provider.complete({ ...request("gpt-test"), settings: { ...request().settings, provider: id, model: id === "openai" ? "gpt-test" : id === "openrouter" ? "router-test" : "claude-test" } });
    assert.match(result.content, /response/);
    assert.equal(result.provider, id);
  }
});

test("provider service distinguishes not-configured, unavailable, and model-not-found", async () => {
  const unconfigured = createOpenAIProvider({ apiKey: "" });
  const unavailable = createOpenRouterProvider({ apiKey: "router-server-key", fetchImplementation: async () => { throw new TypeError("connection refused"); } });
  const available = createOpenAIProvider({ apiKey: "openai-server-key", defaultModel: "gpt-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "gpt-test" }] }) : json({ choices: [{ message: { content: "ok" } }] }) });
  const service = createAIService([unconfigured, unavailable, available]);
  const descriptors = await service.refreshProviders();
  assert.equal(descriptors.find((entry) => entry.id === "openai").available, true);
  assert.equal(descriptors.find((entry) => entry.id === "openrouter").configured, true);
  assert.equal(descriptors.find((entry) => entry.id === "openrouter").available, false);
  assert.equal(descriptors.find((entry) => entry.id === "openrouter").health, "unavailable");
  await assert.rejects(() => service.complete("gemini", { ...request("gemini-2.5-flash"), settings: { ...request().settings, provider: "gemini", model: "gemini-2.5-flash" } }), (error) => error.code === "PROVIDER_NOT_CONFIGURED");
  await assert.rejects(() => service.complete("openai", { ...request("missing"), settings: { ...request().settings, provider: "openai", model: "missing" } }), (error) => error.code === "MODEL_NOT_FOUND");
  await assert.rejects(() => service.complete("openrouter", { ...request("router-test"), settings: { ...request().settings, provider: "openrouter", model: "router-test" } }), (error) => error.code === "PROVIDER_UNAVAILABLE");
});

test("OpenAI-compatible and Anthropic streaming preserve deltas and safe usage metadata", async () => {
  const encoder = new TextEncoder();
  const openai = createOpenAIProvider({ apiKey: "openai-server-key", defaultModel: "gpt-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "gpt-test" }] }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n')); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); } }), { status: 200 }) });
  const openaiEvents = [];
  for await (const event of openai.stream({ ...request("gpt-test"), settings: { ...request().settings, provider: "openai", model: "gpt-test", streaming: true } })) openaiEvents.push(event);
  assert.deepEqual(openaiEvents.map((event) => event.type), ["delta", "delta", "complete"]);
  assert.equal(openaiEvents.at(-1).result.content, "Hi there");
  assert.equal(openaiEvents.at(-1).result.usage.totalTokens, 5);

  const anthropic = new AnthropicProvider({ apiKey: "anthropic-server-key", defaultModel: "claude-test", fetchImplementation: async (url) => String(url).endsWith("/v1/models") ? json({ data: [{ id: "claude-test" }] }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n')); controller.enqueue(encoder.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n')); controller.close(); } }), { status: 200 }) });
  const anthropicEvents = [];
  for await (const event of anthropic.stream({ ...request("claude-test"), settings: { ...request().settings, provider: "anthropic", model: "claude-test", streaming: true } })) anthropicEvents.push(event);
  assert.equal(anthropicEvents.at(-1).result.content, "Hello");
  assert.equal(anthropicEvents.at(-1).result.finishReason, "end_turn");
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

test("provider API returns every safe descriptor without server credentials", async () => {
  const ids = ["ollama", "gemini", "groq", "openrouter", "openai", "anthropic"];
  const secret = "server-secret-must-not-appear";
  const app = createApp();
  for (const id of ids) {
    const descriptor = { id, name: id, label: id, available: true, health: "healthy", capabilities: ["chat", "streaming"], supportsStreaming: true, supportsToolCalling: false, supportsVision: false, supportsLocalModels: id === "ollama", models: [{ id: `${id}-model`, label: `${id} model` }], defaultModel: `${id}-model` };
    aiService.registerProvider({ id, descriptor, isConfigured: () => true, refreshDescriptor: async () => descriptor, complete: async () => ({ content: "ok", provider: id, model: `${id}-model` }), stream: async function* () { yield { type: "complete", result: { content: "ok", provider: id, model: `${id}-model` } }; } });
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch("http://127.0.0.1:" + port + "/api/ai/providers");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.providers.filter((entry) => ids.includes(entry.id)).map((entry) => entry.id), ids);
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.ok(payload.providers.every((entry) => "name" in entry && "capabilities" in entry && "supportsToolCalling" in entry && "supportsVision" in entry));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
