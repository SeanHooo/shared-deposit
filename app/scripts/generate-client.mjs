import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idl = JSON.parse(readFileSync(new URL('../../target/idl/shared_deposit_passport.json', import.meta.url), 'utf8'));
const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.accept(renderVisitor(fileURLToPath(new URL('../src/generated', import.meta.url)), { generatedFolder: '.', syncPackageJson: false }));
