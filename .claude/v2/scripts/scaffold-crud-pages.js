#!/usr/bin/env node
/**
 * scaffold-crud-pages.js — expand the React _crud/ template tree per entity
 * defined in PAGES_PLAN.yaml. Mirrors scaffold-crud-module.js but for the
 * frontend (List + Detail + Create + Edit pages + service + slice + types).
 *
 * Usage:
 *   node .claude/v2/scripts/scaffold-crud-pages.js \
 *        --plan <path/to/PAGES_PLAN.yaml> \
 *        --target <run-dir>/frontend \
 *        --templates <path/to/.claude/react/templates/modules/_crud>
 *
 * Per module entry:
 *   - Renders 4 pages into app/pages/<entity>/
 *   - Renders 1 service into app/services/httpServices/<entity>Service.ts
 *   - Renders 1 slice into app/redux/features/<entity>Slice.ts
 *   - Renders 1 types file into app/types/<entity>.d.ts
 *   - Renders 1 routes file into app/routes/<entity>.routes.ts
 *
 * After scaffold, convert-pages LLM writes ONLY non-CRUD pages (dashboards,
 * wizards, custom flows). Frontend code is mostly deterministic.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') out.plan = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!out.plan || !out.target || !out.templates) {
    printHelp();
    process.exit(1);
  }
  return out;
}

function printHelp() {
  console.log(`scaffold-crud-pages — expand React _crud/ tree per PAGES_PLAN entry

Usage:
  scaffold-crud-pages --plan <yaml> --target <frontend-dir> --templates <_crud-dir> [--dry-run] [-v]
`);
}

// ── case helpers (mirrors backend generator) ───────────────────────────────

function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
}
function toCamel(s) {
  const p = toPascal(s);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
}
function toKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}
function pluralize(s) {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.replace(/y$/i, 'ies');
  return s + 's';
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  const { execSync } = require('child_process');
  const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  return require(path.join(globalPath, 'yaml'));
}

function readPlan(planPath) {
  if (!fs.existsSync(planPath)) {
    console.error(`PAGES_PLAN not found: ${planPath}`);
    process.exit(1);
  }
  const yaml = loadYaml();
  const doc = yaml.parse(fs.readFileSync(planPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.modules)) {
    console.error('PAGES_PLAN must have a top-level `modules:` array');
    process.exit(1);
  }
  return doc;
}

function computeVars(mod) {
  const name = mod.name;
  if (!name) throw new Error('module entry missing `name`');
  const entity = mod.entity || toPascal(name);
  const plural = mod.plural || pluralize(toCamel(name));
  return {
    __Entity__: entity,
    __Entities__: pluralize(entity),
    __entity__: toCamel(name),
    __entities__: plural,
    '__entity-kebab__': toKebab(name),
  };
}

function substitute(text, vars) {
  let out = text;
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const k of keys) out = out.split(k).join(vars[k]);
  return out;
}

// ── field-block renderers ──────────────────────────────────────────────────

function tsTypeFor(field) {
  switch (field.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'datetime': return 'string';
    case 'enum': return field.enumValues
      ? field.enumValues.map((v) => `'${v}'`).join(' | ')
      : 'string';
    case 'ref': return 'string';   // FK ID
    default: return 'string';
  }
}

function renderEntityFields(fields) {
  const lines = [];
  for (const f of fields) {
    if (f.list === false && f.form === false && f.name !== 'id') continue;
    const optional = f.validators?.includes('optional') ? '?' : '';
    lines.push(`  ${f.name}${optional}: ${tsTypeFor(f)};`);
  }
  return lines.join('\n');
}

function renderCreateFields(fields) {
  const lines = [];
  for (const f of fields) {
    if (f.form === false) continue;
    const optional = f.validators?.includes('optional') ? '?' : '';
    lines.push(`  ${f.name}${optional}: ${tsTypeFor(f)};`);
  }
  return lines.join('\n');
}

function renderListHeaders(fields, { features } = { features: [] }) {
  const sortable = (features || []).includes('sort');
  return fields
    .filter((f) => f.list !== false && f.form !== undefined)
    .map((f) => {
      if (sortable && f.sortable !== false) {
        // Clickable header with arrow indicator
        return `              <th
                className="py-2 pr-4 cursor-pointer select-none"
                onClick={() => toggleSort('${f.name}')}
                data-testid="th-${f.name}"
              >
                ${f.label || f.name}
                {sort === '${f.name}' ? ' ↑' : sort === '-${f.name}' ? ' ↓' : ''}
              </th>`;
      }
      return `              <th className="py-2 pr-4">${f.label || f.name}</th>`;
    })
    .join('\n');
}

function renderListCells(fields) {
  return fields
    .filter((f) => f.list !== false && f.form !== undefined)
    .map((f) => `                <td className="py-3 pr-4">{String(item.${f.name} ?? '')}</td>`)
    .join('\n');
}

function hasAnyListFeature(features) {
  const f = features || [];
  return f.includes('search') || f.includes('sort') || f.includes('pagination');
}

function renderUrlParamsImport(features) {
  return hasAnyListFeature(features)
    ? "import { useSearchParams } from 'react-router';"
    : '';
}

function renderUrlParamHooks(features) {
  if (!hasAnyListFeature(features)) return '';
  const f = features || [];
  const lines = [
    "const [searchParams, setSearchParams] = useSearchParams();",
    f.includes('search') ? "  const search = searchParams.get('search') ?? '';" : null,
    f.includes('sort')   ? "  const sort = searchParams.get('sort') ?? '';" : null,
    f.includes('pagination') ? "  const page = Number(searchParams.get('page') ?? '1');" : null,
    "",
    "  function updateParam(key: string, value: string | null) {",
    "    const next = new URLSearchParams(searchParams);",
    "    if (value === null || value === '') next.delete(key);",
    "    else next.set(key, value);",
    "    if (key !== 'page') next.delete('page'); // reset to page 1 on search/sort change",
    "    setSearchParams(next);",
    "  }",
  ];
  if (f.includes('sort')) {
    lines.push("");
    lines.push("  function toggleSort(field: string) {");
    lines.push("    if (sort === field) updateParam('sort', '-' + field);");
    lines.push("    else if (sort === '-' + field) updateParam('sort', null);");
    lines.push("    else updateParam('sort', field);");
    lines.push("  }");
  }
  return lines.filter((l) => l !== null).join('\n  ');
}

function renderUseEffect(entityPascal, features) {
  const f = features || [];
  const callArgs = ['limit: pagination.limit'];
  const deps = ['dispatch', 'pagination.limit'];
  if (f.includes('pagination')) {
    callArgs.unshift('page');
    deps.push('page');
  } else {
    callArgs.unshift('page: 1');
  }
  if (f.includes('search')) {
    callArgs.push('search: search || undefined');
    deps.push('search');
  }
  if (f.includes('sort')) {
    callArgs.push('sort: sort || undefined');
    deps.push('sort');
  }
  return (
    'useEffect(() => {\n' +
    '    dispatch(fetch' + entityPascal + 'List({ ' + callArgs.join(', ') + ' }));\n' +
    '  }, [' + deps.join(', ') + ']);'
  );
}

function renderSearchInputImport(features) {
  return (features || []).includes('search')
    ? "import { Input } from '~/components/ui/input';"
    : '';
}

function renderSearchSection(entityKebab, features) {
  if (!(features || []).includes('search')) return '';
  return `<section className="mb-4 flex items-center gap-2" data-testid="${entityKebab}-list-toolbar">
        <Input
          type="search"
          placeholder={t('actions.search')}
          value={search}
          onChange={(e) => updateParam('search', e.target.value)}
          data-testid="${entityKebab}-list-search"
          className="max-w-xs"
        />
      </section>`;
}

function renderPaginationSection(entityKebab, features) {
  if (!(features || []).includes('pagination')) return '';
  return `<nav className="mt-4 flex items-center justify-between" data-testid="${entityKebab}-list-pagination" aria-label="pagination">
            <span className="text-sm text-muted-foreground" data-testid="${entityKebab}-list-pagination-info">
              {t('pagination.page')} {pagination.page ?? page}{pagination.totalPages ? \` / \${pagination.totalPages}\` : ''}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => updateParam('page', String(Math.max(1, page - 1)))}
                disabled={page <= 1}
                data-testid="${entityKebab}-list-prev"
              >
                {t('pagination.prev')}
              </Button>
              <Button
                variant="outline"
                onClick={() => updateParam('page', String(page + 1))}
                disabled={items.length < (pagination.limit ?? 10)}
                data-testid="${entityKebab}-list-next"
              >
                {t('pagination.next')}
              </Button>
            </div>
          </nav>`;
}

function renderDetailRows(fields, relations) {
  // Inline (top-of-page) <dl> rows. Includes scalar fields + belongs-to
  // (ref) relations as a single line. has_many relations are rendered
  // as separate sections by renderDetailRelationsSections() instead.
  const lines = [];
  for (const f of fields) {
    if (f.list === false && f.form === false) continue;
    lines.push(`        <dt className="font-medium">${f.label || f.name}</dt>`);
    lines.push(`        <dd>{String(current.${f.name} ?? '')}</dd>`);
  }
  for (const r of relations || []) {
    if (r.type === 'has_many') continue; // rendered as a separate section
    // TS-safe access: relations aren't in the generated entity type, so we
    // route through `Record<string, unknown>` for every lookup. The optional
    // `displayField` picks a property of the related object (e.g. org.name)
    // and falls back to the raw value if absent.
    lines.push(`        <dt className="font-medium">${r.label || r.field}</dt>`);
    if (r.type === 'ref' && r.displayField) {
      lines.push(`        <dd>{String(((current as Record<string, unknown>).${r.field} as Record<string, unknown> | null | undefined)?.${r.displayField} ?? (current as Record<string, unknown>).${r.field} ?? '')}</dd>`);
    } else {
      lines.push(`        <dd>{String((current as Record<string, unknown>).${r.field} ?? '')}</dd>`);
    }
  }
  return lines.join('\n');
}

function renderDetailRelationsSections(entityKebab, relations) {
  // For each has_many relation, render a section with a nested table.
  // Expects the backend to return the related items embedded under the
  // relation's property name (e.g. current.applications: Application[]).
  // PAGES_PLAN entry shape:
  //   detail_relations:
  //     - field: applications
  //       label: "Applications"
  //       type: has_many
  //       targetEntity: Application       # optional, doc-only
  //       columns: [id, serviceType, status, createdAt]
  //                                       # which props to show (default: [id])
  const hasManyRels = (relations || []).filter((r) => r.type === 'has_many');
  if (hasManyRels.length === 0) return '';

  const sections = [];
  for (const r of hasManyRels) {
    const cols = Array.isArray(r.columns) && r.columns.length > 0 ? r.columns : ['id'];
    const sectionTestId = `${entityKebab}-detail-${r.field}`;
    const headers = cols.map((c) => `              <th className="py-2 pr-4 capitalize">${String(c)}</th>`).join('\n');
    const cells = cols.map((c) => `                <td className="py-3 pr-4">{String((row as Record<string, unknown>).${c} ?? '')}</td>`).join('\n');
    sections.push(
      `<section className="mt-8" data-testid="${sectionTestId}">\n` +
      `        <h2 className="mb-3 text-lg font-medium">${r.label || r.field}</h2>\n` +
      `        {Array.isArray((current as Record<string, unknown>).${r.field}) && ((current as Record<string, unknown>).${r.field} as unknown[]).length > 0 ? (\n` +
      `          <table className="w-full border-collapse" data-testid="${sectionTestId}-table">\n` +
      `            <thead>\n` +
      `              <tr className="border-b text-left text-sm text-muted-foreground">\n` +
      headers + '\n' +
      `              </tr>\n` +
      `            </thead>\n` +
      `            <tbody>\n` +
      `              {((current as Record<string, unknown>).${r.field} as Array<Record<string, unknown>>).map((row, idx) => (\n` +
      `                <tr key={(row.id as string) ?? idx} className="border-b" data-testid={\`${sectionTestId}-row-\${idx}\`}>\n` +
      cells + '\n' +
      `                </tr>\n` +
      `              ))}\n` +
      `            </tbody>\n` +
      `          </table>\n` +
      `        ) : (\n` +
      `          <p className="text-sm text-muted-foreground" data-testid="${sectionTestId}-empty">{t('empty.title')}</p>\n` +
      `        )}\n` +
      `      </section>`
    );
  }
  return sections.join('\n\n      ');
}

function renderCreateSchema(fields, mode) {
  // Build a zod schema literal. `mode='create'` = all form fields,
  // `mode='update'` is wrapped .partial() at the call site.
  //
  // v70 form-validators: each validator emits a zod method with a clear
  // user-facing error message. The <FormMessage /> in the form template
  // surfaces these directly (no extra wiring needed).
  //
  // Supported validators (PAGES_PLAN.fields[].validators[]):
  //   required             → string .min(1, 'Required'); skipped if also 'optional'
  //   optional             → .optional()
  //   email                → .email('Please enter a valid email')
  //   minLength:N          → .min(N, 'Must be at least N characters')
  //   maxLength:N          → .max(N, 'Must be at most N characters')
  //   min:N (number)       → .min(N, 'Must be ≥ N')
  //   max:N (number)       → .max(N, 'Must be ≤ N')
  //   pattern:/regex/flags → .regex(/.../, 'Invalid format')
  //   url                  → .url('Please enter a valid URL')
  //   uuid                 → .uuid('Invalid id')
  //   string / enum / etc. → base zod for the field type
  const lines = [];
  const formFields = fields.filter((f) => f.form !== false);
  for (const f of formFields) {
    const validators = f.validators || [];
    const isOptional = validators.includes('optional');
    const fieldLabel = (f.label || f.name);
    let zod = 'z.string()';
    switch (f.type) {
      case 'number': zod = 'z.coerce.number({ invalid_type_error: \'Must be a number\' })'; break;
      case 'boolean': zod = 'z.boolean()'; break;
      case 'datetime': zod = 'z.string()'; break;
      case 'enum': {
        const vals = (f.enumValues || []).map((v) => `'${v}'`).join(', ');
        zod = `z.enum([${vals}], { errorMap: () => ({ message: 'Please select a valid ${fieldLabel}' }) })`;
        break;
      }
      default: zod = 'z.string()';
    }

    // Apply validator decorators in declaration order. We parse `key:value`
    // pairs and call the matching zod method. Default `.min(1)` for strings
    // when `required` is declared (or no `optional`).
    let hasMinLen = false;
    let hasMin = false;
    for (const v of validators) {
      const str = String(v);
      const colonIdx = str.indexOf(':');
      const key = colonIdx === -1 ? str : str.slice(0, colonIdx);
      const arg = colonIdx === -1 ? '' : str.slice(colonIdx + 1);
      switch (key) {
        case 'email':
          zod += `.email('Please enter a valid email')`;
          break;
        case 'url':
          zod += `.url('Please enter a valid URL')`;
          break;
        case 'uuid':
          zod += `.uuid('Invalid id')`;
          break;
        case 'minLength':
          if (arg) { zod += `.min(${Number(arg)}, 'Must be at least ${Number(arg)} character${Number(arg)===1?'':'s'}')`; hasMinLen = true; }
          break;
        case 'maxLength':
          if (arg) zod += `.max(${Number(arg)}, 'Must be at most ${Number(arg)} character${Number(arg)===1?'':'s'}')`;
          break;
        case 'min':
          if (arg && f.type === 'number') { zod += `.min(${Number(arg)}, 'Must be ≥ ${Number(arg)}')`; hasMin = true; }
          break;
        case 'max':
          if (arg && f.type === 'number') zod += `.max(${Number(arg)}, 'Must be ≤ ${Number(arg)}')`;
          break;
        case 'pattern': {
          // Expect arg like /regex/flags or plain regex without delimiters
          let re = arg;
          if (!re.startsWith('/')) re = `/${re}/`;
          zod += `.regex(${re}, '${fieldLabel} has invalid format')`;
          break;
        }
        case 'required':
        case 'optional':
        case 'string':
        case 'number':
        case 'enum':
          // handled separately
          break;
        default:
          // unknown validator name — skip silently (forward-compat)
          break;
      }
    }
    // Default: require non-empty string when not explicitly optional and no
    // explicit minLength already set.
    if (!isOptional && f.type === 'string' && !hasMinLen) {
      zod += `.min(1, '${fieldLabel} is required')`;
    }
    if (isOptional) zod += '.optional()';
    lines.push(`  ${f.name}: ${zod},`);
  }
  return lines.join('\n');
}

function renderCreateDefaults(fields) {
  const lines = [];
  for (const f of fields) {
    if (f.form === false) continue;
    let def = "''";
    if (f.type === 'number') def = '0';
    else if (f.type === 'boolean') def = 'false';
    else if (f.type === 'enum') def = `'${(f.enumValues || [''])[0]}'`;
    lines.push(`      ${f.name}: ${def},`);
  }
  return lines.join('\n');
}

function renderCreateFormFields(fields, mode) {
  const formFields = fields.filter((f) => f.form !== false);
  const lines = [];
  for (const f of formFields) {
    lines.push(`          <FormField`);
    lines.push(`            control={form.control}`);
    lines.push(`            name="${f.name}"`);
    lines.push(`            render={({ field }) => (`);
    lines.push(`              <FormItem>`);
    lines.push(`                <FormLabel>${f.label || f.name}</FormLabel>`);
    lines.push(`                <FormControl>`);
    if (f.type === 'enum' && Array.isArray(f.enumValues) && f.enumValues.length > 0) {
      // v63 fix: enum fields render as native <select> (no Shadcn Select import
      // assumed available — string union type is preserved in form state).
      lines.push(`                  <select`);
      lines.push(`                    data-testid="__entity__-form-${f.name}"`);
      lines.push(`                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"`);
      lines.push(`                    value={(field.value as string | undefined) ?? ''}`);
      lines.push(`                    onChange={(e) => field.onChange(e.target.value)}`);
      lines.push(`                    onBlur={field.onBlur}`);
      lines.push(`                    name={field.name}`);
      lines.push(`                    ref={field.ref}`);
      lines.push(`                  >`);
      lines.push(`                    <option value="">— Select —</option>`);
      for (const v of f.enumValues) {
        lines.push(`                    <option value="${v}">${v}</option>`);
      }
      lines.push(`                  </select>`);
    } else if (f.type === 'boolean') {
      lines.push(`                  <input`);
      lines.push(`                    data-testid="__entity__-form-${f.name}"`);
      lines.push(`                    type="checkbox"`);
      lines.push(`                    checked={!!field.value}`);
      lines.push(`                    onChange={(e) => field.onChange(e.target.checked)}`);
      lines.push(`                    name={field.name}`);
      lines.push(`                  />`);
    } else {
      // Default: text Input for string / number / datetime
      const inputType = f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : 'text';
      lines.push(`                  <Input`);
      lines.push(`                    data-testid="__entity__-form-${f.name}"`);
      lines.push(`                    type="${inputType}"`);
      lines.push(`                    {...field}`);
      lines.push(`                    value={(field.value as string | number | undefined) ?? ''}`);
      lines.push(`                  />`);
    }
    lines.push(`                </FormControl>`);
    lines.push(`                <FormMessage />`);
    lines.push(`              </FormItem>`);
    lines.push(`            )}`);
    lines.push(`          />`);
  }
  return lines.join('\n');
}

// ── per-module scaffold ────────────────────────────────────────────────────

function scaffoldModule(mod, templatesDir, frontendDir, opts) {
  const vars = computeVars(mod);
  const entityKebab = vars['__entity-kebab__'];
  const entityCamel = vars['__entity__'];

  const appDir = path.join(frontendDir, 'app');
  const dests = {
    types: path.join(appDir, 'types', `${entityCamel}.d.ts`),
    service: path.join(appDir, 'services', 'httpServices', `${entityCamel}Service.ts`),
    slice: path.join(appDir, 'redux', 'features', `${entityCamel}Slice.ts`),
    list: path.join(appDir, 'pages', entityCamel, `${vars.__Entity__}ListPage.tsx`),
    detail: path.join(appDir, 'pages', entityCamel, `${vars.__Entity__}DetailPage.tsx`),
    create: path.join(appDir, 'pages', entityCamel, `${vars.__Entity__}CreatePage.tsx`),
    edit: path.join(appDir, 'pages', entityCamel, `${vars.__Entity__}EditPage.tsx`),
    routes: path.join(appDir, 'routes', `${entityCamel}.routes.ts`),
  };

  const fields = mod.fields || [];
  const relations = mod.detail_relations || [];

  // v70: dashboard-management features (search / pagination / sort).
  // Filter chips deferred to v71 — they require backend `where` clause
  // support which isn't yet uniform across BaseController implementations.
  const features = Array.isArray(mod.list_features) ? mod.list_features : [];

  // Pre-render the marker blocks
  const blocks = {
    __ENTITY_FIELDS__: renderEntityFields(fields),
    __CREATE_FIELDS__: renderCreateFields(fields),
    __LIST_HEADERS__: renderListHeaders(fields, { features }),
    __LIST_CELLS__: renderListCells(fields),
    __URL_PARAMS_IMPORT__: renderUrlParamsImport(features),
    __URL_PARAM_HOOKS__: renderUrlParamHooks(features),
    __USEEFFECT__: renderUseEffect(vars.__Entity__, features),
    __SEARCH_INPUT_IMPORT__: renderSearchInputImport(features),
    __SEARCH_SECTION__: renderSearchSection(entityKebab, features),
    __PAGINATION_SECTION__: renderPaginationSection(entityKebab, features),
    __DETAIL_ROWS__: renderDetailRows(fields, relations),
    __DETAIL_RELATIONS_SECTIONS__: renderDetailRelationsSections(entityKebab, relations),
    __CREATE_SCHEMA_IMPORTS__: "import { z } from 'zod';",
    __CREATE_SCHEMA__:
      `const create${vars.__Entity__}Schema = z.object({\n` +
      renderCreateSchema(fields, 'create') +
      `\n});`,
    __CREATE_DEFAULTS__: renderCreateDefaults(fields),
    __CREATE_FORM_FIELDS__: renderCreateFormFields(fields, 'create'),
    __EDIT_SCHEMA_IMPORTS__: "import { z } from 'zod';",
    __EDIT_SCHEMA__:
      `const update${vars.__Entity__}Schema = z.object({\n` +
      renderCreateSchema(fields, 'update') +
      `\n}).partial();`,
    __EDIT_FORM_FIELDS__: renderCreateFormFields(fields, 'edit'),
    __TYPE_IMPORTS__: '', // no imports yet for the type file
  };

  function renderFile(srcRel, dst) {
    const srcPath = path.join(templatesDir, srcRel);
    if (!fs.existsSync(srcPath)) {
      console.error(`template missing: ${srcPath}`);
      process.exit(2);
    }
    let rendered = substitute(fs.readFileSync(srcPath, 'utf-8'), vars);
    for (const [marker, block] of Object.entries(blocks)) {
      // Match `// __MARKER__` lines (with optional leading whitespace) so
      // the block replaces the comment cleanly. Markers also accepted as
      // standalone tokens inside JSX comments {/* __MARKER__ */}.
      // Substitute case-placeholders inside the block too — block renderers
      // emit `__entity__-form-${f.name}` etc. and those need to become
      // `user-form-email` in the final output.
      const substitutedBlock = substitute(block, vars);
      const reLine = new RegExp(`^\\s*\\/\\/ ${marker}\\s*$`, 'm');
      rendered = rendered.replace(reLine, () => substitutedBlock); // v128: $-backreference-safe
      const reJsx = new RegExp(`\\{\\s*\\/\\*\\s*${marker}\\s*\\*\\/\\s*\\}`, 'g');
      rendered = rendered.replace(reJsx, () => substitutedBlock); // v128: $-backreference-safe
    }

    if (fs.existsSync(dst)) {
      const existing = fs.readFileSync(dst, 'utf-8');
      if (existing === rendered) return 'skipped';
      return 'customized';
    }
    if (opts.dryRun) {
      console.log(`  [dry] would write ${path.relative(frontendDir, dst)} (${rendered.length} bytes)`);
      return 'written';
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, rendered);
    return 'written';
  }

  const files = [
    ['types/__entity__.d.ts',                          dests.types],
    ['services/api/__entity__Service.ts',              dests.service],
    ['redux/features/__entity__Slice.ts',              dests.slice],
    ['pages/__Entity__ListPage.tsx',                   dests.list],
    ['pages/__Entity__DetailPage.tsx',                 dests.detail],
    ['pages/__Entity__CreatePage.tsx',                 dests.create],
    ['pages/__Entity__EditPage.tsx',                   dests.edit],
    ['routes/__entity__.routes.ts',                    dests.routes],
  ];

  let written = 0, skipped = 0, customized = 0;
  for (const [srcRel, dst] of files) {
    const result = renderFile(srcRel, dst);
    if (result === 'written') written++;
    else if (result === 'skipped') skipped++;
    else customized++;
  }
  return { written, skipped, customized, moduleKebab: entityKebab };
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.templates)) {
    console.error(`templates dir missing: ${args.templates}`);
    process.exit(2);
  }
  const plan = readPlan(args.plan);

  console.log(`scaffold-crud-pages: ${plan.modules.length} module(s) from ${args.plan}`);
  console.log(`  target:    ${args.target}`);
  console.log(`  templates: ${args.templates}`);
  if (args.dryRun) console.log('  mode:      DRY RUN');

  let total = { written: 0, skipped: 0, customized: 0, modules: 0 };
  for (const mod of plan.modules) {
    try {
      const r = scaffoldModule(mod, args.templates, args.target, args);
      console.log(`  [${r.moduleKebab}] written=${r.written} skipped=${r.skipped} customized=${r.customized}`);
      total.written += r.written;
      total.skipped += r.skipped;
      total.customized += r.customized;
      total.modules += 1;
    } catch (err) {
      console.error(`  [${mod.name || '<unnamed>'}] FAIL: ${err.message}`);
      process.exit(3);
    }
  }

  console.log(`\nDone. ${total.modules} module(s), wrote ${total.written}, kept ${total.skipped + total.customized} (${total.customized} LLM-customized).`);
}

main();
