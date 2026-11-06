/**
 * Packs WordNet 3.1 (the wordnet-db package, a build-time dependency) into
 * out/wordnet/wordnet.json for the Names tool. Run by `npm run build`; skipped
 * when the packed file is newer than the source.
 */
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('wordnet-db/package.json'))
const dict = path.join(pkgDir, 'dict')
const outDir = path.join(root, 'out/wordnet')
const outFile = path.join(outDir, 'wordnet.json')
const lexiconSrc = path.join(root, 'packages/model/src/lexicon.ts')

const newest = Math.max(statSync(path.join(dict, 'data.noun')).mtimeMs, statSync(lexiconSrc).mtimeMs)
if (existsSync(outFile) && statSync(outFile).mtimeMs > newest) process.exit(0)

const bundled = await build({ entryPoints: [lexiconSrc], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'warning' })
const { packWordNet } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const read = (f) => readFileSync(path.join(dict, f), 'utf8')
const packed = packWordNet(
  { noun: read('data.noun'), verb: read('data.verb'), adj: read('data.adj'), adv: read('data.adv') },
  'WordNet 3.1'
)
mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, JSON.stringify(packed))
copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'LICENSE'))
console.log(`wordnet: ${packed.words.length} senses packed into out/wordnet/wordnet.json`)
