miropdf
========

Node.js pdf generation from JSON built around PDFKit.

Install modules with `npm install`.

Use the default spec in test/miropdf.pl with `npm test`
  (equivalent to `perl test/miropdf.pl | ./lib/miropdf.js`).

Or use any other input with something like `cat injson | ./lib/miropdf.js`.

For now, pdfs will end up in working directory/out.pdf.
