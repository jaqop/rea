/** Analyst work labels and exact-text identities occupy distinct namespaces. */
export function sourceWorkIdentity(workspace, bookId) {
  const label = workspace.source_work_ids?.find(item => item.book_id === bookId)?.work_id;
  return JSON.stringify(label === undefined ? ['text', bookId] : ['work', label]);
}
