/** Production traffic starts only after private configuration is validated. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { getConfiguration } = await import('./server/config');
    getConfiguration();
  }
}
