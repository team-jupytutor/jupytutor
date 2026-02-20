import GlobalNotebookContextRetrieval from '../helpers/prompt-context/globalNotebookContextRetrieval.js';

const sourceLinks = [
  'https://www.data8.org/fa24/reference/',
  'https://inferentialthinking.com/chapters/13/Estimation.html',
  'https://inferentialthinking.com/chapters/14/2/Variability.html'
];
const contextRetriever = new GlobalNotebookContextRetrieval({
  sourceLinks,
  blacklistedURLs: ['https://www.data8.org/fa24/reference/'],
  jupyterbookURL: 'inferentialthinking.com',
  attemptJupyterbookLinkExpansion: true,
  // debug: true,
  debug: false // debug mode
});

// WAIT 3 SECONDS AND THEN GET CONTEXT
await new Promise(resolve => setTimeout(resolve, 3000));
const c = contextRetriever.getContext();
console.log('Context:', c, c.length);

console.log('Expanded links:', contextRetriever._sourceLinks);

// const expansion = await contextRetriever.expandJupyterBookLinks(
//   sourceLinks,
//   'inferentialthinking.com'
// );
// console.log('Expanded links:', expansion);
// console.log('Original links:', sourceLinks);
