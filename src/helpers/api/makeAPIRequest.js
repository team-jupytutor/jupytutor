/**
 * Helper function to make API requests with FormData support for file uploads
 *
 * CORS REQUIREMENTS: This function requires the server to have CORS properly configured
 * to allow requests from the client's origin. The server must include:
 * - Access-Control-Allow-Origin header (or * for development)
 * - Access-Control-Allow-Credentials: true (for credentials: 'include')
 * - Access-Control-Allow-Methods for the HTTP methods you want to support
 * - Access-Control-Allow-Headers for custom headers like Authorization
 *
 * @param {string} endpoint - The API endpoint (will be appended to base API_URL)
 * @param {Object} options - Request options
 * @param {Object} options.data - Data to send (will be converted to FormData)
 * @param {Array} options.files - Array of file objects with name and file properties (file must be File object)
 * @param {Object} options.headers - Additional headers to include
 * @param {string} options.authToken - Optional authentication token
 * @param {string} options.method - HTTP method (default: 'POST')
 * @param {string} options.baseURL - Optional base URL override
 * @returns {Promise<Object>} Response data
 */

import config from '../../config';

// Configurable API base URL - can be overridden per request
const DEFAULT_API_URL = config.api.baseURL;

/**
 * Creates a FormData object from the provided data and files
 * @param {Object} data - Data object to convert to FormData
 * @param {Array} files - Array of file objects with name and file properties (file must be File object)
 * @returns {FormData} FormData object
 */
function createFormData(data = {}, files = []) {
  const formData = new FormData();

  // Add regular data fields
  Object.keys(data).forEach(key => {
    if (data[key] !== null && data[key] !== undefined) {
      // Convert objects and arrays to JSON strings for FormData
      if (typeof data[key] === 'object') {
        formData.append(key, JSON.stringify(data[key]));
      } else {
        formData.append(key, data[key]);
      }
    }
  });

  // Add files (browser environment only - File objects)
  for (const fileObj of files) {
    if (fileObj.file && fileObj.name) {
      if (fileObj.file instanceof File) {
        // Browser environment - File object
        formData.append(fileObj.name, fileObj.file);
      } else {
        console.warn(
          'Invalid file object:',
          fileObj.file,
          'Expected File object (browser environment only)'
        );
      }
    }
  }

  return formData;
}

/**
 * Makes an API request with FormData support
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options including data, files (File objects only), headers, authToken, method, baseURL
 * @returns {Promise<Object>} Response data
 */
async function makeAPIRequest(endpoint, options = {}) {
  const {
    data = {},
    files = [],
    headers = {},
    authToken = null,
    method = 'POST',
    baseURL = DEFAULT_API_URL // Use default baseURL or override
  } = options;

  try {
    // Prepare headers
    const requestHeaders = {
      ...headers
    };

    // Add authentication header if provided
    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    // Create FormData if there are files or data
    let body = null;
    if (files.length > 0 || Object.keys(data).length > 0) {
      body = createFormData(data, files);
      // Note: Don't set Content-Type for FormData - browser automatically sets it as:
      // 'multipart/form-data; boundary=----WebKitFormBoundary...'
      // This ensures proper boundary handling for file uploads
    }

    // Build request options
    const requestOptions = {
      method: method.toUpperCase(),
      headers: requestHeaders,
      body: body,
      mode: 'cors', // Enable CORS
      credentials: 'include', // Include cookies and authentication headers
      cache: 'no-cache' // Don't cache CORS requests
    };

    // Remove body for GET requests
    if (method.toUpperCase() === 'GET') {
      delete requestOptions.body;
    }

    // if (DEMO_PRINTS) {
    //   console.log('API Request:', {
    //     url: `${baseURL}${endpoint}`,
    //     method: requestOptions.method,
    //     headers: requestOptions.headers,
    //     body: body instanceof FormData ? 'FormData' : body
    //   });
    // }

    // Make the request
    const response = await fetch(`${baseURL}${endpoint}`, requestOptions);

    // Check if response is ok
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Try to parse JSON response
    let responseData;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    return {
      success: true,
      data: responseData,
      status: response.status,
      headers: response.headers
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: null
    };
  }
}

/**
 * Convenience function for GET requests
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options including data, files (File objects only), headers, authToken, baseURL
 * @returns {Promise<Object>} Response data
 */
async function makeGETRequest(endpoint, options = {}) {
  return makeAPIRequest(endpoint, { ...options, method: 'GET' });
}

/**
 * Convenience function for POST requests
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options including data, files (File objects only), headers, authToken, baseURL
 * @returns {Promise<Object>} Response data
 */
async function makePOSTRequest(endpoint, options = {}) {
  return makeAPIRequest(endpoint, { ...options, method: 'POST' });
}

/**
 * Convenience function for PUT requests
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options including data, files (File objects only), headers, authToken, baseURL
 * @returns {Promise<Object>} Response data
 */
async function makePUTRequest(endpoint, options = {}) {
  return makeAPIRequest(endpoint, { ...options, method: 'PUT' });
}

/**
 * Convenience function for DELETE requests
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options including data, files (File objects only), headers, authToken, baseURL
 * @returns {Promise<Object>} Response data
 */
async function makeDELETERequest(endpoint, options = {}) {
  return makeAPIRequest(endpoint, { ...options, method: 'DELETE' });
}

export {
  makeAPIRequest,
  makeGETRequest,
  makePOSTRequest,
  makePUTRequest,
  makeDELETERequest,
  createFormData
};
