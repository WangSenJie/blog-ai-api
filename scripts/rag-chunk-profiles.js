'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CHUNK_PROFILES = Object.freeze([
  'generic-article',
  'tutorial',
  'code-doc',
  'math-note',
  'faq-reference'
]);
const PROFILE_SOURCES = Object.freeze([
  'front-matter',
  'document-rule',
  'path-rule',
  'migration-fallback'
]);
const DEFAULT_PROFILE = 'generic-article';
const DEFAULT_PROFILE_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'rag-chunk-profiles.yml'
);

function normalizeRepositoryPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

function assertProfile(profile, location) {
  const value = String(profile || '').trim();
  if (!CHUNK_PROFILES.includes(value)) {
    throw new Error(
      `Unknown RAG chunk profile${location ? ` at ${location}` : ''}: ${value || '(empty)'}`
    );
  }
  return value;
}

function globToRegExp(glob) {
  const source = normalizeRepositoryPath(glob);
  let expression = '^';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '*' && source[index + 1] === '*') {
      if (source[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

function loadProfileRegistry(configPath, options) {
  const filePath = path.resolve(configPath || DEFAULT_PROFILE_CONFIG_PATH);
  const rootDir = path.resolve(
    options && options.rootDir || path.dirname(path.dirname(filePath))
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`RAG chunk profile registry is missing: ${filePath}`);
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'), {
      filename: filePath,
      json: true,
      schema: yaml.JSON_SCHEMA
    });
  } catch (error) {
    throw new Error(`Invalid RAG chunk profile registry: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1) {
    throw new Error('RAG chunk profile registry must be a version 1 YAML mapping');
  }

  const defaultProfile = assertProfile(
    parsed.defaultProfile || DEFAULT_PROFILE,
    'defaultProfile'
  );
  const documents = new Map();
  for (const [documentPath, profile] of Object.entries(parsed.documents || {})) {
    const normalizedPath = normalizeRepositoryPath(documentPath);
    if (!normalizedPath || documents.has(normalizedPath)) {
      throw new Error(`Invalid or duplicate RAG document profile rule: ${documentPath}`);
    }
    documents.set(normalizedPath, assertProfile(profile, documentPath));
  }

  const pathRules = (parsed.pathRules || []).map((rule, index) => {
    const glob = normalizeRepositoryPath(rule && rule.glob);
    if (!glob) throw new Error(`RAG path profile rule ${index + 1} is missing a glob`);
    return {
      glob,
      profile: assertProfile(rule && rule.profile, glob),
      pattern: globToRegExp(glob)
    };
  });

  return {
    version: 1,
    filePath,
    rootDir,
    defaultProfile,
    documents,
    pathRules
  };
}

function resolveChunkProfile(metadata, filePath, registry) {
  const activeRegistry = registry || loadProfileRegistry();
  const rag = metadata && metadata.rag;
  const frontMatterProfile = rag && typeof rag === 'object' && !Array.isArray(rag)
    ? String(rag.chunk_profile || '').trim()
    : '';
  if (frontMatterProfile) {
    return {
      profile: assertProfile(frontMatterProfile, filePath),
      profileSource: 'front-matter',
      matchedRule: 'rag.chunk_profile'
    };
  }

  const repositoryPath = normalizeRepositoryPath(
    path.relative(activeRegistry.rootDir, path.resolve(filePath))
  );
  if (activeRegistry.documents.has(repositoryPath)) {
    return {
      profile: activeRegistry.documents.get(repositoryPath),
      profileSource: 'document-rule',
      matchedRule: repositoryPath
    };
  }
  const pathRule = activeRegistry.pathRules.find(rule => rule.pattern.test(repositoryPath));
  if (pathRule) {
    return {
      profile: pathRule.profile,
      profileSource: 'path-rule',
      matchedRule: pathRule.glob
    };
  }
  return {
    profile: activeRegistry.defaultProfile,
    profileSource: 'migration-fallback',
    matchedRule: ''
  };
}

module.exports = {
  CHUNK_PROFILES,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_CONFIG_PATH,
  PROFILE_SOURCES,
  assertProfile,
  globToRegExp,
  loadProfileRegistry,
  normalizeRepositoryPath,
  resolveChunkProfile
};
