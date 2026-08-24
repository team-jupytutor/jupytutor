export const normalizeAPIBaseURL = (baseURL: string): string => {
  const trimmedBaseURL = baseURL.trim();
  if (!trimmedBaseURL) {
    return '';
  }

  return trimmedBaseURL.endsWith('/') ? trimmedBaseURL : `${trimmedBaseURL}/`;
};

export const buildAPIURL = (baseURL: string, path: string): string => {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizeAPIBaseURL(baseURL)}${normalizedPath}`;
};
