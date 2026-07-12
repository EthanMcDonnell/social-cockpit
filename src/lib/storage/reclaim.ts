/**
 * Reclaim uploaded R2 sources: delete the object and drop its usage reservation.
 *
 * Only safe to call once Instagram no longer needs the source — i.e. the media
 * is published or the container reached FINISHED (bytes fully ingested), or the
 * publish failed outright. Deleting while a container is still IN_PROGRESS would
 * pull the source out from under Instagram's fetch and fail the container.
 *
 * Best-effort: a delete failure is swallowed (the bucket lifecycle rule expires
 * publish/ objects within a day regardless), but the reservation is always
 * released so the usage cap doesn't drift.
 */

import { deleteObject } from "./r2";
import { release } from "./usage";

export async function reclaimKeys(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await deleteObject(key);
      } catch {
        /* lifecycle rule expires it within a day regardless */
      }
      release(key);
    })
  );
}
