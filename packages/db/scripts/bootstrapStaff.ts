import { createPool, DripSignStore } from '../src/index.ts';
const databaseUrl=process.env['DRIPSIGN_DATABASE_URL'];
const memberships=process.env['DRIPSIGN_STAFF_MEMBERSHIPS'];
if(!databaseUrl||!memberships)throw new Error('DRIPSIGN_DATABASE_URL and DRIPSIGN_STAFF_MEMBERSHIPS are required');
const parsed:unknown=JSON.parse(memberships);
if(!Array.isArray(parsed)||parsed.length<1||parsed.length>100)throw new Error('Staff memberships must be a bounded nonempty array');
const pool=createPool(databaseUrl);
try {
  const store=new DripSignStore(pool);
  for(const value of parsed) {
    if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Staff membership is invalid');
    const row:Record<string,unknown>=Object.fromEntries(Object.entries(value));
    if(Object.keys(row).some((key)=>!['tenantId','tenantName','userId','email'].includes(key))||typeof row.tenantId!=='string'||typeof row.tenantName!=='string'||typeof row.userId!=='string'||typeof row.email!=='string')throw new Error('Staff membership is invalid');
    await store.bootstrapStaff({tenantId:row.tenantId,tenantName:row.tenantName,userId:row.userId,email:row.email});
  }
  process.stdout.write(`Bootstrapped ${parsed.length} staff memberships\n`);
} finally { await pool.end(); }
