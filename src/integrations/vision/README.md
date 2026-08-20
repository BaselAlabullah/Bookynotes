# integrations/vision

Image in, extracted passage and context out. The only directory that knows a
vision model exists.

```
vision.types.ts         the VisionProvider interface, the error taxonomy, both prompts
gemini.provider.ts      Gemini Flash (default)
openrouter.provider.ts  an OpenRouter free vision model (fallback)
vision.client.ts        picks the provider and applies the retry policy
```

Switching provider is one environment variable, `VISION_PROVIDER`. Nothing
outside this directory knows which model answered.

There are two implementations on purpose. An interface with a single
implementation is a guess about what varies; the second one proved the seam was
in the right place — Gemini takes `inline_data` with a response schema,
OpenRouter takes OpenAI-shaped `image_url` parts with a loose JSON hint. Both are
plain `fetch`, not vendor SDKs, so the request on the wire is readable in the
file when a free tier starts answering 429.

## Errors are classified by what to do

| Type | Meaning | Policy |
| --- | --- | --- |
| `VisionRateLimitError` | Out of quota | Retry later. Does not consume the attempt budget. |
| `VisionTransientError` | Timeout, 5xx, dropped connection | Retry now, with backoff and jitter. |
| `VisionPermanentError` | Bad key, rejected image, missing model | Never retried. Terminal immediately. |

Retrying a bad API key three times spends the budget a real blip needs and takes
three times as long to report something that will never work.

## Quota is the real constraint

Free-tier limits are **per model and per day**, not per minute, and they are
small enough to be the binding constraint on the whole feature: measured on a
real key, `gemini-3.5-flash` allows twenty requests a day.

That is why `GEMINI_VISION_MODEL` defaults to a *lite* model. On reading a real
book page the two were indistinguishable — same markers, same page number, same
length — and lite is both cheaper and faster. See DECISIONS 0074.

A 429 caused by the daily limit says so, rather than "try again shortly", which
would be false. The distinction comes from the `quotaId` in Gemini's response
body; switching models grants a fresh allowance immediately, so the message says
that too.

## The retry policy is shaped by serverless

Three attempts, a few hundred milliseconds apart, jittered. Deliberately small:
a long backoff cannot survive a function's wall-clock limit — it would be killed
mid-wait and the user would see nothing. Persistent failure ends the request and
leaves the row retryable instead.

A rate limit asking for longer than a few seconds is not waited out. Free tiers
routinely say "come back in 60 seconds", and a retry button beats holding a
function open for a minute.

## Two capabilities

`extract` reads one marked rectangle; `transcribe` reads a whole page. Separate
methods rather than one method with two prompts, because they differ in what
they return, what they cost and how they fail — a single method would have meant
a result type that is half-empty whichever way it was called.

Both share one retry policy, because the failures a provider produces do not
depend on what you asked it for. A rate limit is a rate limit.

## The prompt

The model is *shown* the region rather than told about it: the image it receives
is a padded crop with the reader's own rectangle drawn on it. See
`features/annotations/annotations.crop.ts` and DECISIONS 0039.
