import ESM from "../constant/esm.js"

import shared from "../shared.js"

function init() {
  const {
    PKG_PREFIX
  } = ESM

  const customInspectDescriptor = {
    value: () => "{}"
  }

  const markerDescriptor = {
    value: 1
  }

  const funcToStringTagDescriptor = {
    configurable: true,
    value: "Function",
    writable: true
  }

  class OwnProxy {
    static instances = new WeakMap

    constructor(target, handler) {
      handler = { __proto__: handler }

      Reflect.defineProperty(handler, shared.customInspectKey, customInspectDescriptor)
      Reflect.defineProperty(handler, PKG_PREFIX + ":proxy", markerDescriptor)
      Object.freeze(handler)

      const proxy = new Proxy(target, handler)

      if (typeof target === "function" &&
          ! shared.support.proxiedFunctionToStringTag) {
        Reflect.defineProperty(proxy, Symbol.toStringTag, funcToStringTagDescriptor)
      }

      OwnProxy.instances.set(proxy, Object.freeze([target, handler]))
      return proxy
    }
  }

  Reflect.setPrototypeOf(OwnProxy.prototype, null)

  return OwnProxy
}

export default shared.inited
  ? shared.module.OwnProxy
  : shared.module.OwnProxy = init()
