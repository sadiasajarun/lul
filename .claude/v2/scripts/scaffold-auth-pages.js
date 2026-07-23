#!/usr/bin/env node
// scaffold-auth-pages.js — auth pages (login/signup/forgot/verify) from
// PAGES_PLAN.yaml auth_pages: section. Reads MODULE_PLAN.yaml's auth:
// section for identifier_field + signup_fields + roles (cross-referenced
// to keep frontend wiring consistent with backend).
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--plan') out.plan = argv[++i];
    else if (a === '--module-plan') out.modulePlan = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.plan || !out.target || !out.templates) {
    console.error('Usage: scaffold-auth-pages --plan PAGES_PLAN --module-plan MODULE_PLAN --target FRONTEND_DIR --templates _auth/');
    process.exit(1);
  }
  return out;
}
function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function renderSignupStateHooks(fields) {
  return fields.map(function (f) {
    return "  const [" + f.name + ", set" + cap(f.name) + "] = useState('');";
  }).join('\n');
}
function renderSignupSubmitFields(fields) {
  return fields.map(function (f) { return '      ' + f.name + ','; }).join('\n');
}
function renderSignupFieldInputs(fields) {
  var lines = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var label = f.label || cap(f.name);
    var isEmail = f.type === 'email' || /email/i.test(f.name);
    var inputType = isEmail ? 'email' : (f.type === 'password' || /password/i.test(f.name) ? 'password' : 'text');
    lines.push('        <div>');
    lines.push('          <Label htmlFor="' + f.name + '">' + label + '</Label>');
    lines.push('          <Input');
    lines.push('            id="' + f.name + '"');
    lines.push('            type="' + inputType + '"');
    lines.push('            value={' + f.name + '}');
    lines.push('            onChange={(e) => set' + cap(f.name) + '(e.target.value)}');
    if (!f.optional) lines.push('            required');
    lines.push('            data-testid="signup-' + f.name + '"');
    lines.push('          />');
    lines.push('        </div>');
  }
  return lines.join('\n');
}
function renderSignupFieldTypes(fields) {
  return fields.map(function (f) {
    return '  ' + f.name + (f.optional ? '?' : '') + ': ' + (f.type === 'enum' ? 'string' : (f.type || 'string')) + ';';
  }).join('\n');
}
function renderRoleHomeRedirect(roleHomeMap) {
  if (!roleHomeMap || Object.keys(roleHomeMap).length === 0) return '';
  var lines = ['if (result.payload?.user) {'];
  lines.push('        const role = result.payload.user.role;');
  Object.keys(roleHomeMap).forEach(function (r, i) {
    var kw = i === 0 ? 'if' : 'else if';
    lines.push('        ' + kw + " (role === '" + r + "') return navigate('" + roleHomeMap[r] + "');");
  });
  lines.push('      }');
  return lines.join('\n      ');
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  if (!fs.existsSync(srcPath)) { console.error('template missing: ' + srcPath); process.exit(2); }
  var content = fs.readFileSync(srcPath, 'utf-8');

  // STEP 1: marker-line substitutions. Two forms supported:
  //   - // __KEY__                  (JS-style, anywhere)
  //   - {/* __KEY__ */}             (JSX comment in TSX files)
  // Render functions are responsible for their own indentation — we just
  // blast the whole marker line (leading whitespace included) with the
  // replacement value.
  Object.keys(replacements).forEach(function (key) {
    var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var patterns = [
      new RegExp('^[ \\t]*// ' + esc + '[ \\t]*$', 'gm'),
      new RegExp('^[ \\t]*\\{/\\*\\s*' + esc + '\\s*\\*/\\}[ \\t]*$', 'gm'),
    ];
    patterns.forEach(function (re) {
      content = content.replace(re, function () { return replacements[key]; }); // v128: $-backreference-safe
    });
  });
  // Strip trailing empty lines created by removed markers
  content = content.replace(/\n{3,}/g, '\n\n');

  // STEP 2: plain identifier replacement
  Object.keys(replacements).forEach(function (key) {
    content = content.split(key).join(replacements[key]);
  });

  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dstPath));
    return;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.plan)) { console.error('PAGES_PLAN missing: ' + args.plan); process.exit(1); }
  var yaml = loadYaml();
  var plan = yaml.parse(fs.readFileSync(args.plan, 'utf-8'));
  var ap = plan && plan.auth_pages;
  if (!ap || (!ap.login && !ap.signup && !ap.forgot_password && !ap.verify_email)) {
    console.log('scaffold-auth-pages: no auth_pages — skipping');
    return;
  }

  var auth = null;
  if (args.modulePlan && fs.existsSync(args.modulePlan)) {
    var mp = yaml.parse(fs.readFileSync(args.modulePlan, 'utf-8'));
    auth = (mp && mp.auth) || null;
  }
  var identifier = (auth && auth.identifier_field) || 'email';
  var identifierType = identifier === 'email' ? 'email' : 'text';
  var signupFields = (auth && auth.signup_fields) || [{ name: identifier, type: identifierType }];
  var roleHomeMap = ap.role_home || (auth && auth.role_home) || {};

  console.log('scaffold-auth-pages: identifier=' + identifier + ', roles=' + ((auth && auth.roles) || []).join(',') + ', flags=' + JSON.stringify(ap));

  var replacements = {
    '__IDENTIFIER_FIELD__': identifier,
    '__IDENTIFIER_FIELD_CAP__': cap(identifier),
    '__IDENTIFIER_INPUT_TYPE__': identifierType,
    '__SIGNUP_STATE_HOOKS__': renderSignupStateHooks(signupFields),
    '__SIGNUP_SUBMIT_FIELDS__': renderSignupSubmitFields(signupFields),
    '__SIGNUP_FIELD_INPUTS__': renderSignupFieldInputs(signupFields),
    '__SIGNUP_FIELD_TYPES__': renderSignupFieldTypes(signupFields),
    '__EXTRA_USER_FIELDS__': '',
    '__ROLE_HOME_REDIRECT__': renderRoleHomeRedirect(roleHomeMap),
    '__FORGOT_PASSWORD_LINK__': ap.forgot_password
      ? '<Link to="/forgot-password" data-testid="login-forgot-link">{t(\'auth.login.forgot_cta\')}</Link>'
      : '',
    '__FORGOT_PASSWORD_FNS__': ap.forgot_password
      ? [
          "export function requestPasswordReset(body: { " + identifier + ": string }): Promise<void> {",
          "  return post<void>(`${BASE}/forgot-password`, body);",
          "}",
          "",
          "export function resetPassword(body: { token: string; password: string }): Promise<void> {",
          "  return post<void>(`${BASE}/reset-password`, body);",
          "}",
          "",
          (ap.verify_email
            ? "export function verifyEmail(body: { token: string }): Promise<void> {\n  return post<void>(`${BASE}/verify-email`, body);\n}"
            : ''),
        ].join('\n')
      : (ap.verify_email
          ? "export function verifyEmail(body: { token: string }): Promise<void> {\n  return post<void>(`${BASE}/verify-email`, body);\n}"
          : ''),
    '__AUTH_ROUTE_SIGNUP__': ap.signup ? "  route('signup', 'pages/auth/SignupPage.tsx')," : '',
    '__AUTH_ROUTE_FORGOT__': ap.forgot_password ? "  route('forgot-password', 'pages/auth/ForgotPasswordPage.tsx')," : '',
    '__AUTH_ROUTE_VERIFY__': ap.verify_email ? "  route('verify-email', 'pages/auth/VerifyEmailPage.tsx')," : '',
  };

  var FE = args.target;
  var TPL = args.templates;
  var pages = [];
  if (ap.login) pages.push(['pages/LoginPage.tsx', path.join(FE, 'app/pages/auth/LoginPage.tsx')]);
  if (ap.signup) pages.push(['pages/SignupPage.tsx', path.join(FE, 'app/pages/auth/SignupPage.tsx')]);
  if (ap.forgot_password) pages.push(['pages/ForgotPasswordPage.tsx', path.join(FE, 'app/pages/auth/ForgotPasswordPage.tsx')]);
  if (ap.verify_email) pages.push(['pages/VerifyEmailPage.tsx', path.join(FE, 'app/pages/auth/VerifyEmailPage.tsx')]);

  pages.push(['services/api/authService.ts', path.join(FE, 'app/services/httpServices/authService.ts')]);
  pages.push(['redux/features/authSlice.ts', path.join(FE, 'app/redux/features/authSlice.ts')]);
  pages.push(['types/auth.d.ts', path.join(FE, 'app/types/auth.d.ts')]);
  pages.push(['routes/auth.routes.ts', path.join(FE, 'app/routes/auth.routes.ts')]);

  for (var i = 0; i < pages.length; i++) {
    substituteFile(path.join(TPL, pages[i][0]), pages[i][1], replacements, args);
  }
  console.log('scaffold-auth-pages: wrote ' + pages.length + ' files');
}

main();
