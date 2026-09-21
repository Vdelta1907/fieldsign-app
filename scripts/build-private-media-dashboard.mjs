// Produce self-contained files for Supabase Dashboard's single-file editor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const shared = name => readFileSync(new URL(`../supabase/functions/_shared/${name}.ts`, import.meta.url), 'utf8');
const destination = new URL('../supabase/dashboard-private-media/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const name of ['client-authorization', 'contractor-order-media', 'prepare-order-media']) {
  const entry = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
    .replace(/^import .* from '\.\.\/_shared\/[^']+';\n/gm, '');
  const code = '// GENERATED: run node scripts/build-private-media-dashboard.mjs after editing shared/source functions.\n'
    + (name === 'prepare-order-media' ? '' : shared('client-limits') + '\n')
    + shared('order-media') + '\n' + entry;
  writeFileSync(new URL(`${name}.ts`, destination), code);
}
