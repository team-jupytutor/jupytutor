export const DEV_LOG = location.href.includes('localhost');

type DevLogFn = (...logArgFunctions: (() => any | Promise<any>)[]) => void;
type DevLog = DevLogFn & {
  warn: DevLogFn;
  error: DevLogFn;
};

const devLogCreator =
  (logFunction: typeof console.log) =>
  (...logArgFunctions: (() => any | Promise<any>)[]) => {
    if (DEV_LOG) {
      const args = logArgFunctions.map(fn => fn());
      Promise.all(args).then(resolvedArgs => {
        logFunction('[Jupytutor]:', ...resolvedArgs);
      });
    }
  };

export const devLog: DevLog = Object.assign(devLogCreator(console.log), {
  warn: devLogCreator(console.warn),
  error: devLogCreator(console.error)
});
