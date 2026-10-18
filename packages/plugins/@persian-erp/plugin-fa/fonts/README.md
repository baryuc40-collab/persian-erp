# Vazirmatn

Vazirmatn v33.0.3 by Saber Rastikerdar (https://github.com/rastikerdar/vazirmatn), weights 400, 500 and 700 in woff2,
copied unchanged from the `vazirmatn` npm package: `Vazirmatn-*` from `fonts/webfonts` and `Vazirmatn-FD-*` (the same
font with Persian digit shapes for 0-9) from `misc/Farsi-Digits/fonts/webfonts`. Licensed under the SIL Open Font License 1.1 (`OFL.txt`).

The build copies them to `dist/client/fonts` (`build.config.js`), and the server serves them at
`/static/plugins/@persian-erp/plugin-fa/dist/client/fonts/`, so the font works without internet access. The nginx of
the NocoBase image serves only `dist/client` of a plugin, so the files cannot be served from here.
