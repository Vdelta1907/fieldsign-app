import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../supabase/', import.meta.url);
for (const name of ['contractor-media', 'submit-signature', 'client-authorization']) {
  let output = "// GENERATED: node scripts/build-future-media-dashboard.mjs\nimport type { SupabaseClient } from 'npm:@supabase/supabase-js@2';\n";
  for (const file of ['_shared/client-limits.ts', '_shared/order-media.ts', '_shared/future-media.ts', `${name}/index.ts`]) {
    let source = readFileSync(new URL(`functions/${file}`, root), 'utf8');
    source = source.replace(/^import .* from ['"](?:\.\.?\/[^'"]+|npm:@supabase\/supabase-js@2)['"];\n/gm, line => line.startsWith('import type') || !line.includes('createClient') ? '' : line);
    output += `\n// ${file}\n${source}`;
  }
  writeFileSync(new URL(`dashboard-future-media/${name}.ts`, root), output);
}
