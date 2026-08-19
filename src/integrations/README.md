# integrations

Everything that talks to a system we do not own. Each integration exposes a
narrow interface that the rest of the app codes against, so a provider can be
swapped by changing configuration rather than call sites.

The rule: no feature ever imports a vendor SDK directly. If `@google/genai`
appears outside `integrations/vision/`, the abstraction has leaked.
