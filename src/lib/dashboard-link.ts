// The dashboard route's second step, once the state file is read: the files of the folder it names and,
// only while it names no link, the link from the last conversations — both at once. No imports: tested.

export function filesAndLink<F>(lien: string | null, files: Promise<F>, fromSessions: () => Promise<string | null>): Promise<[F, string | null]> {
  return Promise.all([files, lien ? lien : fromSessions()]);
}
