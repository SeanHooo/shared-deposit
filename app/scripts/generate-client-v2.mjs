import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idl = JSON.parse(
  readFileSync(
    new URL(
      '../../programs/shared-deposit-v2/idl/shared_deposit_v2.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.accept(
  renderVisitor(fileURLToPath(new URL('../src/generated-v2', import.meta.url)), {
    generatedFolder: '.',
    syncPackageJson: false,
  }),
);
