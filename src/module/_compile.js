import ENTRY from "../constant/entry.js"
import ENV from "../constant/env.js"
import PACKAGE from "../constant/package.js"
import SOURCE_TYPE from "../constant/source-type.js"

import Compiler from "../caching-compiler.js"
import GenericObject from "../generic/object.js"
import Package from "../package.js"
import Runtime from "../runtime.js"

import captureStackTrace from "../error/capture-stack-trace.js"
import createSourceMap from "../util/create-source-map.js"
import encodeURI from "../util/encode-uri.js"
import getLocationFromStackTrace from "../error/get-location-from-stack-trace.js"
import getSourceMappingURL from "../util/get-source-mapping-url.js"
import isError from "../util/is-error.js"
import isMJS from "../util/is-mjs.js"
import isObjectEmpty from "../util/is-object-empty.js"
import isStackTraceMasked from "../util/is-stack-trace-masked.js"
import maskStackTrace from "../error/mask-stack-trace.js"
import readFile from "../fs/read-file.js"
import shared from "../shared.js"
import validateESM from "./esm/validate.js"

const {
  STATE_EXECUTION_STARTED,
  STATE_PARSING_STARTED,
  TYPE_ESM
} = ENTRY

const {
  ELECTRON_RENDERER,
  INSPECT
} = ENV

const {
  OPTIONS_MODE_ALL,
  OPTIONS_MODE_AUTO
} = PACKAGE

const {
  MODULE,
  SCRIPT,
  UNAMBIGUOUS
} = SOURCE_TYPE

function compile(caller, entry, content, filename, fallback) {
  const pkg = entry.package
  const { mode } = pkg.options
  const { parsing } = shared.moduleState

  let hint = SCRIPT
  let sourceType = SCRIPT

  if (isMJS(filename)) {
    hint = MODULE
    sourceType = MODULE
  } else if (mode === OPTIONS_MODE_ALL) {
    sourceType = MODULE
  } else if (mode === OPTIONS_MODE_AUTO) {
    sourceType = UNAMBIGUOUS
  }

  let { compileData } = entry

  if (! compileData) {
    compileData = Compiler.from(entry)

    if (! compileData ||
        compileData.changed) {
      const scriptData = compileData
        ? compileData.scriptData
        : null

      compileData = tryCompileCode(caller, entry, content, filename, {
        hint,
        sourceType
      })

      compileData.scriptData = scriptData
    } else {
      compileData.code = content
    }
  }

  if (! parsing) {
    entry.state = STATE_EXECUTION_STARTED
    return tryCompileCached(entry, content, filename)
  }

  const defaultPkg = Package.state.default
  const isESM = entry.type === TYPE_ESM
  const parentEntry = entry.parent
  const parentIsESM = parentEntry && parentEntry.type === TYPE_ESM
  const parentPkg = parentEntry && parentEntry.package

  if (! isESM &&
      ! parentIsESM &&
      (pkg === defaultPkg ||
       parentPkg === defaultPkg)) {
    return fallback ? fallback() : void 0
  }

  if (isESM &&
      entry.state === STATE_PARSING_STARTED) {
    tryValidateESM(caller, entry, content, filename)
  }
}

function tryCompileCached(entry, content, filename) {
  const isESM = entry.type === TYPE_ESM
  const { moduleState } = shared
  const noDepth = moduleState.requireDepth === 0
  const tryCompile = isESM ? tryCompileESM : tryCompileCJS

  if (noDepth) {
    moduleState.stat = { __proto__: null }
  }

  let error
  let result
  let threw = false

  try {
    result = tryCompile(entry, filename)
  } catch (e) {
    error = e
    threw = true
  }

  if (noDepth) {
    moduleState.stat = null
  }

  if (! threw) {
    return result
  }

  if (Package.state.default.options.debug ||
      ! isError(error) ||
      isStackTraceMasked(error)) {
    throw error
  }

  if (isESM &&
      error.name === "SyntaxError") {
    entry.package.cache.dirty = true
  }

  const loc = getLocationFromStackTrace(error)

  if (loc) {
    filename = loc.filename
  }

  content = () => readFile(filename, "utf8")
  throw maskStackTrace(error, content, filename, isESM)
}

function tryCompileCJS(entry, filename) {
  const { compileData, runtimeName } = entry
  const mod = entry.module
  const useAsync = useAsyncWrapper(entry)

  let content = compileData.code

  if (compileData.changed) {
    content =
      "const " + runtimeName + "=this;" +
      (compileData.topLevelReturn ? "return " : "") +
      runtimeName + ".r((" +
      (useAsync ? "async " :  "") +
      "function(exports,require){" +
      content +
      "\n}))"

    Runtime.enable(entry, GenericObject.create())
  } else if (useAsync) {
    content =
      "(async () => { " +
      content +
      "\n})();"
  }

  content += maybeSourceMap(entry, content, filename)
  return mod._compile(content, filename)
}

function tryCompileESM(entry, filename) {
  const { compileData, runtimeName } = entry
  const mod = entry.module

  const cjsVars =
    entry.package.options.cjs.vars &&
    ! isMJS(filename)

  let content =
    "const " + runtimeName + "=this;" +
    (cjsVars
      ? ""
      : "__dirname=__filename=arguments=exports=module=require=void 0;"
    ) +
    (compileData.topLevelReturn ? "return " : "") +
    runtimeName + ".r((" +
    (useAsyncWrapper(entry) ? "async " :  "") +
    "function(" +
    (cjsVars
      ? "exports,require"
      : ""
    ) +
    '){"use strict";' +
    compileData.code +
    "\n}))"

  content += maybeSourceMap(entry, content, filename)

  Runtime.enable(entry, GenericObject.create())
  return mod._compile(content, filename)
}

function maybeSourceMap(entry, content, filename) {
  const { sourceMap } = entry.package.options

  if (sourceMap !== false &&
      (sourceMap ||
       ELECTRON_RENDERER ||
       INSPECT) &&
      ! getSourceMappingURL(content)) {
    return "//# sourceMappingURL=data:application/json;charset=utf-8," +
      encodeURI(createSourceMap(filename, content))
  }

  return ""
}

function tryCompileCode(caller, entry, content, filename, options) {
  let error

  try {
    return Compiler.compile(entry, content, options)
  } catch (e) {
    error = e
  }

  if (Package.state.default.options.debug ||
      ! isError(error) ||
      isStackTraceMasked(error)) {
    throw error
  }

  const isESM = error.sourceType === MODULE

  Reflect.deleteProperty(error, "sourceType")
  captureStackTrace(error, caller)
  throw maskStackTrace(error, content, filename, isESM)
}

function tryValidateESM(caller, entry, content, filename) {
  let error

  try {
    return validateESM(entry)
  } catch (e) {
    error = e
  }

  if (Package.state.default.options.debug ||
      ! isError(error) ||
      isStackTraceMasked(error)) {
    throw error
  }

  captureStackTrace(error, caller)

  const loc = getLocationFromStackTrace(error)

  if (loc &&
      loc.filename !== filename) {
    filename = loc.filename
    content = () => readFile(filename, "utf8")
  }

  throw maskStackTrace(error, content, filename, true)
}

function useAsyncWrapper(entry) {
  return entry.package.options.await &&
    shared.support.await &&
    (entry.type !== TYPE_ESM ||
     (isObjectEmpty(entry.compileData.exportedSpecifiers) &&
      ! isMJS(entry.module)))
}

export default compile
