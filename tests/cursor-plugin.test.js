#!/usr/bin/env node
// Cursor is a real plugin host (IDE + `agent` CLI), not a copy-the-mdc
// adapter. This guards the Cursor plugin shape: .cursor-plugin manifests,
// Agent Plugins root plugin.json, markdown commands next to the toml ones,
// and mcp.json that points at the existing ponytail-mcp server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const root = path.join(__dirname, '..');
const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGENT_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const MARKETPLACE_SCHEMA_URL = 'https://raw.githubusercontent.com/cursor/plugins/main/schemas/marketplace.schema.json';
const PLUGIN_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const AGENT_PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const PINNED_SEMVER = /^\d+\.\d+\.\d+$/;
const MARKETPLACE_PLUGIN_KEYS = ['name', 'source', 'description', 'minClientVersions'];
const AGENT_PLUGIN_KEYS = [
  '$schema', 'name', 'version', 'description', 'author',
  'homepage', 'repository', 'license', 'keywords', 'extensions',
];
const AUTHOR_KEYS = ['name', 'email', 'url'];
const COMMANDS = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
];
const SKILL_DIRS = COMMANDS;

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readJSON(relPath) {
  return JSON.parse(read(relPath).replace(/^\uFEFF/, ''));
}

function extraKeys(obj, allowed) {
  return Object.keys(obj).filter((key) => !allowed.includes(key));
}

function unescapeTomlString(value) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseTomlCommand(text) {
  const description = text.match(/^description\s*=\s*"(.*)"\s*$/m);
  const prompt = text.match(/^prompt\s*=\s*"(.*)"\s*$/m);
  assert.ok(description, 'toml command needs a description');
  assert.ok(prompt, 'toml command needs a prompt');
  return {
    description: unescapeTomlString(description[1]),
    prompt: unescapeTomlString(prompt[1]),
  };
}

function parseMarkdownCommand(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  assert.ok(match, 'markdown command needs YAML frontmatter');
  const fields = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const cut = line.indexOf(':');
    assert.ok(cut > 0, `frontmatter line must be key: value: ${line}`);
    fields[line.slice(0, cut).trim()] = line.slice(cut + 1).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { ...fields, body: match[2].trim() };
}

function resolveManifestPath(manifest, field, fallback) {
  const value = manifest[field] || fallback;
  assert.equal(typeof value, 'string', `${field} must be a path string`);
  return path.join(root, value);
}

test('Cursor plugin manifest exists with kebab-case name and pinned version', () => {
  const manifest = readJSON('.cursor-plugin/plugin.json');
  const pkg = readJSON('package.json');
  assert.equal(manifest.name, 'ponytail');
  assert.match(manifest.name, PLUGIN_NAME_PATTERN);
  assert.match(manifest.version, PINNED_SEMVER);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.description, 'manifest must declare a description');
  assert.equal(manifest.author && manifest.author.name, pkg.author.name);
  assert.equal(manifest.license, 'MIT');
});

test('Cursor plugin reuses existing skills, rules, and commands', () => {
  const manifest = readJSON('.cursor-plugin/plugin.json');
  const skillsDir = resolveManifestPath(manifest, 'skills', 'skills/');
  const rulesDir = resolveManifestPath(manifest, 'rules', '.cursor/rules/');
  const commandsDir = resolveManifestPath(manifest, 'commands', 'commands/');

  for (const skill of SKILL_DIRS) {
    assert.ok(
      fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')),
      `missing skill: ${skill}/SKILL.md`,
    );
  }

  const ruleFile = path.join(rulesDir, 'ponytail.mdc');
  assert.ok(fs.existsSync(ruleFile), 'must point at .cursor/rules/ponytail.mdc');
  const rule = fs.readFileSync(ruleFile, 'utf8');
  assert.match(rule, /alwaysApply:\s*true/);
  assert.match(rule, /lazy senior developer/);

  for (const name of COMMANDS) {
    assert.ok(
      fs.existsSync(path.join(commandsDir, `${name}.md`)),
      `missing Cursor command: ${name}.md`,
    );
  }
});

test('Cursor markdown commands keep toml hosts working and stay in sync', () => {
  const manifest = readJSON('.cursor-plugin/plugin.json');
  const commandsDir = resolveManifestPath(manifest, 'commands', '.cursor-plugin/commands/');
  for (const name of COMMANDS) {
    assert.ok(
      fs.existsSync(path.join(root, 'commands', `${name}.toml`)),
      `missing commands/${name}.toml`,
    );
    const toml = parseTomlCommand(read(`commands/${name}.toml`));
    const md = parseMarkdownCommand(fs.readFileSync(path.join(commandsDir, `${name}.md`), 'utf8'));
    assert.equal(md.name, name);
    assert.ok(md.description, `${name}.md needs a description`);
    assert.equal(md.description, toml.description);
    assert.equal(md.body, toml.prompt.replaceAll('{{args}}', '$ARGUMENTS'));
  }
});

