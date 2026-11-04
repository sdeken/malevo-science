import { run } from './index'

void run(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), cwd: process.cwd() }).then((code) => {
  process.exitCode = code
})
