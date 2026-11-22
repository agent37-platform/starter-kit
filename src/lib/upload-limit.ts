// The largest file a member can send from the browser, to the drive or as a chat attachment. The
// app's host (Vercel) refuses any request body over 4.5 MB before a route sees it, and answers with
// its own page; a file is checked here first so the member reads why. Kept under the limit to leave
// room for the multipart envelope of a chat attachment. No imports: safe in client components.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const TOO_LARGE = "Ce fichier dépasse 4 Mo, la taille maximale d’un envoi.";

export function tooLarge(file: File): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

// A document (chat attachment, drive, company memory) may be larger: it goes in parts of 3 MB, each under the
// host's limit, and the back office puts them back together (lib/upload-parts.ts). Up to 25 MB (Leslie, 20/11).
export const PART_BYTES = 3 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const TOO_LARGE_DOCUMENT = "Ce fichier dépasse 25 Mo, la taille maximale d’un envoi.";

/** Over 25 MB: refused before anything is sent. */
export function tooLargeDocument(file: Blob): boolean {
  return file.size > MAX_DOCUMENT_BYTES;
}

/** Over the host's limit: sent in parts. */
export function needsParts(file: Blob): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}
