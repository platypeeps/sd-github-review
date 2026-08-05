import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A-009: enforce the allowed-import matrix for the decomposed consumer installer
// so the one-way layering direction is frozen. The codecs leaf imports no local
// installer module; transport/persistence/plan import only the leaf; the public
// orchestrator (scripts/consumer-installer.mjs) imports the four submodules.
// This prevents a future edit from silently re-inverting an edge (e.g. plan
// reaching into transport, or a leaf importing a sibling) and reintroducing the
// monolith the finding split apart.

const MODULES_DIR = fileURLToPath(new URL("../scripts/consumer-installer/", import.meta.url));
const ORCHESTRATOR = fileURLToPath(new URL("../scripts/consumer-installer.mjs", import.meta.url));

// Each installer module maps to the local installer modules it MAY import,
// expressed as bare specifiers relative to the importing module. A module not
// listed here fails the completeness check below, forcing this matrix to be
// updated whenever a new installer module is added.
const ALLOWED = {
  "consumer-installer/codecs.mjs": [],
  "consumer-installer/transport.mjs": ["./codecs.mjs"],
  "consumer-installer/persistence.mjs": ["./codecs.mjs"],
  "consumer-installer/plan.mjs": ["./codecs.mjs"],
  "consumer-installer.mjs": [
    "./consumer-installer/codecs.mjs",
    "./consumer-installer/transport.mjs",
    "./consumer-installer/persistence.mjs",
    "./consumer-installer/plan.mjs",
  ],
};

const LEAVES = ["consumer-installer/codecs.mjs"];

function submoduleFiles() {
  return readdirSync(MODULES_DIR)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => `consumer-installer/${name}`)
    .sort();
}

// Match `import … from "<spec>"`, `export … from "<spec>"`, and side-effect-only
// `import "<spec>";` against a local (./ or ../) installer specifier. A bare
// side-effect import still creates a dependency edge, so the boundary check must
// not let it bypass the matrix.
function localImports(absolutePath) {
  const source = readFileSync(absolutePath, "utf8");
  const imports = new Set();
  const patterns = [
    /from\s+["'](\.\.?\/[\w./-]+\.mjs)["']/gu,
    /import\s+["'](\.\.?\/[\w./-]+\.mjs)["']/gu,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

function moduleKeyToPath(key) {
  return fileURLToPath(new URL(`../scripts/${key}`, import.meta.url));
}

test("every installer module is covered by the allowed-import matrix", () => {
  const submodules = submoduleFiles();
  for (const name of submodules) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ALLOWED, name),
      `scripts/${name} is not covered by the allowed-import matrix; update the matrix`,
    );
  }
  for (const name of Object.keys(ALLOWED)) {
    if (name === "consumer-installer.mjs") continue;
    assert.ok(submodules.includes(name), `matrix lists scripts/${name} but the module does not exist`);
  }
});

test("each installer module imports only modules allowed by the layering", () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const imports = localImports(name === "consumer-installer.mjs" ? ORCHESTRATOR : moduleKeyToPath(name));
    for (const dependency of imports) {
      assert.ok(
        allowed.includes(dependency),
        `scripts/${name} imports ${dependency}, which the layering forbids`,
      );
    }
  }
});

test("leaf installer modules import no local installer module", () => {
  for (const leaf of LEAVES) {
    assert.deepEqual(
      localImports(moduleKeyToPath(leaf)),
      [],
      `scripts/${leaf} is a leaf and must not import any local installer module`,
    );
  }
});

test("the installer dependency graph has no cycle", () => {
  // Resolve every matrix edge to an absolute-relative key rooted at scripts/ so
  // the graph is comparable across importing directories, then run a DFS that
  // fails on any back edge.
  const graph = new Map();
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const fromDir = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    const resolved = allowed.map((spec) => {
      const withoutDot = spec.replace(/^\.\//u, "").replace(/^\.\.\//u, "");
      if (spec.startsWith("../")) return withoutDot; // relative to scripts/
      return fromDir ? `${fromDir}/${withoutDot}` : withoutDot;
    });
    graph.set(name, resolved);
  }
  const state = new Map();
  const visit = (node, stack) => {
    if (state.get(node) === "done") return;
    assert.ok(state.get(node) !== "active", `import cycle detected through ${[...stack, node].join(" -> ")}`);
    state.set(node, "active");
    for (const next of graph.get(node) ?? []) visit(next, [...stack, node]);
    state.set(node, "done");
  };
  for (const node of graph.keys()) visit(node, []);
});
