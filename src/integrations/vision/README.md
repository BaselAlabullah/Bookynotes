# integrations/vision

Image + prompt in, extracted passage and context out.

The interface is defined here; Gemini Flash is the default implementation and
an OpenRouter free vision model is the fallback, selected by environment
variable. Retry and backoff policy also lives here, because rate limits are a
property of the provider, not of the annotation domain.

Built in phase 7.
