import assert from 'node:assert/strict';
import test from 'node:test';

import {checkLink} from '../scripts/check-external-links.mjs';
import {repositoryLinkStatus, repositoryRequest} from '../scripts/repository-links.mjs';

const repository = 'https://github.com/example/project';
const token = 'test-only-token';

test('authenticates only known resources in the configured repository', () => {
  const cases = [
    ['', ''],
    ['/blob/main/README.md', '/contents/README.md?ref=main'],
    ['/tree/main/docs', '/contents/docs?ref=main'],
    ['/tree/main', '/contents?ref=main'],
    ['/issues', '/issues'],
    ['/issues/12', '/issues/12'],
    ['/pull/12', '/pulls/12'],
    ['/releases/tag/v1.0.0', '/releases/tags/v1.0.0'],
  ];
  for (const [web, api] of cases) {
    const request = repositoryRequest(`${repository}${web}`, repository, token);
    assert.equal(request.url, `https://api.github.com/repos/example/project${api}`);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
  }
});

test('does not authenticate other repositories, hosts, schemes, or ports', () => {
  for (const url of [
    'https://github.com/example/another',
    'https://github.com/example/project-other',
    'https://github.com.evil.test/example/project',
    'https://api.github.com/repos/example/project',
    'http://github.com/example/project',
    'https://github.com:8443/example/project',
  ]) {
    assert.equal(repositoryRequest(url, repository, token), null);
  }
});

test('missing access and unknown private URL shapes fail explicitly', () => {
  assert.throws(() => repositoryRequest(repository, repository, ''), /GITHUB_TOKEN is required/);
  for (const suffix of ['/settings', '/blob/main', '/issues/not-a-number', '/blob/main/path%2Fescape']) {
    assert.throws(() => repositoryRequest(`${repository}${suffix}`, repository, token));
  }
  assert.throws(() => repositoryRequest(`${repository}?access_token=secret`, repository, token), /query parameters/);
  assert.throws(() => repositoryRequest('https://user@github.com/example/project', repository, token), /credentials/);
});

test('rejects an invalid source repository before preparing credentials', () => {
  for (const source of [
    'https://github.com.evil.test/example/project',
    'https://github.com/example/project/extra',
    'http://github.com/example/project',
    'https://github.com/example/project?token=secret',
  ]) {
    assert.throws(() => repositoryRequest(repository, source, token), /canonical GitHub repository/);
  }
});

test('authenticated 404 and redirects fail without following Location', async () => {
  for (const status of [404, 302]) {
    const planned = repositoryRequest(repository, repository, token);
    const calls = [];
    const send = async (url, method, headers) => {
      calls.push({url, method, headers});
      return {statusCode: status, headers: {location: 'https://other.test/'}, resume() {}};
    };
    await assert.rejects(
      () => checkLink(repository, () => repositoryLinkStatus(planned, send)),
      new RegExp(`returned ${status}`),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, planned.url);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
  }
});
