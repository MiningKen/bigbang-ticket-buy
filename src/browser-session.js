export async function pageForExistingContext(context, page) {
  if (page && !page.isClosed()) return page;

  const openPage = context.pages().find((candidate) => !candidate.isClosed());
  return openPage || context.newPage();
}
