// Neutral file-path matching utilities. Pure glob→RegExp translation and
// sensitive-file selection with zero routing-policy knowledge, so persistence
// (receipt.js) and risk-context construction can match paths without importing
// the router. Leaf module: no local imports.

export function globToRegExp(pattern) {
  let normalized = String(pattern).trim().replace(/^\.\//u, "").replace(/^\//u, "");
  if (!normalized) {
    throw new Error("sensitive path patterns cannot be empty");
  }

  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

export function findSensitiveFiles(files, patterns) {
  const matchers = patterns.map(globToRegExp);
  return files.filter((file) => matchers.some((matcher) => matcher.test(file)));
}
