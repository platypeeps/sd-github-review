// Local persistence for the consumer installer: the A-005 path-containment
// guard, atomic managed-file writes/removals, and managed-state loading. It
// imports only the codecs leaf so the downhill dependency direction stays
// intact.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DESCRIPTOR_PATH,
  DURABLE_WORKFLOW_PATH,
  MANIFEST_PATH,
  WORKFLOW_PATH,
  decodeManifest,
} from "./codecs.mjs";

export async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A-005 containment guard. Every managed read, write, rename, and removal must
// stay beneath the canonical consumer worktree without following a
// repository-controlled symlink ancestor. Errors are bounded to the managed
// path relative to the root; they never embed a symlink target, the escaping
// destination, or any other unrelated host path.
const CONTAINMENT_MESSAGE = "refusing to follow a symlinked or escaping installer path";

function containmentError(relativeParts, reason = CONTAINMENT_MESSAGE) {
  return new Error(`${relativeParts.join(path.sep)}: ${reason}`);
}

function managedRelativeParts(root, targetPath) {
  const relative = path.relative(root, targetPath);
  if (
    relative === "" ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    // Bounded: report only the intended leaf name, never the root or an
    // escaping absolute destination.
    throw new Error(`${path.basename(targetPath)}: ${CONTAINMENT_MESSAGE}`);
  }
  return relative.split(path.sep);
}

async function inspectComponent(componentPath, lstatImpl) {
  try {
    return await lstatImpl(componentPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Inspect every existing ancestor from the canonical root down to targetPath
// with lstat (never stat) so a symlink component is rejected instead of
// followed. A missing component ends the walk: nothing beyond it can exist.
async function assertContainedPath(root, targetPath, lstatImpl) {
  const relativeParts = managedRelativeParts(root, path.resolve(targetPath));
  let current = root;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    const stats = await inspectComponent(current, lstatImpl);
    if (stats === null) return;
    const traversed = relativeParts.slice(0, index + 1);
    if (stats.isSymbolicLink()) {
      throw containmentError(traversed);
    }
    if (index === relativeParts.length - 1) {
      if (!stats.isFile()) {
        throw containmentError(traversed, "managed path is not a regular file");
      }
    } else if (!stats.isDirectory()) {
      throw containmentError(traversed, "managed ancestor is not a directory");
    }
  }
}

// Create every missing directory from the canonical root down to dirPath one
// component at a time. A recursive mkdir would follow a symlink swapped into an
// ancestor and create directories outside the root; creating a single component
// at a time under an lstat-verified real-directory parent keeps every mkdir
// contained. A component that already exists as a symlink or non-directory is
// rejected, and a component swapped to a symlink between its check and creation
// makes the non-recursive mkdir fail with EEXIST rather than follow it.
async function assertContainedDir(root, dirPath, lstatImpl) {
  const resolved = path.resolve(dirPath);
  if (resolved === root) return;
  const relativeParts = managedRelativeParts(root, resolved);
  let current = root;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    const stats = await inspectComponent(current, lstatImpl);
    const traversed = relativeParts.slice(0, index + 1);
    if (stats === null) {
      await mkdir(current);
    } else if (stats.isSymbolicLink()) {
      throw containmentError(traversed);
    } else if (!stats.isDirectory()) {
      throw containmentError(traversed, "managed ancestor is not a directory");
    }
  }
}

export function makePathGuard(root, lstatImpl = lstat) {
  const canonicalRoot = path.resolve(root);
  return {
    root: canonicalRoot,
    assert(targetPath) {
      return assertContainedPath(canonicalRoot, targetPath, lstatImpl);
    },
    mkdirWithin(targetPath) {
      return assertContainedDir(
        canonicalRoot,
        path.dirname(path.resolve(targetPath)),
        lstatImpl,
      );
    },
  };
}

export async function atomicWrite(guard, filePath, content) {
  // Create the destination directory one component at a time, rejecting a
  // symlinked ancestor before creating any child beneath it; a recursive mkdir
  // would follow a swapped-in symlink and create directories outside the root.
  await guard.mkdirWithin(filePath);
  // Re-check containment after the directory exists and immediately before the
  // temp write, so the write is protected symmetrically with the rename below:
  // a symlink swapped into an ancestor is caught before any bytes are written.
  await guard.assert(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
    // Re-check containment immediately before the rename to narrow the
    // time-of-check/time-of-use window on the destination ancestors.
    await guard.assert(filePath);
    await rename(temporaryPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the temp file on any failure. The temp name
    // carries an unpredictable random suffix, so an ancestor swapped to a
    // symlink cannot steer this unlink onto an attacker-named external file:
    // it either removes the real temp file or fails ENOENT through the swap.
    // The pre-write `wx` write and the pre-write/pre-rename containment
    // asserts are what prevent writing *through* a swap; this cleanup only
    // targets the unpredictable temp path and never a caller-supplied one.
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function removeOptional(guard, filePath) {
  // Re-check containment immediately before the removal for the same reason.
  await guard.assert(filePath);
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// Write only when the destination bytes differ from what we intend to store. A
// converged run must leave managed files untouched (D4), and adopting a
// hand-placed file whose bytes already match the source must record ownership
// without rewriting it (D3b); an unconditional write satisfies neither.
export async function atomicWriteIfChanged(guard, filePath, content) {
  await guard.assert(filePath);
  if ((await readOptional(filePath)) === content) return false;
  await atomicWrite(guard, filePath, content);
  return true;
}

export async function loadLocalState(guard, root) {
  const manifestFile = path.join(root, MANIFEST_PATH);
  const workflowFile = path.join(root, WORKFLOW_PATH);
  const descriptorFile = path.join(root, DESCRIPTOR_PATH);
  const durableWorkflowFile = path.join(root, DURABLE_WORKFLOW_PATH);
  await guard.assert(manifestFile);
  await guard.assert(workflowFile);
  await guard.assert(descriptorFile);
  await guard.assert(durableWorkflowFile);
  const manifestSource = await readOptional(manifestFile);
  return {
    manifestFile,
    workflowFile,
    descriptorFile,
    durableWorkflowFile,
    manifest: manifestSource === null ? null : decodeManifest(manifestSource, manifestFile),
    workflow: await readOptional(workflowFile),
    descriptor: await readOptional(descriptorFile),
    durableWorkflow: await readOptional(durableWorkflowFile),
  };
}
