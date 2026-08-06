const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/*
 * Metro does not follow npm-workspace symlinks on its own. Without the watch
 * folder it never sees packages/domain, and without the explicit nodeModules
 * paths it resolves react twice — once from the app, once from the hoisted
 * root — which crashes at runtime with a duplicate-React error rather than a
 * resolution one, so it is worth being explicit here.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), workspaceRoot]));
config.resolver.nodeModulesPaths = [
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(projectRoot, 'node_modules'),
];

/*
 * @khaidee/domain is TypeScript written for ESM, so its own relative imports
 * carry a .js extension that resolves to a .ts file on disk. Metro does not
 * do that mapping, so strip the extension and let it resolve normally. Only
 * relative specifiers are touched; real .js packages still resolve as usual.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      /* fall through: it really was a .js file */
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
