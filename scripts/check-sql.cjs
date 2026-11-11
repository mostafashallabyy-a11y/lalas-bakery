#!/usr/bin/env node
/*
 * Migration SQL auditor for supabase/migrations.
 *
 * FAIL (exit 1):
 *   - duplicate migration version prefix (e.g. two 0020_*.sql files)
 *   - dollar-quote mismatch or unterminated block ($fn$ ... $fn$)
 *   - file does not end with a semicolon
 *   - file name is not NNNN_snake_case.sql
 *
 * WARN (exit 0):
 *   - file longer than 150 lines (split it into one logical change)
 *   - bare $$ used instead of a named tag (use $fn$ so truncation is visible)
 *
 * Usage: npm run check:sql
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");
const MAX_LINES = 150;

function stripLineComments(sql) {
  // Good enough for migrations: we only need to ignore -- comments so a
  // commented-out tag does not count. (-- inside a string literal is rare.)
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function auditFile(file, sql) {
  const problems = [];
  const warnings = [];
  const lines = sql.split(/\r?\n/);
  const stripped = stripLineComments(sql);

  // --- dollar-quote matching, in order, as a stack ---
  const tagRe = /\$([A-Za-z_][A-Za-z_0-9]*)?\$/g;
  const stack = [];
  const usedTags = new Set();
  let match;
  let mismatch = null;

  while ((match = tagRe.exec(stripped)) !== null) {
    const tag = "$" + (match[1] || "") + "$";
    usedTags.add(tag);
    if (stack.length === 0) {
      stack.push(tag);
    } else if (stack[stack.length - 1] === tag) {
      stack.pop();
    } else {
      mismatch =
        "closing " + tag + " does not match opening " +
        stack[stack.length - 1] + " (offset " + match.index + ")";
      break;
    }
  }

  if (mismatch) {
    problems.push(mismatch);
  } else if (stack.length > 0) {
    problems.push("unterminated dollar-quote block: " + stack.join(", "));
  }

  if (usedTags.has("$$")) {
    warnings.push("uses bare $$ - prefer a named tag such as $fn$");
  }

  // --- must end with a semicolon ---
  const lastSignificant = [...lines]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("--"));

  if (lastSignificant && !lastSignificant.endsWith(";")) {
    problems.push(
      "does not end with ';' (last statement: " +
        lastSignificant.slice(0, 60) + ")"
    );
  }

  // --- size ---
  if (lines.length > MAX_LINES) {
    warnings.push(
      lines.length + " lines (> " + MAX_LINES + ") - split into smaller migrations"
    );
  }

  return { problems, warnings, lineCount: lines.length };
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error("migrations directory not found: " + MIGRATIONS_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();

  let hardFailures = 0;
  let warningCount = 0;
  const versions = new Map();

  console.log("=== Migration SQL audit ===");
  console.log("");

  for (const file of files) {
    const nameMatch = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
    const localProblems = [];

    if (!nameMatch) {
      localProblems.push("name must be NNNN_snake_case.sql");
    } else {
      const version = nameMatch[1];
      if (versions.has(version)) {
        localProblems.push(
          "duplicate version " + version + " (also used by " + versions.get(version) + ")"
        );
      } else {
        versions.set(version, file);
      }
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const result = auditFile(file, sql);
    const problems = localProblems.concat(result.problems);
    const warnings = result.warnings;

    if (problems.length > 0) {
      hardFailures++;
      console.log("FAIL  " + file + "  (" + result.lineCount + " lines)");
      for (const p of problems) console.log("        - " + p);
      continue;
    }

    if (warnings.length > 0) {
      warningCount++;
      console.log("WARN  " + file + "  (" + result.lineCount + " lines)");
      for (const w of warnings) console.log("        - " + w);
    } else {
      console.log("OK    " + file + "  (" + result.lineCount + " lines)");
    }
  }

  console.log("");
  console.log(hardFailures + " failing file(s), " + warningCount + " warning(s)");

  if (hardFailures > 0) {
    console.log("Fix the FAIL entries before running: supabase db push");
    process.exit(1);
  }
}

main();
