#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  HELP,
  formatReport,
  parseArguments,
  runConsumerInstaller,
} from "./consumer-installer.mjs";

async function confirmUninstall(repository) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Uninstall sd-github-review from ${repository}? [y/N] `);
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.secretMode === "interactive" && !options.dryRun && !process.stdin.isTTY) {
    throw new Error("--set-secret requires a terminal; use --secret-stdin for automation");
  }
  if (options.secretMode === "stdin" && !options.dryRun) {
    const input = await readFile(0, "utf8");
    options.secretInput = input.replace(/\r?\n$/u, "");
    if (options.secretInput.length === 0) throw new Error("standard input secret is empty");
  }
  const report = await runConsumerInstaller(options, { confirm: confirmUninstall });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
