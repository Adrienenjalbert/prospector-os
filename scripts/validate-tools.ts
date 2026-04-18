/**
 * validate-tools.ts — slug-parity check across the tool integration surface.
 *
 * Usage:
 *   npx tsx scripts/validate-tools.ts        # normal run, exit 1 on drift
 *   npx tsx scripts/validate-tools.ts --warn # warn-only, exit 0
 *
 * Why this script exists
 * ----------------------
 * Adding a tool requires touching three files in the right order:
 *
 *   1. `apps/web/src/lib/agent/tools/handlers.ts`         (factory bridge OR standalone register)
 *   2. `scripts/seed-tools.ts`                            (DB row per tenant)
 *   3. `apps/web/src/lib/agent/tools/handlers/*.ts`       (handler impl, if standalone)
 *
 * Two failure modes are silent without this check:
 *
 *   A. **Orphan registry row** — a slug in `seed-tools.ts` with no
 *      handler. Production sees a row, but `tool-loader.ts` drops it
 *      (a `tool_registry_drift` event eventually surfaces, but the
 *      tenant runs without that tool until ops notices). CI should
 *      catch this before merge.
 *
 *   B. **Orphan handler** — a registered TS handler with no seed row.
 *      The agent never sees the tool because the per-tenant
 *      `tool_registry` query returns no row. The eval suite looks
 *      green if no golden references the slug.
 *
 * Both directions become CI fails here.
 */

import { Project, SyntaxKind, type SourceFile } from 'ts-morph'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

// Argument parsing — `--warn` flips the exit code so devs can iterate
// locally without a hard fail. CI runs without flags.
const ARGS = process.argv.slice(2)
const WARN_ONLY = ARGS.includes('--warn')
const JSON_OUT = ARGS.includes('--json')

function relPath(p: string): string {
  return p.replace(`${ROOT}/`, '')
}

function fail(message: string): never {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, error: message }))
  } else {
    console.error(`validate-tools: ${message}`)
  }
  process.exit(WARN_ONLY ? 0 : 1)
}

// ---------------------------------------------------------------------------
// 1. Pull every slug from `scripts/seed-tools.ts#BUILTIN_TOOLS`
// ---------------------------------------------------------------------------

function extractSeedSlugs(project: Project): string[] {
  const seedPath = join(ROOT, 'scripts/seed-tools.ts')
  const source = project.addSourceFileAtPath(seedPath)
  const declaration = source
    .getVariableStatements()
    .flatMap((s) => s.getDeclarations())
    .find((d) => d.getName() === 'BUILTIN_TOOLS')
  if (!declaration) {
    fail(`BUILTIN_TOOLS not found in ${relPath(seedPath)}`)
  }
  const init = declaration.getInitializer()
  if (!init) {
    fail(`BUILTIN_TOOLS has no initializer in ${relPath(seedPath)}`)
  }
  const slugs: string[] = []
  init.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.PropertyAssignment) return
    const pa = node.asKindOrThrow(SyntaxKind.PropertyAssignment)
    if (pa.getName() !== 'slug') return
    const value = pa.getInitializerIfKind(SyntaxKind.StringLiteral)
    if (value) slugs.push(value.getLiteralText())
  })
  return slugs
}

// ---------------------------------------------------------------------------
// 2. Pull every slug from `handlers.ts#SLUG_TO_FACTORY` keys
//    AND every standalone `registerToolHandler(...)` call.
// ---------------------------------------------------------------------------

