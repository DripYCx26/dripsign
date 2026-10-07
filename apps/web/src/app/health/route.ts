/** Process health is separate from provider and database readiness. */
export function GET(): Response {
  return Response.json({ service: 'dripsign', status: 'ok', apiVersion: '1' }, { headers: { 'Cache-Control': 'no-store' } });
}
