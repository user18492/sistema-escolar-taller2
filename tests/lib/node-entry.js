// Proceso hijo de las capas que corren en node (db, startup). Lo lanza tests/run.js.
const pgHooks = require('./pg-hooks');

pgHooks.install();

const { readArgs, layerFiles, selector, progress } = require('./child-protocol');
const { loadFiles } = require('./framework');
const { runGroups, jsonlWriter } = require('./runner-core');
const { Monitor } = require('./monitor');
const { prepareGroupDb, releaseGroupDb, decorateDb } = require('./group-db');
const { TIMEOUTS } = require('../config');

async function main() {
  const args = readArgs();
  const monitor = new Monitor();
  monitor.captureProcess('node');
  const write = jsonlWriter(args.resultsFile, progress);
  const groups = loadFiles(layerFiles(args.layer), args.layer);
  let groupIndex = 0;

  const env = {
    layer: args.layer,
    defaultTimeoutMs: TIMEOUTS.test[args.layer],
    monitor,
    async beforeGroup(group) {
      groupIndex += 1;
      const ctx = { args, runDir: args.runDir };
      if (group.options.db === 'none') return ctx;
      const dbCtx = await prepareGroupDb({
        template: args.template,
        name: `${args.dbBase}_${args.layer}_${groupIndex}`,
        setup: group.options.setup ? (c) => group.options.setup({ ...c, args }) : null,
        withAppConnection: Boolean(group.options.appConnection),
      });
      return Object.assign(ctx, dbCtx);
    },
    decorate(t, ctx) {
      t.args = ctx.args;
      t.runDir = ctx.runDir;
      t.emit = write;
      // Corre `fn` y devuelve los eventos que registraron los monitores mientras tanto (para las
      // pruebas que confirman que la detección funciona).
      t.detect = async (fn) => {
        const mark = monitor.mark();
        await fn();
        await monitor.settle(mark);
        return monitor.since(mark);
      };
      if (ctx.client) decorateDb(t, ctx);
    },
    async afterGroup(group, ctx) {
      if (ctx.client) await releaseGroupDb(ctx, { keepDb: args.keepDb });
    },
  };

  await runGroups(groups, env, { select: selector(args), write });
  write({ type: 'done', layer: args.layer });
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stdout.write(`ERROR de la capa: ${error.stack ?? error}\n`);
    process.exit(error.fatal ? 3 : 2);
  }
);