test('Cursor marketplace manifest is schema-valid and points at this plugin', () => {
  const marketplace = readJSON('.cursor-plugin/marketplace.json');
  assert.equal(extraKeys(marketplace, ['name', 'owner', 'metadata', 'plugins']).length, 0);
  assert.equal(typeof marketplace.name, 'string');
  assert.ok(marketplace.name.length > 0);
  assert.ok(Array.isArray(marketplace.plugins));
  assert.equal(marketplace.plugins.length, 1);

  if (marketplace.owner) {
    assert.equal(typeof marketplace.owner.name, 'string');
    assert.ok(marketplace.owner.name.length > 0);
    assert.equal(extraKeys(marketplace.owner, ['name', 'email']).length, 0);
  }
  if (marketplace.metadata) {
    assert.equal(typeof marketplace.metadata, 'object');
  }

  const entry = marketplace.plugins[0];
  assert.equal(extraKeys(entry, MARKETPLACE_PLUGIN_KEYS).length, 0, `plugin entry extra keys: ${extraKeys(entry, MARKETPLACE_PLUGIN_KEYS)}`);
  assert.equal(entry.name, 'ponytail');
  assert.match(entry.name, PLUGIN_NAME_PATTERN);
  assert.equal(typeof entry.source, 'string');
  assert.ok(entry.source.length > 0);
  assert.ok(entry.description);

  const pluginRoot = path.resolve(root, entry.source);
  assert.ok(
    fs.existsSync(path.join(pluginRoot, '.cursor-plugin', 'plugin.json')),
    'marketplace source must resolve to a Cursor plugin',
  );
  assert.equal(readJSON(path.relative(root, path.join(pluginRoot, '.cursor-plugin', 'plugin.json'))).name, entry.name);
});

test('published Cursor marketplace schema still only allows the fields we ship', async () => {
  const schema = await downloadJSON(MARKETPLACE_SCHEMA_URL);
  if (!schema) {
    // ponytail: CI/offline fallback — the local additionalProperties checks
    // above still enforce the published contract. Upgrade: fail closed if
    // schema fetch should be required on CI.
    return;
  }
  const entry = schema.$defs && schema.$defs.pluginEntry;
  assert.ok(entry, 'schema must define pluginEntry');
  assert.equal(entry.additionalProperties, false);
  assert.ok(entry.required.includes('name'));
  assert.ok(entry.required.includes('source'));
  const marketplace = readJSON('.cursor-plugin/marketplace.json');
  for (const plugin of marketplace.plugins) {
    for (const key of Object.keys(plugin)) {
      assert.ok(entry.properties[key], `marketplace plugin entry field not in schema: ${key}`);
    }
  }
});

test('root plugin.json is an Agent Plugins 1.0.0 manifest', () => {
  const manifest = readJSON('plugin.json');
  const pkg = readJSON('package.json');
  assert.equal(manifest.$schema, AGENT_PLUGIN_SCHEMA);
  assert.equal(manifest.name, 'ponytail');
  assert.match(manifest.name, AGENT_PLUGIN_NAME_PATTERN);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.description);
  assert.equal(extraKeys(manifest, AGENT_PLUGIN_KEYS).length, 0);
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.mcpServers, undefined);
  if (manifest.author) {
    assert.equal(extraKeys(manifest.author, AUTHOR_KEYS).length, 0);
    assert.equal(manifest.author.name, pkg.author.name);
  }
});

test('mcp.json is an Agent Plugins MCP config pointing at ponytail-mcp', () => {
  const mcp = readJSON('mcp.json');
  assert.equal(mcp.$schema, AGENT_MCP_SCHEMA);
  assert.equal(extraKeys(mcp, ['$schema', 'mcpServers']).length, 0);
  const server = mcp.mcpServers && mcp.mcpServers.ponytail;
  assert.ok(server, 'must declare an mcpServers.ponytail entry');
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'node');
  assert.ok(Array.isArray(server.args));
  assert.ok(server.args.some((arg) => String(arg).includes('ponytail-mcp/index.js')));
  assert.ok(
    fs.existsSync(path.join(root, 'ponytail-mcp', 'index.js')),
    'MCP entry must point at the existing server',
  );
});

test('Cursor adapter does not ship unsafe or Gemini-auto-loaded hooks', () => {
  const manifest = readJSON('.cursor-plugin/plugin.json');
  assert.equal(manifest.hooks, undefined);
  assert.equal(fs.existsSync(path.join(root, 'hooks', 'hooks.json')), false);
});

test('README documents Cursor IDE + CLI plugin install, not copy-the-mdc', () => {
  const readme = read('README.md');
  assert.match(readme, /^### Cursor\b/m);
  assert.match(readme, /~\/\.cursor\/plugins\/local\/ponytail/);
  assert.match(readme, /agent --plugin-dir/);
  assert.match(readme, /agent mcp enable/);
  assert.doesNotMatch(
    readme,
    /instruction-only adapters \(Cursor/,
    'Cursor is a plugin host now; stop listing it as instruction-only',
  );
  assert.match(readme, /\| Cursor \(IDE\) \|/);
  assert.match(readme, /\| Cursor CLI \|/);
});

function downloadJSON(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}
