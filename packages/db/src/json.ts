// PostgreSQL jsonb changes object key order; equality and idempotency use one canonical encoding.
export function canonicalJson(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded=JSON.stringify(value);
  if(encoded===undefined)throw new TypeError('Value cannot be encoded');
  return encoded;
}
