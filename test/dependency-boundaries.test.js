import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// AC1 for A-008: enforce the whole allowed-import matrix from design.md, not
// just the protocol/receipt edges. Each src module may import only from the
// modules listed for it; leaf modules import no local module. This freezes the
// one-way layering direction (leaf utils -> protocol -> policy owner ->
// services/entrypoints; persistence -> protocol + path-match) so a future edit
// cannot silently re-invert codec -> policy or persistence -> router.

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

// Every src/*.js module maps to the local modules it MAY import. A module not
// listed here fails the completeness check, forcing this matrix to be updated
// whenever a new runtime module is added.
const ALLOWED = {
  "path-match.js": [],
  "normalize.js": [],
  "github.js": [],
  "operation-contract.js": [],
  "protocol.js": ["normalize.js"],
  "protocol-v2.js": ["protocol.js"],
  "retention-policy.js": [],
  "receipt.js": ["protocol.js", "path-match.js"],
  "router.js": ["protocol.js", "normalize.js", "path-match.js"],
  "risk-context.js": ["path-match.js", "normalize.js"],
  "reviewer-dispatch.js": ["github.js"],
  "operations.js": [
    "protocol.js",
    "router.js",
    "receipt.js",
    "risk-context.js",
    "reviewer-dispatch.js",
    "normalize.js",
    "path-match.js",
    "operation-contract.js",
  ],
  "index.js": [
    "github.js",
    "operations.js",
    "router.js",
    "risk-context.js",
    "reviewer-dispatch.js",
    "normalize.js",
    "path-match.js",
  ],
};

const LEAVES = ["path-match.js", "normalize.js", "github.js", "operation-contract.js"];

function sourceModules() {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();
}

function localImports(fileName) {
  const source = readFileSync(new URL(fileName, new URL("../src/", import.meta.url)), "utf8");
  const imports = new Set();
  // Catch both `import … from "./x.js"` / `export … from "./x.js"` and
  // side-effect-only `import "./x.js";`. A bare side-effect import still
  // creates a dependency edge, so the boundary test must not let it bypass the
  // matrix (Copilot review).
  const patterns = [
    /from\s+["']\.\/([\w-]+\.js)["']/gu,
    /import\s+["']\.\/([\w-]+\.js)["']/gu,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

test("every runtime module is covered by the allowed-import matrix", () => {
  const modules = sourceModules();
  for (const name of modules) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ALLOWED, name),
      `src/${name} is not covered by the allowed-import matrix; update the matrix`,
    );
  }
  for (const name of Object.keys(ALLOWED)) {
    assert.ok(modules.includes(name), `matrix lists src/${name} but the module does not exist`);
  }
});

test("each module imports only modules to its right in the layering", () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const imports = localImports(name);
    for (const dependency of imports) {
      assert.ok(
        allowed.includes(dependency),
        `src/${name} imports src/${dependency}, which the layering forbids`,
      );
    }
  }
});

test("leaf utility modules import no local module", () => {
  for (const leaf of LEAVES) {
    assert.deepEqual(
      localImports(leaf),
      [],
      `src/${leaf} is a leaf and must not import any local module`,
    );
  }
});

test("codec and persistence layers import no route policy", () => {
  for (const name of ["protocol.js", "receipt.js"]) {
    const imports = localImports(name);
    assert.ok(
      !imports.includes("router.js"),
      `src/${name} must not import the policy owner src/router.js`,
    );
  }
});

test("selectProtocolRoute is defined in exactly one module, the policy owner", () => {
  const definitions = [];
  for (const name of sourceModules()) {
    const source = readFileSync(new URL(name, new URL("../src/", import.meta.url)), "utf8");
    // Match a function declaration OR a `const/let/var selectProtocolRoute =`
    // binding, so a later refactor to an arrow/expression form is still counted
    // as a definition rather than reported missing (Copilot review).
    if (/(?:function\s+selectProtocolRoute\b|(?:const|let|var)\s+selectProtocolRoute\s*=)/u.test(source)) {
      definitions.push(name);
    }
  }
  assert.deepEqual(
    definitions,
    ["router.js"],
    "selectProtocolRoute must be defined only in the policy owner src/router.js",
  );
});
