import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    // Pre-built, third-party browser runtimes are checked by their upstream
    // projects and are not application source code.
    ignores: ["public/vendor/**"],
  },
  {
    extends: [...nextCoreWebVitals],
  },
]);
