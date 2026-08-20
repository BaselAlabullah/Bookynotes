# integrations/vision

Image in, extracted passage and context out. The only directory that knows a
vision model exists.

```
vision.types.ts         the VisionProvider interface, the error taxonomy, the prompt
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

## The retry policy is shaped by serverless

Three attempts, a few hundred milliseconds apart, jittered. Deliberately small:
a long backoff cannot survive a function's wall-clock limit — it would be killed
mid-wait and the user would see nothing. Persistent failure ends the request and
leaves the row retryable instead.

A rate limit asking for longer than a few seconds is not waited out. Free tiers
routinely say "come back in 60 seconds", and a retry button beats holding a
function open for a minute.

## The prompt

The model is *shown* the region rather than told about it: the image it receives
is a padded crop with the reader's own rectangle drawn on it. See
`features/annotations/annotations.crop.ts` and DECISIONS 0039.
