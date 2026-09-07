export function attachDashboardShutdown({ dashboardBrowser, dashboardPage, shutdown }) {
  dashboardBrowser.on('disconnected', shutdown);
  dashboardPage.on('close', shutdown);
}
