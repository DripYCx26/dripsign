import { API_VERSION } from '../../server/http';

/** Process health is separate from provider and database readiness. */
export function GET(): Response {
  return Response.json({ service: 'dripsign', status: 'ok', apiVersion: API_VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
