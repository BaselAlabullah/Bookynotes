"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";

const RETRY_DELAYS_MS = [300, 800, 1_600, 3_000] as const;
const inFlightSignedUrls = new Map<string, Promise<string | null>>();

type ResilientImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
> & {
  alt: string;
  src: string;
  /** Private bucket key used to replace an expired signed URL. */
  storageKey?: string;
};

function readSignedUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("url" in body)) {
    return null;
  }

  return typeof body.url === "string" ? body.url : null;
}

/** Concurrent failures for the same object share one signing request. */
function freshSignedUrl(storageKey: string): Promise<string | null> {
  const existing = inFlightSignedUrls.get(storageKey);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetch(
      `/api/storage/read-url?key=${encodeURIComponent(storageKey)}`,
      { cache: "no-store" },
    ).catch(() => null);

    if (!response?.ok) return null;
    return readSignedUrl(await response.json().catch(() => null));
  })();
  const tracked = request.finally(() => {
    if (inFlightSignedUrls.get(storageKey) === tracked) {
      inFlightSignedUrls.delete(storageKey);
    }
  });

  inFlightSignedUrls.set(storageKey, tracked);
  return tracked;
}

/**
 * Renews a private image URL that expired while its server-rendered route sat
 * in the client cache. A distinct query value also prevents a transient failed
 * image response from being reused by the browser cache.
 */
export const ResilientImage = forwardRef<HTMLImageElement, ResilientImageProps>(
  function ResilientImage(
    { alt, src, storageKey, onError, onLoad, ...props },
    ref,
  ) {
    const [attempt, setAttempt] = useState(0);
    const [activeSrc, setActiveSrc] = useState(src);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setImageRef = useCallback(
      (node: HTMLImageElement | null) => {
        imageRef.current = node;

        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const recover = useCallback(() => {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || retryTimer.current) return;

      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        const nextAttempt = attempt + 1;

        void (async () => {
          const renewedSrc = storageKey
            ? await freshSignedUrl(storageKey)
            : null;
          const nextSrc = renewedSrc ?? src;

          setActiveSrc(
            `${nextSrc}${nextSrc.includes("?") ? "&" : "?"}bookynotes_image_retry=${nextAttempt}`,
          );
          setAttempt(nextAttempt);
        })();
      }, delay);
    }, [attempt, src, storageKey]);

    useEffect(() => {
      setAttempt(0);
      setActiveSrc(src);
    }, [src]);

    useEffect(() => {
      // The preload scanner may finish a failed request before React hydrates
      // and attaches onError. The DOM retains that outcome for us to inspect.
      const image = imageRef.current;
      if (image?.complete && image.naturalWidth === 0) recover();
    }, [recover]);

    useEffect(
      () => () => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
      },
      [],
    );

    return (
      // These images are already resized before storage; Next optimization
      // would add latency and consume a metered quota without reducing bytes.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...props}
        ref={setImageRef}
        alt={alt}
        src={activeSrc}
        onLoad={(event) => {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = null;
          setAttempt(0);
          onLoad?.(event);
        }}
        onError={(event) => {
          onError?.(event);
          recover();
        }}
      />
    );
  },
);
