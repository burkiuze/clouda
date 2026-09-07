import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInThisContext } from "node:vm";
import ts from "typescript";

/** Load the real source in a fresh module graph, replacing only I/O boundaries.
 * No network, database or experimental Node module-mocking flags are needed.
 * Type checking is a separate `npm run typecheck` gate.
 */
export function loadTs(root, mocks = {}) {
  const modules = new Map();
  function load(path) {
    const filename = resolve(root, path);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const nativeRequire = createRequire(filename);
    const localRequire = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier.startsWith("@/")) return load(`${specifier.slice(2)}.ts`);
      if (specifier.startsWith(".")) {
        return load(resolve(dirname(filename), specifier.replace(/\.js$/, "") + ".ts"));
      }
      return nativeRequire(specifier);
    };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    });
    runInThisContext(`(function(require,module,exports,__filename,__dirname){${outputText}\n})`, { filename })(
      localRequire, module, module.exports, filename, dirname(filename),
    );
    return module.exports;
  }
  return load;
}
