// Authentication is limited to known resources in the configured repository.
export function repositoryRequest(url, sourceRepoUrl, token) {
  const source = new URL(sourceRepoUrl);
  const coordinates = source.pathname.split('/').filter(Boolean);
  if (
    source.origin !== 'https://github.com'
    || source.username || source.password || source.search || source.hash
    || coordinates.length !== 2
    || coordinates.some((part) => !/^[\w.-]+$/.test(part))
  ) {
    throw new Error('sourceRepoUrl must identify one canonical GitHub repository');
  }
  const target = new URL(url);
  const parts = target.pathname.split('/').filter(Boolean);
  if (
    target.origin !== source.origin
    || parts.length < 2
    || parts.slice(0, 2).join('/').toLowerCase() !== coordinates.join('/').toLowerCase()
  ) {
    return null;
  }
  if (target.username || target.password || target.search) {
    throw new Error('repository link must not contain credentials or query parameters');
  }
  const resource = parts.slice(2).map(decodeURIComponent);
  if (resource.some((part) => part.includes('/') || part.includes('\\') || part === '.' || part === '..')) {
    throw new Error('repository link contains an ambiguous path segment');
  }
  const base = `https://api.github.com/repos/${coordinates.join('/')}`;
  let apiUrl;
  if (resource.length === 0) {
    apiUrl = base;
  } else if (['blob', 'tree'].includes(resource[0]) && resource.length >= 2) {
    const [kind, ref, ...file] = resource;
    if (kind === 'blob' && file.length === 0) {
      throw new Error('repository blob link must name a file');
    }
    const suffix = file.map(encodeURIComponent).join('/');
    apiUrl = `${base}/contents${suffix ? `/${suffix}` : ''}?ref=${encodeURIComponent(ref)}`;
  } else if (['issues', 'pulls', 'releases'].includes(resource[0]) && resource.length === 1) {
    apiUrl = `${base}/${resource[0]}`;
  } else if (['issues', 'pull'].includes(resource[0]) && resource.length === 2 && /^\d+$/.test(resource[1])) {
    apiUrl = `${base}/${resource[0] === 'pull' ? 'pulls' : 'issues'}/${resource[1]}`;
  } else if (resource[0] === 'releases' && resource[1] === 'tag' && resource.length === 3) {
    apiUrl = `${base}/releases/tags/${encodeURIComponent(resource[2])}`;
  } else {
    throw new Error(`unsupported authenticated repository link: ${url}`);
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required to validate links to the configured repository');
  }
  return {
    url: apiUrl,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  };
}

export async function repositoryLinkStatus(request, send) {
  // No redirects: credentials must never follow a response Location header.
  const response = await send(request.url, 'GET', request.headers);
  response.resume();
  return response.statusCode;
}
