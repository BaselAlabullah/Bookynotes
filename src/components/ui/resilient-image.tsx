"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ImgHTMLAttributes,
} from "react";

const RETRY_DELAYS_MS = [300, 800, 1_600, 3_000] as const;
const subscribeToNothing = () => () => undefined;

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
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Do not let the browser request a possibly stale server-rendered URL
    // before React has attached the error handler that can renew it.
    const isHydrated = useSyncExternalStore(
      subscribeToNothing,
      () => true,
      () => false,
    );

    useEffect(() => {
      setAttempt(0);
      setActiveSrc(src);
    }, [src]);

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
        ref={ref}
        alt={alt}
        src={isHydrated ? activeSrc : undefined}
        onLoad={(event) => {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = null;
          onLoad?.(event);
        }}
        onError={(event) => {
          onError?.(event);
          const delay = RETRY_DELAYS_MS[attempt];

          if (delay === undefined || retryTimer.current) return;

          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            const nextAttempt = attempt + 1;

            void (async () => {
              let nextSrc = src;

              if (storageKey) {
                const response = await fetch(
                  `/api/storage/read-url?key=${encodeURIComponent(storageKey)}`,
                  { cache: "no-store" },
                ).catch(() => null);

                if (response?.ok) {
                  nextSrc =
                    readSignedUrl(await response.json().catch(() => null)) ??
                    nextSrc;
                }
              }

              setActiveSrc(
                `${nextSrc}${nextSrc.includes("?") ? "&" : "?"}bookynotes_image_retry=${nextAttempt}`,
              );
              setAttempt(nextAttempt);
            })();
          }, delay);
        }}
      />
    );
  },
);
