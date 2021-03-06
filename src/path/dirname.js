import { dirname as _dirname } from "../safe/path.js"
import shared from "../shared.js"

function init() {
  function dirname(filename) {
    const cache = shared.memoize.pathDirname

    if (typeof filename === "string" &&
        Reflect.has(cache, filename)) {
      return cache[filename]
    }

    return cache[filename] = _dirname(filename)
  }

  return dirname
}

export default shared.inited
  ? shared.module.pathDirname
  : shared.module.pathDirname = init()
