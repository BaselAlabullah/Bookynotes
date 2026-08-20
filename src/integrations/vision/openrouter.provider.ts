import { z } from "zod";

import {
  EXTRACTION_PROMPT,
  TRANSCRIPTION_PROMPT,
  VisionPermanentError,
  VisionRateLimitError,
  VisionTransientError,
  type ExtractionRequest,
  type ExtractionResult,
  type TranscriptionResult,
  type VisionProvider,
} from "./vision.types";

/**
 * OpenRouter, the fallback provider.
 *
 * It speaks the OpenAI chat-completions shape, which is why the request below
 * looks nothing like Gemini's — and why both live behind the same interface.
 * The point of this file is to prove the abstraction is real: if `VisionProvider`
 * only ever had one implementation, it would be a guess about what varies.
 */
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 45_000;

const openRouterResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .optional(),
});

const extractionSchema = z.object({
  passage: z.string(),
  context: z.string(),
});

const transcriptionSchema = z
  .object({
    text: z.string(),
    // Snake case on the wire because that is what the prompt asks for; renamed
    // here so the shape crossing the interface reads like the rest of the app.
    printed_page_number: z.string().default(""),
  })
  .transform((value) => ({
    text: value.text,
    printedPageNumber: value.printed_page_number,
  }));

export function createOpenRouterProvider(
  apiKey: string,
  model: string,
  appUrl: string,
): VisionProvider {
  return {
    name: `openrouter:${model}`,

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      const content = await callOpenRouter(
        apiKey,
        model,
        appUrl,
        request,
        EXTRACTION_PROMPT,
      );

      const extraction = extractionSchema.safeParse(safeJsonParse(content));

      if (!extraction.success) {
        throw new VisionTransientError(
          "OpenRouter's JSON did not match the requested shape.",
        );
      }

      return extraction.data;
    },

    async transcribe(
      request: ExtractionRequest,
    ): Promise<TranscriptionResult> {
      const content = await callOpenRouter(
        apiKey,
        model,
        appUrl,
        request,
        TRANSCRIPTION_PROMPT,
      );

      const transcription = transcriptionSchema.safeParse(
        safeJsonParse(content),
      );

      if (!transcription.success) {
        throw new VisionTransientError(
          "OpenRouter's JSON did not match the requested shape.",
        );
      }

      return transcription.data;
    },
  };
}

/**
 * One request to OpenRouter, shared by both methods.
 *
 * They differ only in the prompt, so the transport lives here rather than being
 * written out twice.
 */
async function callOpenRouter(
  apiKey: string,
  model: string,
  appUrl: string,
  request: ExtractionRequest,
  prompt: string,
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter uses these to attribute traffic. On the free tier they are
        // also what stops your requests being treated as anonymous scraping.
        "HTTP-Referer": appUrl,
        "X-Title": "Bookynotes",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0,
        // Not every free vision model honours a schema, so the format is
        // requested loosely and the result is validated strictly by the caller.
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${request.mimeType};base64,${request.image.toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
    });
  } catch (cause) {
    throw new VisionTransientError("OpenRouter did not respond in time.", {
      cause,
    });
  }

  if (!response.ok) {
    throw await classifyFailure(response);
  }

  const body: unknown = await response.json();
  const parsed = openRouterResponseSchema.safeParse(body);
  const content = parsed.success
    ? parsed.data.choices?.[0]?.message.content
    : null;

  if (!content) {
    throw new VisionTransientError("OpenRouter returned no content.");
  }

  return content;
}

async function classifyFailure(response: Response): Promise<Error> {
  const detail = (await response.text()).slice(0, 300);

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");

    return new VisionRateLimitError(
      "OpenRouter's free model is rate limited right now.",
      retryAfter === null ? null : Number(retryAfter) || null,
    );
  }

  if (response.status >= 500 || response.status === 408) {
    return new VisionTransientError(`OpenRouter responded ${response.status}.`);
  }

  return new VisionPermanentError(
    `OpenRouter rejected the request (${response.status}): ${detail}`,
  );
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
