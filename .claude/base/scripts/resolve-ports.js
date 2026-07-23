const fs = require('fs');
const path = require('path');

/**
 * Resolve port assignments for a project.
 *
 * Priority:
 *   1. PORT_BASE env var (local override)
 *   2. port-map.json lookup by project directory name
 *   3. Deterministic hash fallback (4000–9990 range)
 *
 * @param {string} projectRoot - absolute path to the project root
 * @returns {{ backend: number, frontend: number, dashboardBasePort: number }}
 */
function resolvePorts(projectRoot) {
  const projectName = path.basename(projectRoot);

  // Priority 1: PORT_BASE environment variable
  if (process.env.PORT_BASE) {
    const base = parseInt(process.env.PORT_BASE, 10);
    return { backend: base, frontend: base + 1, dashboardBasePort: base + 2 };
  }

  // Priority 2: port-map.json from .claude submodule
  const portMapPath = path.join(projectRoot, '.claude', 'base', 'port-map.json');
  if (fs.existsSync(portMapPath)) {
    const portMap = JSON.parse(fs.readFileSync(portMapPath, 'utf8'));
    const base = portMap.projects[projectName];
    if (base !== undefined) {
      const offsets = portMap.offsets || { backend: 0, frontend: 1, dashboardBase: 2 };
      return {
        backend: base + offsets.backend,
        frontend: base + offsets.frontend,
        dashboardBasePort: base + offsets.dashboardBase,
      };
    }
  }

  // Priority 3: Deterministic hash fallback for unregistered projects
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = ((hash << 5) - hash + projectName.charCodeAt(i)) | 0;
  }
  const base = 4000 + (Math.abs(hash) % 600) * 10;
  return { backend: base, frontend: base + 1, dashboardBasePort: base + 2 };
}

module.exports = { resolvePorts };
