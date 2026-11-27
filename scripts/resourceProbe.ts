/**
 * READ-ONLY Cloudflare probe. You run it yourself with a token that has Zone → Analytics: Read.
 *   set CLOUDFLARE_ZONE_ID=... & set CLOUDFLARE_API_TOKEN=... & npx tsx scripts/resourceProbe.ts
 * It writes nothing and touches no database. It only checks which GraphQL dimensions your plan exposes
 * and prints a few sample rows, so the ingestion queries can be confirmed before enabling sync.
 */
import 'dotenv/config';
import axios from 'axios';

const zone = process.env.CLOUDFLARE_ZONE_ID || '';
const token = process.env.CLOUDFLARE_API_TOKEN || '';
if (!zone || !token) {
  console.error('Set CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const until = new Date(Date.now() - 30 * 60_000);
const since = new Date(until.getTime() - 15 * 60_000);

const attempt = async (name: string, dims: string) => {
  const query = `query($z:String!,$s:Time!,$u:Time!){viewer{zones(filter:{zoneTag:$z}){
    httpRequestsAdaptiveGroups(limit:5,filter:{datetime_geq:$s,datetime_lt:$u}){count sum{edgeResponseBytes} dimensions{${dims}}}}}}`;
  try {
    const r = await axios.post('https://api.cloudflare.com/client/v4/graphql', { query, variables: { z: zone, s: since.toISOString(), u: until.toISOString() } },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
    if (r.data?.errors?.length) return console.log(`✗ ${name}:`, r.data.errors.map((e: any) => e.message).join('; '));
    const groups = r.data?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
    console.log(`✓ ${name}: ${groups.length} sample group(s)`);
    console.log(JSON.stringify(groups.slice(0, 3), null, 2));
  } catch (e: any) {
    console.log(`✗ ${name}:`, e?.response?.data || e?.message);
  }
};

(async () => {
  console.log(`Window: ${since.toISOString()} → ${until.toISOString()}`);
  await attempt('host', 'clientRequestHTTPHost');
  await attempt('host + cacheStatus', 'clientRequestHTTPHost cacheStatus');
  await attempt('path + cacheStatus (media host grouping)', 'clientRequestPath cacheStatus');
})();
