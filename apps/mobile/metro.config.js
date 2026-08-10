// Metro defaults to resolving only inside the app folder. In a workspace the
// shared packages live a level up, so it has to watch the repo root and be told
// about both node_modules trees.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Stop Metro walking up past the roots above and picking a stray copy of a dep.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
