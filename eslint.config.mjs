// eslint-config-next ships flat-config arrays directly, so there is no
// FlatCompat shim here. Each import is an array of config objects that we
// spread in order; later entries win.
//
//   core-web-vitals -> Next's own rules + the TS parser + React/a11y/import
//   typescript      -> typescript-eslint's recommended rules on top
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [...coreWebVitals, ...typescript];

export default config;
