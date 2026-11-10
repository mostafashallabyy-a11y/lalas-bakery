// Migration SQL sanity auditor:
//   FAIL (exit 1)  — unbalanced dollar quotes ($$ or $tag$…$tag$)
//   FAIL (exit 1)  — file does not end with a semicolon / blank line
//   WARN (exit 0)  — file exceeds 150 lines (legacy applied migrations keep their size)
//   OK             — everything else
const fs = require("fs");
const path = require("path");

const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

let hardFailures = 0;
let warnings = 0;

console.log("=== Migration SQL audit ===\n");

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
  const lines = content.split("\n");
  const lineCount = lines.length;
  const problems = [];

  // count dollar-quote tags, grouped by tag name ("" = bare $$).
  // strip line comments first so a comment mentioning a tag doesn't count.
  const stripped = content.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const tagRe = /\$([A-Za-z_][A-Za-z_0-9]*)?\$/g;
  const counts = new Map();
  let m;
  while ((m = tagRe.exec(stripped)) !== null) {
    const tag = m[1] || "";
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  for (const [tag, count] of counts) {
    if (count % 2 !== 0) {
      problems.push(`unbalanced dollar-quote tag $${tag}$…$${tag}$ (found ${count})`);
    }
  }

  const lastSignificant = [...lines].reverse().map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("--"));
  if (lastSignificant && !lastSignificant.endsWith(";")) {
    problems.push(`file does not end with ';' (last statement: "${lastSignificant.slice(0, 60)}")`);
  }

  if (problems.length > 0) {
    hardFailures++;
    console.log(`FAIL  ${file}  (${lineCount} lines)`);
    for (const p of problems) console.log(`        - ${p}`);
    continue;
  }

  if (lineCount > 150) {
    warnings++;
    console.log(`WARN  ${file}  (${lineCount} lines, >150 — legacy file, do not edit applied migrations)`);
  } else {
    console.log(`OK    ${file}  (${lineCount} lines)`);
  }
}

console.log(`\n${hardFailures} failing file(s), ${warnings} warning(s)`);
process.exit(hardFailures > 0 ? 1 : 0);