function extractHandlerSlugs(project: Project): {
  factorySlugs: string[]
  standaloneSlugs: string[]
} {
  const handlersPath = join(ROOT, 'apps/web/src/lib/agent/tools/handlers.ts')
  const source = project.addSourceFileAtPath(handlersPath)

  // Factory slugs live as keys of the SLUG_TO_FACTORY object literal.
  const factorySlugs: string[] = []
  const factoryDecl = source
    .getVariableStatements()
    .flatMap((s) => s.getDeclarations())
    .find((d) => d.getName() === 'SLUG_TO_FACTORY')
  if (factoryDecl) {
    const init = factoryDecl.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)
    if (init) {
      for (const prop of init.getProperties()) {
        if (prop.getKind() === SyntaxKind.PropertyAssignment) {
          const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
          factorySlugs.push(pa.getName().replace(/['"]/g, ''))
        }
      }
    }
  }

  // Standalone handler slugs come from imports of `*Handler` symbols
  // that get passed to `registerToolHandler(...)`. We resolve each
  // imported handler symbol to its source file's exported `slug`
  // string literal — that's the canonical name even if the variable
  // is renamed at the import site.
  const standaloneSlugs: string[] = []
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (expr.getText() !== 'registerToolHandler') continue
    const arg = call.getArguments()[0]
    if (!arg) continue
    const symbol = arg.getSymbol()
    if (!symbol) continue
    const decls = symbol.getDeclarations()
    for (const decl of decls) {
      // `decl` is the import specifier; follow it to the original
      // exported variable in the handler file.
      const aliasedSymbol = symbol.getAliasedSymbol() ?? symbol
      const orig = aliasedSymbol.getDeclarations()[0]
      if (!orig) continue
      const initializer = orig.getKindName() === 'VariableDeclaration'
        ? orig.asKindOrThrow(SyntaxKind.VariableDeclaration).getInitializer()
        : null
      if (!initializer) continue
      // Walk the object literal looking for `slug: '...'`.
      initializer.forEachDescendant((d) => {
        if (d.getKind() !== SyntaxKind.PropertyAssignment) return
        const pa = d.asKindOrThrow(SyntaxKind.PropertyAssignment)
        if (pa.getName() !== 'slug') return
        const lit = pa.getInitializerIfKind(SyntaxKind.StringLiteral)
        if (lit) standaloneSlugs.push(lit.getLiteralText())
      })
      break
    }
    // Suppress unused-var lint for the loop variable.
    void decls
  }

  return { factorySlugs, standaloneSlugs }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const project = new Project({
    tsConfigFilePath: join(ROOT, 'apps/web/tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  })

  const seedSlugs = new Set(extractSeedSlugs(project))
  const { factorySlugs, standaloneSlugs } = extractHandlerSlugs(project)
  const handlerSlugs = new Set([...factorySlugs, ...standaloneSlugs])

  // Drift A: a slug is in seed but has no handler.
  const orphanSeed: string[] = []
  for (const slug of seedSlugs) {
    if (!handlerSlugs.has(slug)) orphanSeed.push(slug)
  }

  // Drift B: a handler is registered with no seed row.
  const orphanHandler: string[] = []
  for (const slug of handlerSlugs) {
    if (!seedSlugs.has(slug)) orphanHandler.push(slug)
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify({
        ok: orphanSeed.length === 0 && orphanHandler.length === 0,
        seed_count: seedSlugs.size,
        handler_count: handlerSlugs.size,
        orphan_seed: orphanSeed,
        orphan_handler: orphanHandler,
      }),
    )
    process.exit(orphanSeed.length || orphanHandler.length ? (WARN_ONLY ? 0 : 1) : 0)
  }

  if (orphanSeed.length === 0 && orphanHandler.length === 0) {
    console.log(
      `validate-tools: OK — ${seedSlugs.size} seed slugs, ${handlerSlugs.size} handler slugs (all aligned)`,
    )
    process.exit(0)
  }

  if (orphanSeed.length > 0) {
    console.error(
      `validate-tools: ${orphanSeed.length} seed slug(s) without a handler:`,
    )
    for (const s of orphanSeed) console.error(`  - ${s}`)
  }
  if (orphanHandler.length > 0) {
    console.error(
      `validate-tools: ${orphanHandler.length} handler(s) without a seed row:`,
    )
    for (const s of orphanHandler) console.error(`  - ${s}`)
  }
  console.error(
    `\n  Add the missing slug to handlers.ts (factory or standalone) or to scripts/seed-tools.ts.`,
  )
  process.exit(WARN_ONLY ? 0 : 1)
}

main()
