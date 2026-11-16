import { useRouter } from "next/navigation";
import { useState } from "react";

import { enrichResponseSchema } from "../annotations.schema";
import type { Annotation } from "../annotations.types";

type BatchExtractionState = {
  status: "running" | "done" | "stopped";
  current: number;
  total: number;
  message: string;
} | null;

type EnrichmentRequestResult = {
  ok: boolean;
  message: string | null;
};

export function useAnnotationEnrichment(
  incompleteRegionAnnotations: Annotation[],
  setError: (message: string | null) => void,
) {
  const router = useRouter();
  const [batchExtraction, setBatchExtraction] =
    useState<BatchExtractionState>(null);
  const [enriching, setEnriching] = useState<ReadonlySet<string>>(new Set());

  async function requestEnrichment(
    annotationId: string,
    force = false,
  ): Promise<EnrichmentRequestResult> {
    const response = await fetch(
      `/api/annotations/${annotationId}/enrich${force ? "?force=true" : ""}`,
      { method: "POST" },
    );
    const body = enrichResponseSchema.safeParse(await response.json());

    if (!response.ok) {
      return {
        ok: false,
        message:
          body.success && body.data.error
            ? body.data.error
            : "The passage could not be extracted.",
      };
    }

    return { ok: true, message: null };
  }

  async function enrich(annotationId: string, force = false) {
    setEnriching((current) => new Set(current).add(annotationId));

    try {
      const result = await requestEnrichment(annotationId, force);

      if (!result.ok) {
        setError(result.message);
      } else {
        setError(null);
      }
    } catch {
      setError("Could not reach the extraction service.");
    } finally {
      setEnriching((current) => {
        const next = new Set(current);
        next.delete(annotationId);
        return next;
      });
      router.refresh();
    }
  }

  async function extractMissingPassages() {
    const queue = incompleteRegionAnnotations;

    if (queue.length === 0) {
      return;
    }

    setError(null);
    setBatchExtraction({
      status: "running",
      current: 0,
      total: queue.length,
      message: "Starting extraction queue...",
    });

    for (const [index, annotation] of queue.entries()) {
      const force = annotation.enrichmentStatus === "failed";

      setBatchExtraction({
        status: "running",
        current: index + 1,
        total: queue.length,
        message: force
          ? `Retrying note ${index + 1} of ${queue.length}...`
          : `Reading note ${index + 1} of ${queue.length}...`,
      });
      setEnriching((current) => new Set(current).add(annotation.id));

      try {
        const result = await requestEnrichment(annotation.id, force);

        if (!result.ok) {
          setError(result.message);
          setBatchExtraction({
            status: "stopped",
            current: index + 1,
            total: queue.length,
            message:
              result.message ??
              "Extraction stopped. You can run the queue again later.",
          });
          router.refresh();
          return;
        }
      } catch {
        setError("Could not reach the extraction service.");
        setBatchExtraction({
          status: "stopped",
          current: index + 1,
          total: queue.length,
          message: "Extraction stopped because the service could not be reached.",
        });
        router.refresh();
        return;
      } finally {
        setEnriching((current) => {
          const next = new Set(current);
          next.delete(annotation.id);
          return next;
        });
      }
    }

    setBatchExtraction({
      status: "done",
      current: queue.length,
      total: queue.length,
      message: "All missing passages were extracted.",
    });
    router.refresh();
  }

  return { batchExtraction, enriching, enrich, extractMissingPassages };
}
