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

/** A whole page of dense print. Truncating a transcript ruins it. */
const TRANSCRIPTION_MAX_TOKENS = 8192;
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

const TRANSCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    printed_page_number: { type: "string" },
    text: { type: "string" },
  },
  required: ["printed_page_number", "text"],
} as const;

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
      const text = await callGemini(
        apiKey,
        model,
        request,
        EXTRACTION_PROMPT,
        RESPONSE_SCHEMA,
        MAX_OUTPUT_TOKENS,
      );

      const extraction = extractionSchema.safeParse(safeJsonParse(text));

      if (!extraction.success) {
        throw new VisionTransientError(
          "Gemini's JSON did not match the requested shape.",
        );
      }

      return extraction.data;
    },

    async transcribe(
      request: ExtractionRequest,
    ): Promise<TranscriptionResult> {
      const text = await callGemini(
        apiKey,
        model,
        request,
        TRANSCRIPTION_PROMPT,
        TRANSCRIPTION_SCHEMA,
        // A dense page runs to well over a thousand tokens, and a transcript
        // truncated mid-sentence is worse than none.
        TRANSCRIPTION_MAX_TOKENS,
      );

      const transcription = transcriptionSchema.safeParse(safeJsonParse(text));

      if (!transcription.success) {
        throw new VisionTransientError(
          "Gemini's JSON did not match the requested shape.",
        );
      }

      return transcription.data;
    },
  };
}

/**
 * One request to Gemini, shared by both methods.
 *
 * They differ only in the prompt, the response schema and the output budget,
 * so the transport lives here rather than being written out twice.
 */
async function callGemini(
  apiKey: string,
  model: string,
  request: ExtractionRequest,
  prompt: string,
  responseSchema: object,
  maxOutputTokens: number,
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(endpointFor(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // In a header rather than the query string, so the key does not end up
        // in any proxy or server access log along the way.
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
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
          maxOutputTokens,
          // Reading is not a creative task. Zero temperature is what stops the
          // model tidying up an author's punctuation.
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });
  } catch (cause) {
    throw new VisionTransientError("Gemini did not respond in time.", { cause });
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

  return text;
}

/**
 * Gemini reports quota failures in a structured body rather than a header, and
 * the distinction it draws matters enormously to the person reading the
 * message: a per-minute limit clears in seconds, a per-day limit does not clear
 * until tomorrow. "Try again shortly" is actively misleading for the second,
 * and the free tier's daily allowance for some models is small enough that it
 * is the one you actually hit.
 */
const quotaFailureSchema = z.object({
  error: z
    .object({
      details: z
        .array(
          z.object({
            "@type": z.string().optional(),
            violations: z
              .array(z.object({ quotaId: z.string().optional() }))
              .optional(),
            retryDelay: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

async function classifyFailure(response: Response): Promise<Error> {
  const raw = await response.text();
  const detail = raw.slice(0, 300);

  if (response.status === 429) {
    const parsed = quotaFailureSchema.safeParse(safeJsonParse(raw));
    const details = parsed.success ? (parsed.data.error?.details ?? []) : [];

    const quotaIds = details.flatMap((entry) =>
      (entry.violations ?? []).map((violation) => violation.quotaId ?? ""),
    );
    const isDaily = quotaIds.some((id) => id.includes("PerDay"));

    // Prefer the delay the API actually asked for, in seconds.
    const askedSeconds = details
      .map((entry) => Number((entry.retryDelay ?? "").replace("s", "")))
      .find((value) => Number.isFinite(value) && value > 0);

    const headerSeconds = Number(response.headers.get("retry-after"));

    return new VisionRateLimitError(
      isDaily
        ? "Today's free quota for this model is used up. It resets tomorrow, or you can point GEMINI_VISION_MODEL at a different model."
        : "The model is busy right now. Try again in a moment.",
      askedSeconds ?? (Number.isFinite(headerSeconds) ? headerSeconds : null),
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
