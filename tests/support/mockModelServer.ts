import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Ollama or LM Studio: an OpenAI-compatible server on localhost
 * that lists models and answers every chat request by calling the requested tool.
 * It allows requests from any origin, as Ollama does for Obsidian, so e2e flows can use it too.
 */
export interface MockModelServer {
	baseUrl: string;
	/** Arguments the server puts in its tool call. */
	toolArguments: unknown;
	/** When set, chat requests fail with this message and a 500. */
	failWith: string | null;
	/** Bodies of the chat requests received, newest last. */
	requests: Array<{ model: string; authorization: string | undefined; origin: string | undefined }>;
	close(): Promise<void>;
}

export async function startMockModelServer(models: string[]): Promise<MockModelServer> {
	const mock: MockModelServer = { baseUrl: "", toolArguments: {}, failWith: null, requests: [], close: async () => {} };
	const server: Server = createServer(async (request, response) => {
		response.setHeader("access-control-allow-origin", "*");
		response.setHeader("access-control-allow-headers", "*");
		response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}
		if (request.method === "GET" && request.url === "/v1/models") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
			return;
		}
		if (request.method === "POST" && request.url === "/v1/chat/completions") {
			const body = JSON.parse(await readBody(request)) as { model: string; tools?: Array<{ function: { name: string } }> };
			mock.requests.push({ model: body.model, authorization: request.headers.authorization, origin: request.headers.origin });
			if (mock.failWith) {
				response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: mock.failWith } }));
				return;
			}
			if (!models.includes(body.model)) {
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: `model '${body.model}' not found`, type: "not_found_error" } }));
				return;
			}
			const chunk = (delta: object, finish: string | null, usage?: object) =>
				`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
			const toolCall = { index: 0, id: "call_1", type: "function", function: { name: body.tools?.[0]?.function.name ?? "answer", arguments: JSON.stringify(mock.toolArguments) } };
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(chunk({ role: "assistant", tool_calls: [toolCall] }, null));
			response.write(chunk({}, "tool_calls", { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }));
			response.end("data: [DONE]\n\n");
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	mock.baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
	mock.close = () => new Promise((resolve) => server.close(() => resolve()));
	return mock;
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.on("data", (part: Buffer) => (body += part.toString()));
		request.on("end", () => resolve(body));
		request.on("error", reject);
	});
}
