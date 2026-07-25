'use strict';

const path = require('node:path');
const { promises: fs } = require('node:fs');

function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateUsbPathSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every((segment) => (
    typeof segment === 'string'
    && segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('\0')
  ));
}

async function resolveContainedRealPath(rootPath, candidatePath, realpath = fs.realpath) {
  if (!isPathInsideRoot(rootPath, candidatePath)) return null;
  const [realRoot, realCandidate] = await Promise.all([
    realpath(rootPath),
    realpath(candidatePath),
  ]);
  return isPathInsideRoot(realRoot, realCandidate) ? realCandidate : null;
}

module.exports = {
  isPathInsideRoot,
  resolveContainedRealPath,
  validateUsbPathSegments,
};
