/**
 * Shared test helpers for E2E tests
 */

/**
 * Wait for WordPress to be accessible
 * @param port The port to check
 * @param timeout The maximum time to wait in milliseconds
 */
export async function waitForWordPress(port: number, timeout: number = 60000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      // WordPress is ready if it returns OK or a redirect (for setup)
      if (response.ok || response.status === 302) {
        return true;
      }
    } catch {
      // Connection refused, keep trying
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return false;
}
