import "./binding.js"
import "./safe/buffer.js"
import "./safe/crypto.js"
import "./safe/inspector.js"
import "./safe/path.js"
import "./safe/process.js"
import "./safe/util.js"
import "./safe/vm.js"
import "./util/prepare-context.js"
import "./util/satisfies.js"

import ENV from "./constant/env.js"

import Module from "./module.js"
import Package from "./package.js"
import RealModule from "./real/module.js"
import Shim from "./shim.js"

import builtinVM from "./builtin/vm.js"
import errors from "./errors.js"
import globalHook from "./hook/global.js"
import isInstalled from "./util/is-installed.js"
import isObject from "./util/is-object.js"
import isSideloaded from "./env/is-sideloaded.js"
import keys from "./util/keys.js"
import mainHook from "./hook/main.js"
import moduleHook from "./hook/module.js"
import processHook from "./hook/process.js"
import realProcess from "./real/process.js"
import realVM from "./real/vm.js"
import requireHook from "./hook/require.js"
import shared from "./shared.js"
import vmHook from "./hook/vm.js"

const {
  CHECK,
  CLI,
  EVAL,
  INTERNAL,
  REPL
} = ENV

const {
  ERR_INVALID_ARG_TYPE
} = errors

let exported

if (shared.inited &&
    ! shared.reloaded) {
  Shim.enable(shared.unsafeGlobal)

  exported = (mod, options) => {
    if (! isObject(mod)) {
      throw new ERR_INVALID_ARG_TYPE("module", "object")
    }

    let cacheKey

    if (options === void 0) {
      const pkg = Package.from(mod)

      if (pkg) {
        cacheKey = JSON.stringify(pkg.options)
      }
    } else {
      options = Package.createOptions(options)
      cacheKey = JSON.stringify(options)
    }

    if (cacheKey) {
      const { state } = shared.package

      Package.state =
        state[cacheKey] ||
        (state[cacheKey] = {
          cache: { __proto__: null },
          default: null
        })
    }

    if (options) {
      const pkg = Package.from(mod, true)

      pkg.options = options
    }

    moduleHook(Module, mod)

    if (! isInstalled(mod)) {
      processHook(realProcess)
    }

    return requireHook(mod)
  }
} else {
  exported = shared
  exported.inited = true
  exported.reloaded = false

  Shim.enable(shared.safeGlobal)
  Shim.enable(shared.unsafeGlobal)

  if (CHECK) {
    vmHook(realVM)
  } else if (EVAL) {
    RealModule.prototype._compile = Module.prototype._compile
    moduleHook(Module)
    processHook(realProcess)
    vmHook(realVM)
  } else if (REPL) {
    moduleHook(Module)
    processHook(realProcess)
    vmHook(realVM)

    const names = keys(builtinVM)

    for (const name of names) {
      builtinVM[name] = realVM[name]
    }
  } else if (CLI ||
      INTERNAL ||
      isSideloaded()) {
    moduleHook(RealModule)
    mainHook(RealModule)
    processHook(realProcess)
  }

  if (INTERNAL) {
    globalHook(shared.unsafeGlobal)
  }
}

export default exported
