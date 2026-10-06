# Browser dependencies

These unmodified distributions were copied from the bundled development runtime (jsfive from the npm registry tarball):

- PDF.js (`pdfjs-dist`) 5.6.205: `pdf.mjs`, `pdf.worker.mjs`. Apache-2.0, see `PDFJS-LICENSE.txt`. https://github.com/mozilla/pdf.js
- JSZip 3.10.1: `jszip.min.js`. MIT or GPLv3, used under MIT; see `JSZIP-LICENSE.md`. https://github.com/Stuk/jszip
- jsfive 0.4.2: `jsfive.mjs` is the package's unmodified `dist/esm/index.mjs` (npm tarball SHA-1 e918b6e71934985ad0336428cf7fdf81f3149768; file SHA-256 f62905261e96f018d2ef572dc8f8076ca9a454307b985cdb8e56f190a18d4741). Public domain (NIST), based on pyfive © 2016 Jonathan J. Helmus (BSD 3-Clause); it bundles pako 2.1.0 (MIT AND Zlib). All notices are in `JSFIVE-LICENSE.txt`. https://github.com/usnistgov/jsfive

They run locally in the browser to extract connected documents without uploading them to a storage service.
