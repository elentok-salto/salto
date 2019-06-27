import path from 'path'
import * as fs from 'async-file'
import './wasm_exec'

// Not sure why eslint ignores this definition from wasm_exec.d.ts,
// but this doesn't work without the following disable
// eslint-disable-next-line no-undef
const go = new Go()

class HCLParser {
  private wasmData: Promise<Buffer> | null = null

  get wasmModule(): Promise<WebAssembly.ResultObject> {
    if (this.wasmData === null) {
      // Load web assembly module data once in the life of a parser
      this.wasmData = (async () => {
        // Relative path from source location
        const modulePath = path.join(__dirname, '..', '..', 'hcl.wasm')
        return fs.readFile(modulePath)
      })()
    }

    // Not sure why eslint ignores this definition from webassembly.d.ts,
    //  but this doesn't work without the following disable
    // eslint-disable-next-line no-undef
    return this.wasmData.then(data => WebAssembly.instantiate(data, go.importObject))
  }

  async Parse(
    src: Buffer,
    filename: string,
  ): Promise<{ body: HCLBlock; errors: string[] }> {
    const wasmModule = await this.wasmModule

    try {
      // Setup arguments to parse function
      global.hclParserArgs = {
        src,
        filename,
      }
      // Call parse function from go
      await go.run(wasmModule.instance)
      // Return value should be populated by the above call
      return {
        body: global.hclParserReturn.value,
        errors: global.hclParserReturn.errors,
      }
    } finally {
      // cleanup args and return values
      delete global.hclParserArgs
      delete global.hclParserReturn
    }
  }
}

export default new HCLParser()
