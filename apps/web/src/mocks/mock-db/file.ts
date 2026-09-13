import type { FileObject } from "@labelhub/contracts";
import { nextId, now } from "../mock-utils";
import { mockDb } from "./state";

export function createUploadFile(input: Pick<FileObject, "mimeType" | "size" | "purpose" | "ownerType" | "ownerId">): FileObject {
  const file: FileObject = {
    id: nextId("file"),
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    purpose: input.purpose,
    mimeType: input.mimeType,
    size: input.size,
    storageKey: `${input.ownerId}/${Date.now()}`,
    status: "UPLOADING",
    createdAt: now(),
  };
  mockDb.files.push(file);
  return file;
}

export function confirmFile(fileId: string): FileObject | undefined {
  const file = mockDb.files.find((item) => item.id === fileId);
  if (file === undefined) return undefined;
  file.status = "READY";
  file.confirmedAt = now();
  return file;
}
