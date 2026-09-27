import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRATIONS, parsePrismReport, parseRefAtlas, searchPapers } from '../public/core/research.mjs';

test('Prism parser preserves engine, analysis, and source without rewriting numbers', () => {
  const analysis = { sMax: 27.125, thresholdP: 1.2e-6, data: { P: [1e-7, 1e-6] } };
  const result = parsePrismReport(JSON.stringify({
    app: 'INNO Prism', engine: 'PrismFit 2.6.0', file: 'scan.h5', analysis,
  }));

  assert.deepEqual(result, {
    engine: 'PrismFit 2.6.0',
    analysis,
    source: { app: 'INNO Prism', file: 'scan.h5' },
  });
});

test('Prism parser preserves power export settings, calibration, density conversion, and manual slope', () => {
  const result = parsePrismReport(JSON.stringify({
    app: 'INNO Prism',
    engine: 'PrismFit 2.6.0',
    file: 'scan.h5',
    settings: { monotone: false, lambdaFactor: 1.25 },
    calibration: {
      coefficient: 2.5,
      pairs: [{ pm: 1.1, end: 2.2 }],
      beam: { sx: 3.3, sy: 4.4 },
    },
    densityFactor_mWcm2_per_W: 5.5,
    manualSlope: { range_W: { lo: 1e-7, hi: 1e-5 }, chord: 6.6, lsq: 6.7, n: 4 },
    analysis: { sMax: 27.125, thresholdP: 1.2e-6 },
  }));

  assert.deepEqual(result, {
    engine: 'PrismFit 2.6.0',
    analysis: { sMax: 27.125, thresholdP: 1.2e-6 },
    source: { app: 'INNO Prism', file: 'scan.h5' },
    settings: { monotone: false, lambdaFactor: 1.25 },
    calibration: {
      coefficient: 2.5,
      pairs: [{ pm: 1.1, end: 2.2 }],
      beam: { sx: 3.3, sy: 4.4 },
    },
    densityFactor_mWcm2_per_W: 5.5,
    manualSlope: { range_W: { lo: 1e-7, hi: 1e-5 }, chord: 6.6, lsq: 6.7, n: 4 },
  });
});

test('Prism parser rejects malformed reports and non-finite JSON numbers', () => {
  assert.throws(() => parsePrismReport('{bad json'), /invalid Prism JSON/i);
  assert.throws(
    () => parsePrismReport('{"app":"INNO Prism","engine":"PrismFit 2.6","analysis":{"sMax":1e999}}'),
    /finite number/i,
  );
  assert.throws(
    () => parsePrismReport('{"app":"Other","engine":"x","analysis":{}}'),
    /INNO Prism/i,
  );
  assert.throws(
    () => parsePrismReport('{"app":"INNO Prism","engine":"x","analysis":{},"source":[]}'),
    /source object/i,
  );
  assert.throws(
    () => parsePrismReport('{"app":"INNO Prism","engine":"x","analysis":{},"calibration":{"coefficient":1e999}}'),
    /finite number/i,
  );
});

test('RefAtlas parser accepts catalog, shard, wrapper, and individual paper records', () => {
  const catalog = parseRefAtlas(JSON.stringify([
    { id: 'doi:10.1000/a', doi: '10.1000/a', ti: 'Catalog title', yr: 2025, au: 'A. Author', vn: 'Journal', src: 'crossref' },
  ]));
  const shard = parseRefAtlas(JSON.stringify({
    'doi:10.1000/b': { id: 'doi:10.1000/b', doi: '10.1000/b', title: 'Shard title', abstract: 'Measured evidence', year: 2024, source: 'openalex' },
  }));
  const wrapped = parseRefAtlas(JSON.stringify({ papers: [
    { id: 'W3', title: 'Metadata record', evidenceScope: 'metadata' },
  ] }));
  const single = parseRefAtlas(JSON.stringify({
    id: 'doi:10.1000/c', doi: 'https://doi.org/10.1000/c', title: 'One paper',
    evidenceScope: 'full-text', fullText: 'Connected full-text evidence', source: 'local-library',
  }));

  assert.equal(catalog[0].title, 'Catalog title');
  assert.equal(catalog[0].doi, '10.1000/a');
  assert.equal(catalog[0].evidenceScope, 'metadata');
  assert.equal(shard[0].evidenceScope, 'abstract');
  assert.equal(wrapped[0].evidenceScope, 'metadata');
  assert.equal(single[0].evidenceScope, 'full-text');
  assert.equal(single[0].doi, '10.1000/c');
  assert.equal(single[0].fullText, 'Connected full-text evidence');
});

test('RefAtlas derives a canonical DOI from a DOI-valued id or doi.org URL', () => {
  const [fromId] = parseRefAtlas(JSON.stringify({
    id: 'doi:10.1000/id-only', title: 'ID DOI', evidenceScope: 'metadata',
  }));
  const [fromUrl] = parseRefAtlas(JSON.stringify({
    url: 'https://doi.org/10.1000/url-only', title: 'URL DOI', evidenceScope: 'metadata',
  }));

  assert.equal(fromId.doi, '10.1000/id-only');
  assert.equal(fromId.id, 'doi:10.1000/id-only');
  assert.equal(fromUrl.doi, '10.1000/url-only');
  assert.equal(fromUrl.id, 'doi:10.1000/url-only');
});

