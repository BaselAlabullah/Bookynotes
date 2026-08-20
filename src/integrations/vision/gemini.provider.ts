import { z } from "zod";

import {
  EXTRACTION_PROMPT,
  VisionPermanentError,
  VisionRateLimitError,
  VisionTransientError,
  type ExtractionRequest,
  type ExtractionResult,
  type VisionProvider,
} from "./vision.types";

/**
 * Gemini Flash, called over plain HTTP rather than through `@google/genai`.
 *
 * The SDK would add a dependency to do what `fetch` already does here: one POST
 * with a JSON body. Keeping it explicit also means the request that goes over
 * the wire is visible in this file, which matters when debugging a free tier
 * that answers 429 with a body worth reading.
 */
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** Enough for a long paragraph and a couple of sentences of context. */
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

/**
 * The model is asked for JSON and given a schema, so the response is structured
 * by the provider rather than by us parsing prose. It is still validated below:
 * "the model was told to" is not a guarantee.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    passage: { type: "string" },
    context: { type: "string" },
  },
  required: ["passage", "context"],
} as const;

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
});

const extractionSchema = z.object({
  passage: z.string(),
  context: z.string(),
});

export function createGeminiProvider(
  apiKey: string,
  model: string,
): VisionProvider {
  return {
    name: `gemini:${model}`,

    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      let response: Response;

      try {
        response = await fetch(endpointFor(model), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // In a header rather than the query string, so the key does not end
            // up in any proxy or server access log along the way.
            "x-goog-api-key": apiKey,
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: EXTRACTION_PROMPT },
                  {
                    inline_data: {
                      mime_type: request.mimeType,
                      data: request.image.toString("base64"),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              // Transcription is not a creative task. Zero temperature is what
              // stops the model tidying up an author's punctuation.
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
        });
      } catch (cause) {
        throw new VisionTransientError("Gemini did not respond in time.", {
          cause,
        });
      }

      if (!response.ok) {
        throw await classifyFailure(response);
      }

      const body: unknown = await response.json();
      const parsed = geminiResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new VisionTransientError("Gemini returned an unreadable body.");
      }

      const text = parsed.data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        // A missing part usually means the response was cut off or blocked by a
        // safety filter. Neither is fixed by trying again with the same image.
        throw new VisionPermanentError(
          `Gemini returned no text (finish reason: ${
            parsed.data.candidates?.[0]?.finishReason ?? "unknown"
          }).`,
        );
      }

      const extraction = extractionSchema.safeParse(safeJsonParse(text));

      if (!extraction.success) {
        throw new VisionTransientError(
          "Gemini's JSON did not match the requested shape.",
        );
      }

      return extraction.data;
    },
  };
}

async function classifyFailure(response: Response): Promise<Error> {
  const detail = (await response.text()).slice(0, 300);

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");

    return new VisionRateLimitError(
      "Gemini's free tier quota is exhausted for now.",
      retryAfter === null ? null : Number(retryAfter) || null,
    );
  }

  // 5xx and 408 are the provider's problem and usually pass.
  if (response.status >= 500 || response.status === 408) {
    return new VisionTransientError(`Gemini responded ${response.status}.`);
  }

  // Everything else — 400 bad request, 401/403 bad key, 404 model gone — will
  // fail identically forever. Retrying wastes the budget that a genuinely
  // transient failure needs.
  return new VisionPermanentError(
    `Gemini rejected the request (${response.status}): ${detail}`,
  );
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
