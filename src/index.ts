#!/usr/bin/env node
import * as fs from 'fs-extra'
import chalk from 'chalk'
import { dirname, join, isAbsolute } from 'path'
import { SourceMapConsumer } from 'source-map'
import { ProgressBar } from './progress'
import * as cluster from 'cluster';
import { cpus } from 'os';
import * as minimist from 'minimist'
const numCPUs = cpus().length;
const argv = minimist(process.argv.slice(2))
const projectNameInput = argv._[0]
const mapInput = argv._[1]

interface TasksWorker {
  filePath: string;
  content: string | null;
}
interface Tasks {
  [key: number]: TasksWorker
}

if (!projectNameInput || !mapInput) {
  console.log()
  console.log(chalk.white('Usage: unpack'), chalk.green('<project-directory> <path-to-map-file>'))
  console.log()
  console.log(chalk.blue('*Note:   Minified file should be placed under path specified in .map file.'))
  console.log()
  process.exit()
}
if (cluster.isMaster) {

  const parseSourceMaps = async (pathToProject: string, pathToMap: string) => {
    if (await fs.pathExists(pathToProject)) {
      console.log()
      console.log(chalk.red(`Project folder already exists at: ${pathToProject}`))
      console.log()
      process.exit()
    }

    if (!await fs.pathExists(pathToMap)) {
      console.log()
      console.log(chalk.red(`Can't find map file under : ${pathToMap}`))
      console.log()
      process.exit()
    }
    try {
      const mapFile = await fs.readFile(pathToMap, 'utf8')
      SourceMapConsumer.with(mapFile, null, async (consumer: SourceMapConsumer) => {
        console.log(chalk.green(`Unpacking 🛍  your source maps 🗺`))
        const sources = (consumer as any).sources
        if (sources.some((src: string) => src.substring(0, 7) !== 'webpack')) {
          console.log(chalk.red('Not a webpack generated sourcemap!'))
          process.exit(1)
        }
        console.log(chalk.cyan('Processing with ' + numCPUs + ' cpus'))
        let tasks: Tasks[] = []
        let taskWorker: TasksWorker[] = [];
        const WEBPACK_SUBSTRING_INDEX = 11
        const bar = new ProgressBar({
          schema: ' [:filled.green:blank] :current/:total :percent.cyan :elapseds :etas',
          total: sources.length
        })
        for (const source of sources) {
          const content = consumer.sourceContentFor(source)
          const filePath = `${process.cwd()}/${projectNameInput}/${source.substring(WEBPACK_SUBSTRING_INDEX)}`
          await fs.ensureDir(dirname(filePath))
          if (taskWorker.length < numCPUs) {
            taskWorker.push({ filePath, content })
          } else {
            tasks.push(taskWorker);
            taskWorker = [{ filePath, content }];
          }
        }
        if (taskWorker.length) {
          tasks.push(taskWorker);
        }
        let taskParts = 0;
        let workerNum = 0;
        const loop = () => {

          for (let i = 0; i < numCPUs; i++) {
            workerNum++;
            const worker = cluster.fork(tasks[taskParts][i]);
            worker.once('message', (event) => {
              if (event === 'finish') {
                bar.tick();
                worker.disconnect();
              }
            })
            worker.once('online', () => {
              worker.send('start')
            });
            worker.once('exit', () => {
              workerNum--;
              if (workerNum == 0) {
                taskParts++
                if (taskParts === tasks.length) {
                  console.log(chalk.green('🎉  All done! Enjoy exploring your code 💻'))
                  process.exit();
                } else {
                  process.nextTick(loop);
                }
              }
            })
          }
        }
        loop();

      })
    } catch (err) {
      console.log(chalk.red('Oops! Something is wrong with the source map'), err)
      console.log(chalk.red('Make sure .min.js is correctly placed under the path specified in .map file'))
      console.log('STDERR: ')
      console.log(err)
    }
  }
  const pathToProject = join(process.cwd(), projectNameInput)
  const pathToMap = isAbsolute(mapInput) ? mapInput : join(process.cwd(), mapInput)
  parseSourceMaps(pathToProject, pathToMap).catch(console.error)

} else if (cluster.isWorker) {
  const writeFile = async (filePath: string, content: string | null) => {
    await fs.writeFile(filePath, content)
  }
  process.on('message', event => {
    if (event === 'start') {
      if (process.env.filePath && process.env.content) {
        writeFile(process.env.filePath, process.env.content).then(() => {
          if (process.send) {
            process.send('finish');
          }
        })
      } else {
        process.exit()
      }
    }
  })
}