test('RefAtlas parser rejects fabricated or malformed citation identity', () => {
  assert.throws(
    () => parseRefAtlas(JSON.stringify({
      id: 'doi:10.1000/real', doi: '10.1000/real', title: 'Claim', url: 'https://doi.org/10.1000/fabricated',
    })),
    /DOI.*mismatch/i,
  );
  assert.throws(
    () => parseRefAtlas(JSON.stringify({ title: 'Untraceable claim', evidenceScope: 'abstract' })),
    /source identity/i,
  );
  assert.throws(() => parseRefAtlas('{nope'), /invalid RefAtlas JSON/i);
});

test('RefAtlas rejects conflicting DOI candidates without requiring an explicit DOI field', () => {
  assert.throws(
    () => parseRefAtlas(JSON.stringify({
      id: 'doi:10.1000/real', title: 'Claim', url: 'https://doi.org/10.1000/fabricated',
    })),
    /DOI.*mismatch/i,
  );
});

test('RefAtlas rejects non-string abstract evidence', () => {
  assert.throws(
    () => parseRefAtlas(JSON.stringify({ id: 'bad-abstract', title: 'Claim', abstract: 42 })),
    /abstract.*string/i,
  );
});

test('RefAtlas requires actual text for full-text evidence scope', () => {
  assert.throws(
    () => parseRefAtlas(JSON.stringify({ id: 'no-full-text', title: 'Claim', evidenceScope: 'full-text' })),
    /full-text.*evidence/i,
  );
  assert.throws(
    () => parseRefAtlas(JSON.stringify({
      id: 'bad-full-text', title: 'Claim', evidenceScope: 'full-text', fullText: 42,
    })),
    /full-text.*string/i,
  );
});

test('RefAtlas infers full-text scope only from non-empty fullText or full_text evidence', () => {
  const [camel] = parseRefAtlas(JSON.stringify({
    id: 'camel', title: 'Camel full text', fullText: 'Complete evidence',
  }));
  const [snake] = parseRefAtlas(JSON.stringify({
    id: 'snake', title: 'Snake full text', full_text: 'Complete evidence too',
  }));

  assert.equal(camel.evidenceScope, 'full-text');
  assert.equal(camel.fullText, 'Complete evidence');
  assert.equal(snake.evidenceScope, 'full-text');
  assert.equal(snake.fullText, 'Complete evidence too');
});

test('paper search is deterministic, case-insensitive, bounded, and does not mutate input', () => {
  const papers = parseRefAtlas(JSON.stringify([
    { id: 'a', doi: '10.1000/a', title: 'Photon avalanche nanocrystals', abstract: 'Power dependence', year: 2024 },
    { id: 'b', doi: '10.1000/b', title: 'Nanocrystal synthesis', abstract: 'Photon avalanche threshold', year: 2025 },
    { id: 'c', title: 'Unrelated optics', evidenceScope: 'metadata', year: 2026 },
  ]));
  const before = JSON.stringify(papers);

  assert.deepEqual(searchPapers(papers, 'PHOTON avalanche', 1).map((paper) => paper.id), ['a']);
  assert.deepEqual(searchPapers(papers, 'photon avalanche', 1).map((paper) => paper.id), ['a']);
  assert.deepEqual(searchPapers(papers, '', 10), []);
  assert.equal(JSON.stringify(papers), before);
  assert.throws(() => searchPapers(papers, 'photon', -1), /limit/i);
});

test('integration catalog distinguishes a verified app from repository fallbacks', () => {
  assert.deepEqual(INTEGRATIONS.map((entry) => entry.id), [
    'scheduler', 'nanolab', 'ledger', 'prism', 'analytics', 'refatlas',
  ]);
  for (const entry of INTEGRATIONS) {
    assert.match(entry.url, /^https:\/\//);
    assert.match(entry.repositoryUrl, /^https:\/\/github\.com\/INNO-KAIST\//);
    assert.ok(entry.linkKind === 'app' || entry.linkKind === 'repository');
    assert.ok(Array.isArray(entry.imports));
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.deepEqual(
    INTEGRATIONS.map(({ id, url, linkKind }) => ({ id, url, linkKind })),
    [
      { id: 'scheduler', url: 'https://inno-kaist.github.io/INNO-Scheduler/', linkKind: 'app' },
      { id: 'nanolab', url: 'https://github.com/INNO-KAIST/INNO-NanoLab', linkKind: 'repository' },
      { id: 'ledger', url: 'https://github.com/INNO-KAIST/INNO-Ledger', linkKind: 'repository' },
      { id: 'prism', url: 'https://github.com/INNO-KAIST/INNO-Prism', linkKind: 'repository' },
      { id: 'analytics', url: 'https://github.com/INNO-KAIST/INNO-Analytics', linkKind: 'repository' },
      { id: 'refatlas', url: 'https://github.com/INNO-KAIST/INNO-RefAtlas', linkKind: 'repository' },
    ],
  );
  assert.deepEqual(INTEGRATIONS.find((entry) => entry.id === 'prism').imports, ['analysis-json']);
  assert.deepEqual(INTEGRATIONS.find((entry) => entry.id === 'refatlas').imports, ['catalog-json', 'papers-json']);
});
