import type { AnnotationId } from "@/db/ids";

import { deleteAnnotationAction } from "../annotations.actions";

export function DeleteAnnotationButton({ id }: { id: AnnotationId }) {
  return (
    <form action={deleteAnnotationAction}>
      <input type="hidden" name="annotationId" value={id} />
      <button
        type="submit"
        className="text-xs text-danger underline decoration-danger/40 underline-offset-4"
      >
        Delete note
      </button>
    </form>
  );
}
